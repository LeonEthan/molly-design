import { mkdtemp, mkdir, readFile, rm, writeFile, appendFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { createReadToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { createMollySession } from '../src/session-factory';
import { NativeRunOutcome } from '../src/run-outcome';
import { createToolEnvironment, createWorkerEnvironment } from '../src/environment';
import { MollyResourceLoader } from '../src/resource-loader';
import { createBoundModelFetch } from '../src/model-transport';
import { guardedProviderStream } from '../src/provider-stream';
import { createExtensionUI } from '../src/extension-ui';
import { failingExtension } from './fixtures/failing-extension';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(id = 'connection-a') {
  const root = await mkdtemp(join(tmpdir(), 'molly-pi-test-'));
  roots.push(root);
  const cwd = join(root, 'project');
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await writeFile(
    join(cwd, '.pi', 'settings.json'),
    JSON.stringify({ defaultProvider: 'wrong', defaultModel: 'wrong' })
  );
  await writeFile(join(cwd, 'AGENTS.md'), 'UNAPPROVED_CONTEXT_MARKER');
  return {
    cwd,
    productSessionId: 'synthetic-session',
    privateRoot: join(root, 'private'),
    connection: {
      schemaVersion: 1 as const,
      id,
      revision: 1,
      providerPresetId: 'openai' as const,
      displayName: id,
      baseUrl: 'https://example.invalid/v1',
      credentialRef: `key-${id}`,
      enabled: true,
    },
    selection: { connectionId: id, modelId: 'gpt-4o', thinking: 'off' as const },
    apiKey: `synthetic-${id}`,
    tools: [],
    systemPrompt: 'HOST_APPROVED_CONTEXT',
  };
}

describe('owned Pi session', () => {
  it('refuses a failed startup hook before acknowledging the native session', async () => {
    const events: string[] = [];
    vi.spyOn(MollyResourceLoader.prototype, 'getExtensions').mockReturnValue(
      failingExtension('session_start', events)
    );
    await expect(createMollySession(await fixture())).rejects.toThrow(
      'harness_extension_bind_failed'
    );
    expect(events).toEqual(['session_start']);
  });

  it.each(['before_agent_start', 'context'] as const)(
    'fences provider transport after a failed %s hook without question UI',
    async (hook) => {
      const events: string[] = [];
      const requests: unknown[] = [];
      vi.spyOn(MollyResourceLoader.prototype, 'getExtensions').mockReturnValue(
        failingExtension(hook, events)
      );
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
        requests.push(args);
        throw new Error('unexpected network dispatch');
      });
      const owned = await createMollySession({
        ...(await fixture()),
        onExtensionError: () => events.push('host-failure'),
      });
      try {
        await owned.session.prompt('Synthetic request');
        expect(owned.hasExtensionFailure()).toBe(true);
        expect(events).toEqual([hook, 'host-failure']);
        expect(requests).toEqual([]);
        const history = await readFile(owned.manager.getSessionFile()!, 'utf8');
        expect(history).not.toContain('SYNTHETIC_PRIVATE_EXTENSION_DIAGNOSTIC');
      } finally {
        owned.session.dispose();
      }
    }
  );
  it.each(['timeout', 'cancel', 'close'] as const)(
    'keeps a community question unanswered after %s',
    async (mode) => {
      const input = await fixture();
      const run = new AbortController();
      const dismissed: string[] = [];
      let reply: (value: string | undefined) => void = () => {};
      const bridge = createExtensionUI({
        currentSignal: () => run.signal,
        open: () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
        dismiss: (id) => {
          dismissed.push(id);
        },
        notify: () => {},
      });
      const owned = await createMollySession({ ...input, questionUI: bridge.ui });
      vi.useFakeTimers();
      try {
        const runner = owned.session.extensionRunner;
        const tool = runner.getToolDefinition('ask_question')!;
        const pending = tool.execute(
          'synthetic-question',
          { question: 'Proceed?', options: ['Yes', 'No'] },
          run.signal,
          undefined,
          runner.createContext()
        );
        if (mode === 'timeout') await vi.advanceTimersByTimeAsync(300_000);
        if (mode === 'cancel') run.abort();
        if (mode === 'close') reply(undefined);
        const result = await pending;
        expect(result.details).toMatchObject({
          answers: [],
          timedOut: mode === 'timeout',
          cancelled: mode !== 'timeout',
        });
        expect(JSON.stringify(result.content)).not.toContain('best judgement');
        if (mode === 'timeout') expect(JSON.stringify(result.content)).toContain('Do not infer');
        expect(dismissed[0]).toMatch(/^[a-f0-9-]{36}$/);
        reply('Yes');
        expect((await pending).details).toMatchObject({ answers: [] });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
        owned.session.dispose();
        bridge.dispose();
      }
    }
  );

  it('retains upstream multi-select and custom answers through dialog UI', async () => {
    const input = await fixture();
    const seen: string[] = [];
    const answers = ['Wide', 'Tall', 'Done selecting', 'Type a custom answer', 'Summer'];
    const bridge = createExtensionUI({
      currentSignal: () => new AbortController().signal,
      open: async (question) => {
        seen.push(question.question);
        return answers.shift();
      },
      dismiss: () => {},
      notify: () => {},
    });
    const owned = await createMollySession({ ...input, questionUI: bridge.ui });
    try {
      const runner = owned.session.extensionRunner;
      const tool = runner.getToolDefinition('ask_question')!;
      const result = await tool.execute(
        'synthetic-question',
        {
          questions: [
            { id: 'layout', question: 'Layouts?', options: ['Wide', 'Tall'], multiSelect: true },
            { id: 'title', question: 'Title?' },
          ],
        },
        undefined,
        undefined,
        runner.createContext()
      );
      expect(result.details).toMatchObject({
        cancelled: false,
        timedOut: false,
        answers: [
          { id: 'layout', answer: 'Wide, Tall', wasCustom: false },
          { id: 'title', answer: 'Summer', wasCustom: true },
        ],
      });
      expect(seen).toEqual(['Layouts?', 'Layouts?', 'Layouts?', 'Title?', 'Title?']);
    } finally {
      owned.session.dispose();
      bridge.dispose();
    }
  });

  it('loads the curated community question tool and restores its native answers without replay', async () => {
    const input = await fixture();
    const questions: string[] = [];
    const dismissed: string[] = [];
    const transportRequests: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      transportRequests.push(args);
      throw new Error('Unexpected transport');
    });
    const run = new AbortController();
    const bridge = createExtensionUI({
      currentSignal: () => run.signal,
      open: async (question) => {
        questions.push(question.question);
        return question.options.some((option) => option.label === 'Wide') ? 'Wide' : undefined;
      },
      dismiss: (id) => {
        dismissed.push(id);
      },
      notify: () => {},
    });
    const owned = await createMollySession({ ...input, questionUI: bridge.ui });
    const nativeSessionId = owned.manager.getSessionId();
    const file = owned.manager.getSessionFile()!;
    const outputs = [
      fauxAssistantMessage(
        fauxToolCall(
          'ask_question',
          { question: 'Which layout?', options: ['Wide', 'Tall'] },
          { id: 'question-tool' }
        ),
        { stopReason: 'toolUse', timestamp: 1 }
      ),
      fauxAssistantMessage('Using the chosen wide layout.', { timestamp: 2 }),
    ];
    owned.runtime.registerProvider('openai', {
      api: owned.session.model!.api,
      baseUrl: input.connection.baseUrl,
      streamSimple: () => {
        const message = outputs.shift();
        if (!message) throw new Error('Unexpected model replay');
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
    try {
      expect(owned.session.getActiveToolNames()).toContain('ask_question');
      await owned.session.prompt('Ask which layout to use.');
      expect(questions).toEqual(['Which layout?']);
      expect(dismissed[0]).toMatch(/^[a-f0-9-]{36}$/);
      const result = owned.session.messages.find((message) => message.role === 'toolResult');
      expect(result).toMatchObject({
        role: 'toolResult',
        toolName: 'ask_question',
        isError: false,
        details: {
          answers: [
            { id: 'question_1', question: 'Which layout?', answer: 'Wide', wasCustom: false },
          ],
          cancelled: false,
          timedOut: false,
        },
      });
    } finally {
      owned.session.dispose();
    }
    const before = await readFile(file, 'utf8');
    const restored = await createMollySession({ ...input, questionUI: bridge.ui, nativeSessionId });
    const separate = await createMollySession({
      ...input,
      productSessionId: 'another-session',
      questionUI: bridge.ui,
    });
    try {
      expect(restored.session.messages).toContainEqual(
        expect.objectContaining({
          role: 'toolResult',
          toolName: 'ask_question',
          details: expect.objectContaining({
            answers: [expect.objectContaining({ answer: 'Wide' })],
          }),
        })
      );
      expect(separate.session.messages).toEqual([]);
      expect(await readFile(file, 'utf8')).toBe(before);
      expect(questions).toEqual(['Which layout?']);
      expect(transportRequests).toEqual([]);
    } finally {
      restored.session.dispose();
      separate.session.dispose();
      bridge.dispose();
    }
  });
  it('rejects duplicate host tools before creating private runtime or native history', async () => {
    const input = await fixture();
    const tool = defineTool(createReadToolDefinition(input.cwd));
    await expect(createMollySession({ ...input, tools: [tool, tool] })).rejects.toThrow(
      'harness_duplicate_host_tool'
    );
    await expect(realpath(input.privateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('restores a newly acknowledged native session before its first inference', async () => {
    const input = await fixture();
    const first = await createMollySession(input);
    expect(first.session.getActiveToolNames()).not.toContain('ask_question');
    const nativeSessionId = first.manager.getSessionId();
    const path = first.manager.getSessionFile()!;
    first.session.dispose();
    const restored = await createMollySession({ ...input, nativeSessionId });
    try {
      expect(restored.manager.getSessionId()).toBe(nativeSessionId);
      expect(restored.session.messages).toEqual([]);
      const rows = (await readFile(path, 'utf8'))
        .trim()
        .split('\n')
        .map((row) => JSON.parse(row));
      expect(rows[0]).toMatchObject({ type: 'session', id: nativeSessionId });
      expect(rows.every((row) => row.type !== 'message')).toBe(true);
    } finally {
      restored.session.dispose();
    }
  });
  it.each([
    { modelId: 'kimi-for-coding', thinking: 'off' as const },
    { modelId: 'k3-256k', thinking: 'high' as const },
  ])(
    'uses native Kimi Code $modelId/$thinking with an isolated synthetic credential',
    async ({ modelId, thinking }) => {
      const input = await fixture('kimi-code');
      const requests: Request[] = [];
      const accounting: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, options) => {
        expect(accounting).toEqual([`dispatch:${modelId}`]);
        requests.push(new Request(request, options));
        return new Response('SYNTHETIC_DIAGNOSTIC_CANARY', { status: 401 });
      });
      const owned = await createMollySession({
        ...input,
        observeModelRequest: async (model) => {
          accounting.push(`dispatch:${model.id}`);
          return async (message) => {
            accounting.push(`settle:${message?.stopReason ?? 'unknown'}`);
          };
        },
        connection: {
          ...input.connection,
          providerPresetId: 'kimi-coding',
          baseUrl: 'https://api.kimi.com/coding/',
        },
        selection: { ...input.selection, modelId, thinking },
      });
      try {
        expect(owned.providerId).toBe('kimi-coding');
        expect(owned.session.model?.api).toBe('anthropic-messages');
        expect(owned.session.model?.input).toContain('image');
        expect(owned.session.thinkingLevel).toBe(thinking);
        expect((await owned.runtime.getAuth('kimi-coding'))?.auth.apiKey).toBe(input.apiKey);
        await owned.session.prompt('Synthetic protocol test');
        expect(accounting).toEqual([`dispatch:${modelId}`, 'settle:error']);
        expect(requests.map((request) => request.url)).toEqual([
          'https://api.kimi.com/coding/v1/messages?beta=true',
        ]);
        const request = requests[0]!;
        expect(request.headers.get('x-api-key')).toBe(input.apiKey);
        expect(request.headers.get('user-agent')).not.toMatch(/claude-cli|kimi-cli/i);
        const body = await request.json();
        expect(body).toMatchObject({ model: modelId, stream: true });
        if (thinking === 'high') {
          expect(body).toMatchObject({
            thinking: { type: 'adaptive' },
            output_config: { effort: 'high' },
          });
        }
        const persisted = await readFile(owned.manager.getSessionFile()!, 'utf8');
        expect(persisted).not.toContain(input.apiKey);
        expect(persisted).not.toContain('SYNTHETIC_DIAGNOSTIC_CANARY');
      } finally {
        owned.session.dispose();
      }
    }
  );

  it('does not dispatch when durable request accounting refuses the attempt', async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request) => {
      requests.push(String(request));
      throw new Error('must not reach transport');
    });
    const owned = await createMollySession({
      ...(await fixture()),
      observeModelRequest: async () => {
        throw new Error('synthetic accounting refusal');
      },
    });
    try {
      await owned.session.prompt('Synthetic accounting refusal');
      expect(requests).toEqual([]);
      expect(await readFile(owned.manager.getSessionFile()!, 'utf8')).toContain(
        'harness_provider_failed'
      );
    } finally {
      owned.session.dispose();
    }
  });

  it('rejects a saved Moonshot/Kimi Code mismatch before issuing a request', async () => {
    const input = await fixture();
    await expect(
      createMollySession({
        ...input,
        connection: {
          ...input.connection,
          providerPresetId: 'moonshot',
          baseUrl: 'https://api.kimi.com/coding/',
        },
        selection: { ...input.selection, modelId: 'kimi-for-coding' },
      })
    ).rejects.toThrow('harness_kimi_code_requires_own_provider');
  });
  it.each(['diagnostic', 'throw', 'truncated'] as const)(
    'sanitizes %s provider failures before native persistence',
    async (kind) => {
      const input = await fixture();
      const owned = await createMollySession(input);
      const canary = 'SYNTHETIC_UPSTREAM_SECRET_CANARY';
      owned.runtime.registerProvider('openai', {
        api: owned.session.model!.api,
        streamSimple: (model) =>
          guardedProviderStream(model, () => {
            if (kind === 'throw') throw new Error(canary);
            const stream = createAssistantMessageEventStream();
            if (kind === 'diagnostic')
              stream.push({
                type: 'error',
                reason: 'error',
                error: fauxAssistantMessage(canary, {
                  stopReason: 'error',
                  errorMessage: canary,
                  timestamp: 1,
                }),
              });
            stream.end();
            return stream;
          }),
      });
      const outcome = new NativeRunOutcome();
      owned.session.subscribe((event) => outcome.accept(event));
      try {
        await owned.session.prompt('Synthetic failure task');
        expect(outcome.finish(owned.manager.getLeafId()).status).toBe('failed');
        const persisted = await readFile(owned.manager.getSessionFile()!, 'utf8');
        expect(persisted).not.toContain(canary);
        expect(persisted).toContain('harness_provider_failed');
      } finally {
        owned.session.dispose();
      }
    }
  );
  it('restores the exact product-owned native context without inference or history replay', async () => {
    const input = await fixture();
    const first = await createMollySession(input);
    first.runtime.registerProvider('openai', {
      api: first.session.model!.api,
      streamSimple: () => {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: 'done',
          reason: 'stop',
          message: fauxAssistantMessage('Retained native response', { timestamp: 1 }),
        });
        stream.end();
        return stream;
      },
    });
    await first.session.prompt('Synthetic original task');
    const nativeSessionId = first.manager.getSessionId();
    const file = first.manager.getSessionFile()!;
    first.session.dispose();
    const before = await readFile(file, 'utf8');
    const restored = await createMollySession({ ...input, nativeSessionId });
    try {
      expect(restored.manager.getSessionId()).toBe(nativeSessionId);
      expect(JSON.stringify(restored.session.messages)).toContain('Retained native response');
      expect(await readFile(file, 'utf8')).toBe(before);
    } finally {
      restored.session.dispose();
    }
    const switched = await createMollySession({
      ...input,
      apiKey: undefined,
      connection: {
        ...input.connection,
        id: 'second-connection',
        revision: 2,
        providerPresetId: 'kimi-coding',
        baseUrl: 'https://api.kimi.com/coding/',
      },
      selection: { connectionId: 'second-connection', modelId: 'k3-256k', thinking: 'high' },
      nativeSessionId,
    });
    try {
      expect(switched.manager.getSessionId()).toBe(nativeSessionId);
      expect(await realpath(switched.manager.getSessionFile()!)).toBe(await realpath(file));
      expect(switched.session.model?.id).toBe('k3-256k');
      expect(switched.session.thinkingLevel).toBe('high');
      expect(JSON.stringify(switched.session.messages)).toContain('Retained native response');
      expect(switched.runtime.hasConfiguredAuth('openai')).toBe(false);
      expect(switched.runtime.hasConfiguredAuth('kimi-coding')).toBe(false);
    } finally {
      switched.session.dispose();
    }
    await expect(
      createMollySession({
        ...input,
        productSessionId: 'different-product-session',
        nativeSessionId,
      })
    ).rejects.toThrow('harness_native_session_missing_or_ambiguous');
    await appendFile(file, '{"unfinished":');
    const damaged = await readFile(file, 'utf8');
    await expect(createMollySession({ ...input, nativeSessionId })).rejects.toThrow(
      'harness_native_session_invalid'
    );
    expect(await readFile(file, 'utf8')).toBe(damaged);
  });
  it('binds model fetch to the selected recipient and disables implicit redirect forwarding', async () => {
    const requests: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
    const transport: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), redirect: init?.redirect });
      return new Response('synthetic');
    };
    const bound = createBoundModelFetch('https://example.invalid/v1', transport);
    await bound('https://example.invalid/v1/messages', { redirect: 'follow' });
    await expect(bound('https://other.invalid/v1/messages')).rejects.toThrow(
      'harness_model_destination_changed'
    );
    expect(requests).toEqual([{ url: 'https://example.invalid/v1/messages', redirect: 'error' }]);
    const rejected = createBoundModelFetch(
      'https://example.invalid',
      async () => new Response('ECHOED_SYNTHETIC_KEY', { status: 401 })
    );
    const response = await rejected('https://example.invalid');
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":{"message":"harness_provider_http_401"}}');
  });
  it.each(['stop', 'length', 'error', 'aborted'] as const)(
    'observes native settlement for %s without network',
    async (stopReason) => {
      const input = await fixture();
      const owned = await createMollySession({
        ...input,
        readBeforeEditReminder: 'PUBLIC_HOOK_REMINDER',
      });
      const observedContexts: string[] = [];
      owned.runtime.registerProvider('openai', {
        api: owned.session.model!.api,
        baseUrl: input.connection.baseUrl,
        streamSimple: (_model, context) => {
          observedContexts.push(context.systemPrompt ?? '');
          const stream = createAssistantMessageEventStream();
          const message = fauxAssistantMessage('Synthetic result', { stopReason, timestamp: 1 });
          if (stopReason === 'error' || stopReason === 'aborted')
            stream.push({ type: 'error', reason: stopReason, error: message });
          else stream.push({ type: 'done', reason: stopReason, message });
          stream.end();
          return stream;
        },
      });
      const outcome = new NativeRunOutcome();
      const events: string[] = [];
      owned.session.subscribe((event) => {
        events.push(event.type);
        outcome.accept(event);
      });
      try {
        await owned.session.prompt('Synthetic task');
        expect(events).toContain('agent_settled');
        expect(
          outcome.finish(owned.manager.getLeafId()).status,
          JSON.stringify(owned.session.messages)
        ).toBe(
          stopReason === 'stop'
            ? 'completed'
            : stopReason === 'error'
              ? 'failed'
              : stopReason === 'aborted'
                ? 'cancelled'
                : 'interrupted'
        );
        expect(observedContexts.join('\n')).toContain('HOST_APPROVED_CONTEXT');
        expect(observedContexts.join('\n')).toContain('PUBLIC_HOOK_REMINDER');
        expect(observedContexts.join('\n')).not.toContain('UNAPPROVED_CONTEXT_MARKER');
        const sessionFile = owned.manager.getSessionFile();
        expect(sessionFile).toContain(join(input.privateRoot, 'sessions'));
        expect(await readFile(sessionFile!, 'utf8')).not.toContain(input.apiKey);
      } finally {
        owned.session.dispose();
      }
    }
  );

  it('isolates endpoint and credentials between same-provider connections', async () => {
    const a = await fixture('a');
    const b = await fixture('b');
    b.connection.baseUrl = 'https://second.invalid/v1';
    const first = await createMollySession(a);
    const second = await createMollySession(b);
    try {
      expect(first.runtime.getModel('openai', 'gpt-4o')?.baseUrl).toBe(a.connection.baseUrl);
      expect(second.runtime.getModel('openai', 'gpt-4o')?.baseUrl).toBe(b.connection.baseUrl);
      expect((await first.runtime.getAuth('openai'))?.auth.apiKey).toBe(a.apiKey);
      expect((await second.runtime.getAuth('openai'))?.auth.apiKey).toBe(b.apiKey);
    } finally {
      first.session.dispose();
      second.session.dispose();
    }
  });

  it('rejects unknown models instead of choosing a fallback', async () => {
    const input = await fixture();
    input.selection.modelId = 'not-in-catalog';
    await expect(createMollySession(input)).rejects.toThrow('harness_model_not_in_catalog');
  });

  it('does not discover resources and freezes the approved resource set', () => {
    const loader = new MollyResourceLoader({ systemPrompt: 'approved' });
    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
    expect(() => loader.extendResources()).toThrow('harness_resource_set_is_frozen');
  });

  it('removes inherited auth, runtime injection and proxy variables before SDK/tool execution', () => {
    const polluted = {
      HOME: '/home/test',
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'synthetic',
      ANTHROPIC_API_KEY: 'synthetic',
      NODE_OPTIONS: '--import attacker',
      HTTP_PROXY: 'http://attacker',
      PI_CODING_AGENT_DIR: '/global/pi',
      MOLLY_CONTROL_TOKEN: 'synthetic',
    };
    const worker = createWorkerEnvironment(polluted, '/private/molly');
    expect(worker.PI_CODING_AGENT_DIR).toBe('/private/molly/config');
    expect(worker.PI_OFFLINE).toBe('1');
    expect(createToolEnvironment(worker)).toEqual({ HOME: '/home/test', PATH: '/usr/bin' });
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'NODE_OPTIONS',
      'HTTP_PROXY',
      'MOLLY_CONTROL_TOKEN',
    ]) {
      expect(worker).not.toHaveProperty(key);
    }
  });
});
