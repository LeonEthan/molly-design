import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import {
  PI_ENGINE_VERSION,
  HARNESS_IMAGE_IMPORT_METHOD,
  HarnessImageImportResultSchema,
  HARNESS_IMAGE_RECOVERY_METHOD,
  HarnessImageRecoveryResultSchema,
} from '@molly/shared/embedded-harness';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  MollyAcpAdapter,
  type RunCredentialProvider,
  type McpCredentialProvider,
} from './acp-adapter';
import { createMollySession } from './session-factory';
import { createApprovedTools, hashToolset } from './approved-tools';
import type { WorkerConfig } from './worker-config';
import { describeToolCall } from './tool-presentation';
import { AgentBrowserCommandSchema } from '@molly/shared/browser-agent-rpc';
import { classifyBrowserHostname } from '@molly/shared/browser-url';

export async function probeWorker() {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: `${process.env.PI_CODING_AGENT_DIR}/models.json`,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  return {
    schemaVersion: 1,
    engineVersion: PI_ENGINE_VERSION,
    protocolVersion: 1,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    providers: runtime.getProviders().map((provider) => provider.id),
    modelCount: runtime.getModels().length,
  };
}

export async function runWorker(
  config: WorkerConfig,
  credentialProvider: RunCredentialProvider,
  mcpCredentialProvider?: McpCredentialProvider
): Promise<void> {
  let adapter: MollyAcpAdapter;
  let browserTaskGrant: { runId: string; runtimeEpoch: string; sites: Set<string> } | undefined;
  let browserActiveSite: { runId: string; site: string } | undefined;
  const connection = new AgentSideConnection(
    (peer) => {
      const approve: Parameters<typeof createApprovedTools>[0]['approve'] = async (request) => {
        const sessionId = adapter.currentSessionId;
        if (!sessionId || request.signal?.aborted) return false;
        const run = adapter.currentRunScope;
        const browser =
          request.name === 'molly/molly_browser'
            ? AgentBrowserCommandSchema.safeParse(request.arguments)
            : undefined;
        if (
          browserTaskGrant &&
          (!run ||
            browserTaskGrant.runId !== run.runId ||
            browserTaskGrant.runtimeEpoch !== run.runtimeEpoch)
        ) {
          browserTaskGrant = undefined;
        }
        if (browserActiveSite && (!run || browserActiveSite.runId !== run.runId))
          browserActiveSite = undefined;
        let site: string | undefined;
        if (browser?.success && browser.data.kind === 'navigate') {
          try {
            const url = new URL(browser.data.url);
            if (
              ['http:', 'https:'].includes(url.protocol) &&
              classifyBrowserHostname(url.hostname) === 'public'
            ) {
              site = url.hostname.toLowerCase().replace(/^www\./, '');
            }
          } catch {
            // The browser host gives the actual URL error after ordinary approval.
          }
        } else if (browser?.success) {
          site = browserActiveSite?.site;
        }
        if (browser?.success && run && site && browserTaskGrant?.sites.has(site)) {
          if (browser.data.kind === 'navigate') browserActiveSite = { runId: run.runId, site };
          return { kind: 'browse_task', sites: [...browserTaskGrant.sites] };
        }
        const canGrantTask = Boolean(
          config.permissionProfileId === 'browse-task-v1' &&
          browser?.success &&
          run &&
          site &&
          (!browserTaskGrant || browserTaskGrant.sites.size < 8)
        );
        const response = await peer.requestPermission({
          sessionId,
          toolCall: {
            toolCallId: request.toolCallId,
            ...describeToolCall(request.name, request.arguments, config.cwd),
            status: 'pending',
          },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            ...(canGrantTask
              ? [
                  {
                    optionId: 'allow-browse-task',
                    name: `Allow browsing, clicks, input and selected-image saves on ${site} for this task`,
                    kind: 'allow_once' as const,
                  },
                ]
              : []),
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        });
        if (request.signal?.aborted || response.outcome.outcome !== 'selected') return false;
        if (response.outcome.optionId === 'allow-once') {
          if (browser?.success && browser.data.kind === 'navigate' && run && site)
            browserActiveSite = { runId: run.runId, site };
          return true;
        }
        if (response.outcome.optionId === 'allow-browse-task' && canGrantTask && run && site) {
          if (!browserTaskGrant)
            browserTaskGrant = {
              runId: run.runId,
              runtimeEpoch: run.runtimeEpoch,
              sites: new Set(),
            };
          browserTaskGrant.sites.add(site);
          if (browser?.success && browser.data.kind === 'navigate')
            browserActiveSite = { runId: run.runId, site };
          return { kind: 'browse_task', sites: [...browserTaskGrant.sites] };
        }
        return false;
      };
      const tools = createApprovedTools({ cwd: config.cwd, shellPath: config.shellPath, approve });
      adapter = new MollyAcpAdapter(
        peer,
        {
          ...config,
          tools,
          toolsetHash: hashToolset(tools),
          pluginSetHash: createHash('sha256')
            .update(
              JSON.stringify(
                config.readBeforeEditReminder
                  ? [{ id: 'molly-read-before-edit-v1', reminder: config.readBeforeEditReminder }]
                  : []
              )
            )
            .digest('hex'),
        },
        createMollySession,
        credentialProvider,
        approve,
        mcpCredentialProvider,
        config.designImageImport
          ? async (request, signal) => {
              signal.throwIfAborted();
              const sessionId = adapter.currentSessionId;
              if (!sessionId) throw new Error('harness_session_unavailable');
              const result = await peer.extMethod(HARNESS_IMAGE_IMPORT_METHOD, {
                sessionId,
                request,
              });
              signal.throwIfAborted();
              return HarnessImageImportResultSchema.parse(result);
            }
          : undefined,
        config.designImageRecovery
          ? async (request, signal) => {
              signal.throwIfAborted();
              const sessionId = adapter.currentSessionId;
              if (!sessionId) throw new Error('harness_session_unavailable');
              const result = await peer.extMethod(HARNESS_IMAGE_RECOVERY_METHOD, {
                sessionId,
                request,
              });
              signal.throwIfAborted();
              return HarnessImageRecoveryResultSchema.parse(result);
            }
          : undefined
      );
      return adapter;
      // Node and DOM declare different ReadableStreamReadDoneResult shapes for the same Web stream.
    },
    ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
    )
  );
  await connection.closed;
  await adapter!.dispose();
}
