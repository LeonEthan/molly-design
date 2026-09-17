import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpSessionNotification } from '@molly/shared';

import type { Logger } from '@/utils/logger';

const mocks = vi.hoisted(() => ({
  startLocalAcpAgent: vi.fn(),
  shutdownLocalAcpAgent: vi.fn(async () => {}),
}));

vi.mock('./acp-runner', () => ({
  startLocalAcpAgent: mocks.startLocalAcpAgent,
  shutdownLocalAcpAgent: mocks.shutdownLocalAcpAgent,
}));

import { generateTitleIsolated } from './title-generator';

const SESSION_ID = 'acp-session-1';
/** Shape of pi-acp 0.0.33's prelude: version banner plus the skills listing. */
const BANNER =
  'pi v0.84.3\n---\n## Skills\n- /home/example/.pi/agent/skills/demo/SKILL.md\n- /home/example/.agents/skills/other/SKILL.md\n';
const TITLE = 'Refactor the session title generator';

/**
 * pi-acp always advertises a `thought_level` select, so the title agent always has a
 * config option to apply and therefore always makes a `session/set_config_option`
 * round trip before prompting. That round trip is what puts the adapter's prelude in
 * the buffer ahead of the prompt, so the fixture carries enough of that option for the
 * title agent to pick the same value it picks in production ('minimal'). pi-acp offers
 * six thought levels; three are enough to fix the choice.
 */
const PI_CONFIG_OPTIONS = [
  {
    id: 'thought_level',
    name: 'Thought level',
    type: 'select' as const,
    category: 'thought_level' as const,
    currentValue: 'medium',
    options: [
      { value: 'off', name: 'Off' },
      { value: 'minimal', name: 'Minimal' },
      { value: 'medium', name: 'Medium' },
    ],
  },
];

const createSilentLogger = (): Logger =>
  ({
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    debug: () => {},
    setLevel: () => {},
    child: () => createSilentLogger(),
    close: async () => {},
  }) as unknown as Logger;

/** An untyped agent_message_chunk: what an adapter without Molly phase metadata sends. */
const agentChunk = (text: string): AcpSessionNotification =>
  ({
    sessionId: SESSION_ID,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  }) as AcpSessionNotification;

type PreludeDelivery = 'during-config-round-trip' | 'before-startup-resolves' | 'never';

const runTitleGeneration = async (
  delivery: PreludeDelivery
): Promise<{ title: string | null; preludeArrivedBeforePrompt: boolean }> => {
  let preludeArrived = false;
  let preludeArrivedBeforePrompt = false;

  mocks.startLocalAcpAgent.mockImplementation(async (options: Record<string, never>) => {
    const onUpdateMessage = options.onUpdateMessage as (msg: AcpSessionNotification) => void;
    const deliverPrelude = () => {
      preludeArrived = true;
      onUpdateMessage(agentChunk(BANNER));
    };

    if (delivery === 'before-startup-resolves') deliverPrelude();

    return {
      agentProcess: {} as never,
      acpSessionId: SESSION_ID,
      client: {
        setSessionConfigOption: vi.fn(async () => {
          // pi-acp schedules the prelude with setTimeout(0) during session/new, so it is
          // on the wire long before this round trip -- itself several pipe RPCs to the pi
          // child -- can answer.
          if (delivery === 'during-config-round-trip') deliverPrelude();
          return undefined;
        }),
        prompt: vi.fn(async () => {
          preludeArrivedBeforePrompt = preludeArrived;
          onUpdateMessage(agentChunk(TITLE));
          return { stopReason: 'end_turn' };
        }),
      } as never,
      sessionResponse: { sessionId: SESSION_ID, configOptions: PI_CONFIG_OPTIONS },
    };
  });

  const title = await generateTitleIsolated({
    cliType: 'registry',
    agentType: 'pi-acp',
    taskPrompt: 'clean up how session titles are generated',
    logger: createSilentLogger(),
  });

  return { title, preludeArrivedBeforePrompt };
};

describe('title generation ignores adapter output emitted outside the title turn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discards a prelude delivered while the title config round trip is in flight', async () => {
    const result = await runTitleGeneration('during-config-round-trip');

    // Pins the delivery window the reset depends on: the prelude is in the buffer
    // before the prompt is sent, because applying pi-acp's thought_level option is a
    // real round trip. Remove that round trip and this flag goes false; move the reset
    // above it and the title assertion fails instead. Either mutation turns this test
    // red, and either one is a production regression.
    expect(result.preludeArrivedBeforePrompt).toBe(true);
    expect(result.title).toBe(TITLE);
  });

  it('discards a prelude already buffered when the agent finishes starting up', async () => {
    const result = await runTitleGeneration('before-startup-resolves');

    expect(result.preludeArrivedBeforePrompt).toBe(true);
    expect(result.title).toBe(TITLE);
  });

  it('leaves an adapter that emits nothing outside the turn exactly as it is today', async () => {
    const result = await runTitleGeneration('never');

    expect(result.preludeArrivedBeforePrompt).toBe(false);
    expect(result.title).toBe(TITLE);
  });
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it.each(['config', 'prompt', 'output'] as const)(
  'cancels during %s and waits for the owned child shutdown barrier',
  async (stage) => {
    const controller = new AbortController();
    const reached = deferred<void>();
    const shutdownEntered = deferred<void>();
    const childExited = deferred<void>();
    const pending = deferred<never>();
    const logger = createSilentLogger();
    logger.debug = (message) => {
      if (stage === 'output' && String(message).includes('Title prompt returned'))
        reached.resolve();
    };
    mocks.startLocalAcpAgent.mockImplementationOnce(async () => ({
      agentProcess: {},
      acpSessionId: SESSION_ID,
      sessionResponse: { sessionId: SESSION_ID, configOptions: PI_CONFIG_OPTIONS },
      client: {
        setSessionConfigOption: async () => {
          if (stage === 'config') {
            reached.resolve();
            await pending.promise;
          }
        },
        prompt: async () => {
          if (stage === 'prompt') {
            reached.resolve();
            return await pending.promise;
          }
          return { stopReason: 'end_turn' };
        },
      },
    }));
    mocks.shutdownLocalAcpAgent.mockImplementationOnce(async () => {
      shutdownEntered.resolve();
      await childExited.promise;
    });
    let finished = false;
    const title = generateTitleIsolated({
      cliType: 'registry',
      agentType: 'pi-acp',
      taskPrompt: 'fallback',
      logger,
      signal: controller.signal,
    }).then((value) => {
      finished = true;
      return value;
    });
    await reached.promise;
    controller.abort();
    await shutdownEntered.promise;
    expect(finished).toBe(false);
    childExited.resolve();
    expect(await title).toBeNull();
  }
);

it('passes startup cancellation to the existing owner and waits for its teardown', async () => {
  const controller = new AbortController();
  const started = deferred<void>();
  const aborted = deferred<void>();
  const childExited = deferred<void>();
  mocks.startLocalAcpAgent.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
    signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    started.resolve();
    await aborted.promise;
    await childExited.promise;
    throw signal.reason;
  });
  let finished = false;
  const title = generateTitleIsolated({
    cliType: 'registry',
    agentType: 'pi-acp',
    taskPrompt: 'fallback',
    logger: createSilentLogger(),
    signal: controller.signal,
  }).then((value) => {
    finished = true;
    return value;
  });
  await started.promise;
  controller.abort();
  await aborted.promise;
  expect(finished).toBe(false);
  childExited.resolve();
  expect(await title).toBeNull();
});

it.each([undefined, 'explicit-model'])(
  'keeps runtime model unless title override is explicit (%s)',
  async (override) => {
    let currentModel = 'private-provider-model';
    let promptedModel;
    const configOptions = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: currentModel,
        options: [
          { value: currentModel, name: currentModel },
          { value: 'explicit-model', name: 'Other endpoint' },
        ],
      },
    ];
    mocks.startLocalAcpAgent.mockImplementation(async (options: Record<string, never>) => ({
      agentProcess: {} as never,
      acpSessionId: SESSION_ID,
      sessionResponse: { sessionId: SESSION_ID, configOptions },
      client: {
        setSessionConfigOption: async (_id: string, key: string, value: string) => {
          if (key === 'model') currentModel = value;
          return configOptions;
        },
        prompt: async () => {
          promptedModel = currentModel;
          (options.onUpdateMessage as (msg: AcpSessionNotification) => void)(agentChunk(TITLE));
          return { stopReason: 'end_turn' };
        },
      } as never,
    }));
    expect(
      await generateTitleIsolated({
        cliType: 'builtin',
        agentType: 'grok',
        taskPrompt: 'Synthetic task',
        logger: createSilentLogger(),
        titleConfig: override ? { configOptionValues: { model: override } } : undefined,
      })
    ).toBe(TITLE);
    expect(promptedModel).toBe(override ?? 'private-provider-model');
  }
);
