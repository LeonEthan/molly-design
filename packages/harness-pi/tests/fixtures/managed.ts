import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import { ModelRuntime, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, fauxAssistantMessage } from '@earendil-works/pi-ai';
import {
  HarnessSessionBindingSchema,
  MOLLY_PROVIDER_IDS,
  PI_ENGINE_VERSION,
  type HarnessRunSnapshot,
} from '@molly/shared/embedded-harness';
import { PiAcpHost } from '../../src/host';
import { PiAcpAgent } from '../../src/agent';
import type { AdapterPeer } from '../../src/session';
import { PrivateControlPipe } from '../../src/private-control-pipe';
import type { WorkerConfig } from '../../src/worker-config';
import { createWorkerEnvironment } from '../../src/environment';
import { fixture } from './adapter';
import { writeProfileSettings } from '../../src/profile-settings';

const providerId = MOLLY_PROVIDER_IDS['openai-compatible'];
export async function managed(
  options: {
    extensions?: InlineExtension[];
    peer?: Partial<AdapterPeer>;
    length?: boolean;
    providerError?: string;
    productionProfile?: boolean;
    memoryResponse?: string;
    config?: Partial<WorkerConfig>;
    initialize?: boolean;
  } = {}
) {
  const f = await fixture();
  const config: WorkerConfig = {
    schemaVersion: 1,
    runtimeEpoch: randomUUID(),
    productSessionId: 'product-session',
    workspaceId: 'workspace',
    privateRoot: f.root,
    cwd: f.cwd,
    shellPath: '/bin/sh',
    harness: {
      id: 'molly',
      engine: 'pi',
      engineVersion: PI_ENGINE_VERSION,
      buildId: 'synthetic',
      protocolVersion: 1,
    },
    connection: {
      schemaVersion: 1,
      id: 'connection',
      revision: 1,
      providerPresetId: 'openai-compatible',
      displayName: 'Synthetic',
      baseUrl: 'https://synthetic.invalid/v1',
      credentialRef: 'protected-reference',
      enabled: true,
      customModels: [
        {
          modelId: 'model',
          name: 'Synthetic',
          input: ['text', 'image'],
          contextWindow: 200000,
          maxTokens: 4096,
          thinking: ['off'],
          toolCalls: true,
          usageInStreaming: false,
          maxTokensField: 'max_tokens',
        },
      ],
    },
    selection: { connectionId: 'connection', modelId: 'model', thinking: 'off' },
    systemPrompt: 'Synthetic host context.',
    permissionProfileId: 'native-profile',
    ...options.config,
  };
  const pipe = new PassThrough();
  const agentDir = createWorkerEnvironment({}, config).PI_CODING_AGENT_DIR!;
  await mkdir(agentDir, { recursive: true });
  if (options.productionProfile) await writeProfileSettings(agentDir);
  else
    await writeFile(
      join(agentDir, 'settings.json'),
      await readFile(join(f.agentDir, 'settings.json'))
    );
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  const peer: AdapterPeer = {
    sessionUpdate: async (update) => {
      f.updates.push(update);
    },
    ...options.peer,
  };
  const host = new PiAcpHost(config, new PrivateControlPipe(pipe), peer);
  const observed: string[] = [];
  let selectedRuntime!: ModelRuntime;
  const create = ModelRuntime.create.bind(ModelRuntime);
  vi.spyOn(ModelRuntime, 'create').mockImplementation(async (args) => {
    const runtime = await create(args);
    selectedRuntime = runtime;
    runtime.registerProvider(providerId, {
      baseUrl: config.connection.baseUrl,
      api: 'openai-completions',
      streamSimple: (model, context, opts) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          try {
            await opts?.onPayload?.({ synthetic: true }, model);
            observed.push(JSON.stringify(context));
            const extraction = JSON.stringify(context).includes('Extract only explicitly stated');
            const message = {
              ...fauxAssistantMessage(
                extraction
                  ? (options.memoryResponse ?? '{"changes":[{"text":"Prefers serif type"}]}')
                  : 'Synthetic answer.',
                {
                  stopReason: options.providerError ? 'error' : options.length ? 'length' : 'stop',
                  ...(options.providerError ? { errorMessage: options.providerError } : {}),
                }
              ),
              provider: model.provider,
              model: model.id,
              api: model.api,
              usage: {
                input: extraction ? 3 : 23,
                output: extraction ? 1 : 5,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: extraction ? 4 : 28,
                cost: {
                  input: extraction ? 0.015 : 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: extraction ? 0.015 : 0,
                },
              },
            };
            if (options.providerError)
              stream.push({ type: 'error', reason: 'error', error: message });
            else stream.push({ type: 'done', reason: options.length ? 'length' : 'stop', message });
            stream.end();
          } catch {
            stream.push({
              type: 'error',
              reason: 'error',
              error: fauxAssistantMessage('', { stopReason: 'error' }),
            });
            stream.end();
          }
        })();
        return stream;
      },
    });
    return runtime;
  });
  const agent = new PiAcpAgent(peer, {
    agentDir,
    host,
    extensions: options.extensions,
  });
  f.trackAgent(agent);
  if (options.initialize !== false)
    await agent.initialize({
      protocolVersion: 1,
      ...(options.peer?.request ? { clientCapabilities: { elicitation: { form: {} } } } : {}),
    });
  function grant(snapshot: HarnessRunSnapshot, key = 'SYNTHETIC_SECRET') {
    pipe.write(
      `${JSON.stringify({ type: 'credential', runtimeEpoch: snapshot.runtimeEpoch, runId: snapshot.runId, apiKey: key })}\n`
    );
  }
  async function open() {
    const response = await agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const binding = HarnessSessionBindingSchema.parse(response._meta?.mollyRuntime);
    const snapshot: HarnessRunSnapshot = {
      schemaVersion: 1,
      runId: 'run',
      runtimeEpoch: config.runtimeEpoch,
      sessionId: config.productSessionId,
      turnId: 'turn',
      connection: config.connection,
      selection: config.selection,
      harness: config.harness,
      toolsetHash: binding.toolsetHash,
      pluginSetHash: binding.pluginSetHash,
      permissionProfileId: config.permissionProfileId,
    };
    const prompt = (text = 'Hello', override = snapshot) =>
      agent.prompt({
        sessionId: response.sessionId,
        prompt: [{ type: 'text', text }],
        _meta: { mollyRunSnapshot: override },
      });
    return { response, binding, snapshot, prompt };
  }
  return {
    ...f,
    agentDir,
    agent,
    host,
    config,
    pipe,
    grant,
    open,
    observed,
    runtime: () => selectedRuntime,
  };
}
