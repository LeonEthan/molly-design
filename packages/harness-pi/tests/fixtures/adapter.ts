import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, vi } from 'vitest';
import {
  InMemoryCredentialStore,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { ModelRuntime, type InlineExtension } from '@earendil-works/pi-coding-agent';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { PiAcpAgent } from '../../src/agent';
import type { AdapterPeer } from '../../src/session';

export { ModelRuntime, VERSION, type InlineExtension } from '@earendil-works/pi-coding-agent';
export {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai';

const roots: string[] = [];
const agents: PiAcpAgent[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await Promise.all(agents.splice(0).map((agent) => agent.dispose()));
    // Pi's file-backed ModelRuntime finishes auth and catalog-cache writes after session
    // disposal and exposes no public completion signal, so removal retries ENOTEMPTY.
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 }))
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

export async function fixture(
  options: {
    responses?: AssistantMessage[];
    extensions?: InlineExtension[];
    request?: AdapterPeer['request'];
    beforeRuntime?: () => Promise<void>;
  } = {}
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'molly-owned-acp-')));
  roots.push(root);
  const agentDir = join(root, 'profile');
  const cwd = join(root, 'project');
  await mkdir(agentDir);
  await mkdir(cwd);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } })
  );
  const updates: SessionNotification[] = [];
  const prompts: string[] = [];
  let runtime!: ModelRuntime;
  const peer: AdapterPeer = {
    sessionUpdate: async (update) => {
      updates.push(update);
    },
    ...(options.request ? { request: options.request } : {}),
  };
  const responses = options.responses ?? [fauxAssistantMessage('Synthetic answer.')];
  const adapterOptions = {
    agentDir,
    model: { provider: 'synthetic', id: 'model' },
    extensions: options.extensions,
    createModelRuntime: async () => {
      await options.beforeRuntime?.();
      runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        modelsStorePath: join(agentDir, 'models-cache.json'),
        refreshOnCreate: false,
      });
      runtime.registerProvider('synthetic', {
        api: 'openai-completions',
        baseUrl: 'https://synthetic.invalid/v1',
        models: [
          {
            id: 'model',
            name: 'Synthetic model',
            input: ['text', 'image'],
            reasoning: false,
            contextWindow: 200_000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
        streamSimple: (_model, context) => {
          prompts.push(JSON.stringify(context));
          const message = responses.shift();
          if (!message) throw new Error('Unexpected inference');
          const stream = createAssistantMessageEventStream();
          stream.push({
            type: 'done',
            reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop',
            message,
          });
          stream.end();
          return stream;
        },
      });
      await runtime.setRuntimeApiKey('synthetic', 'synthetic-only');
      return runtime;
    },
  };
  const makeAgent = () => {
    const agent = new PiAcpAgent(peer, adapterOptions);
    agents.push(agent);
    return agent;
  };
  const agent = makeAgent();
  const initialize = () =>
    agent.initialize({
      protocolVersion: 1,
      ...(options.request ? { clientCapabilities: { elicitation: { form: {} } } } : {}),
    });
  return {
    root,
    cwd,
    agentDir,
    updates,
    prompts,
    responses,
    agent,
    makeAgent,
    trackAgent: (value: PiAcpAgent) => agents.push(value),
    initialize,
    runtime: () => runtime,
  };
}
