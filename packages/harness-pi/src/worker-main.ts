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
import { decideAutoReview } from './auto-review-policy';
import { WorkerSandbox, deniedReadRoots } from './sandbox';
import { createAutoReviewApproval, createNetworkReview, type RecordApproval } from './auto-review';
import type { WorkerConfig } from './worker-config';
import { describeToolCall } from './tool-presentation';
import { createBrowserTaskApproval } from './browser-approval';

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
  let sandbox: WorkerSandbox | undefined;
  const deniedRoots = deniedReadRoots([config.privateRoot, ...(config.privateDataRoots ?? [])]);
  const connection = new AgentSideConnection(
    (peer) => {
      const record: RecordApproval = async (request, source, decision, reviewOutcome) =>
        adapter
          .recordApproval({
            toolCallId: request.toolCallId,
            tool: request.name,
            source,
            decision,
            ...(reviewOutcome ? { reviewOutcome } : {}),
          })
          .then(
            () => true,
            () => false
          );
      const review = (
        subject: Parameters<MollyAcpAdapter['reviewEscalation']>[0],
        signal?: AbortSignal
      ) => adapter.reviewEscalation(subject, signal);
      const askUser = createBrowserTaskApproval({
        cwd: config.cwd,
        permissionProfileId: config.permissionProfileId,
        run: () => adapter.currentRunScope,
        review,
        record,
        ask: async (request, site) => {
          const sessionId = adapter.currentSessionId;
          if (!sessionId || request.signal?.aborted) return undefined;
          const response = await peer.requestPermission({
            sessionId,
            toolCall: {
              toolCallId: request.toolCallId,
              ...describeToolCall(request.name, request.arguments, config.cwd),
              status: 'pending',
            },
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              ...(site
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
          if (request.signal?.aborted || response.outcome.outcome !== 'selected') return undefined;
          const choice = response.outcome.optionId;
          return choice === 'allow-once' || choice === 'allow-browse-task' ? choice : 'deny';
        },
      });
      sandbox = new WorkerSandbox({
        cwd: config.cwd,
        shellPath: config.shellPath,
        deniedReadRoots: deniedRoots,
        reviewNetwork: createNetworkReview({
          run: () => adapter.currentRunScope,
          cwd: config.cwd,
          review,
          record,
          askUser,
        }),
      });
      const sandboxAvailable = sandbox.available;
      const approve = createAutoReviewApproval({
        mode: () => adapter.currentRunScope?.permissionMode,
        decide: (request) =>
          decideAutoReview(request, {
            cwd: config.cwd,
            writableRoots: [config.cwd, '/tmp', '/private/tmp'],
            deniedReadRoots: deniedRoots,
            sandboxAvailable,
          }),
        review,
        record,
        askUser,
      });
      const tools = createApprovedTools({
        cwd: config.cwd,
        shellPath: config.shellPath,
        approve,
        ...(sandboxAvailable ? { sandboxOperations: sandbox.operations() } : {}),
      });
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
  await sandbox?.dispose();
}
