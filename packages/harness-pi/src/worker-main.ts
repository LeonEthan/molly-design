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
  const connection = new AgentSideConnection(
    (peer) => {
      const approve: Parameters<typeof createApprovedTools>[0]['approve'] = async (request) => {
        const sessionId = adapter.currentSessionId;
        if (!sessionId || request.signal?.aborted) return false;
        const response = await peer.requestPermission({
          sessionId,
          toolCall: {
            toolCallId: request.toolCallId,
            ...describeToolCall(request.name, request.arguments, config.cwd),
            status: 'pending',
          },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        });
        return (
          !request.signal?.aborted &&
          response.outcome.outcome === 'selected' &&
          response.outcome.optionId === 'allow-once'
        );
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
