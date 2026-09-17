import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MessageHandler } from '../src/lib/message-handler';
import type { Logger } from '../src/utils/logger';
import type { SessionId, SessionTitleSource } from '@molly/shared';
import type { SessionManager } from '../src/session/session-manager';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import { createTestCloudPort } from './test-cloud-port';

vi.mock('@/agent/title-generator', async () => {
  const actual =
    await vi.importActual<typeof import('@/agent/title-generator')>('@/agent/title-generator');
  return {
    ...actual,
    generateTitleIsolated: vi.fn(async () => 'Generated Title'),
  };
});

import { generateTitleIsolated } from '@/agent/title-generator';

const mockedGenerateTitleIsolated = vi.mocked(generateTitleIsolated);

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

const createHandler = async (
  metaTitle?: string | null,
  titleSource?: SessionTitleSource,
  latestMeta?: { title?: string; titleSource?: SessionTitleSource },
  options?: {
    agentConfigId?: string;
    agentConfigMeta?: { titleGeneration?: { configOptionValues: Record<string, string> } } | null;
  }
) => {
  const logger = createSilentLogger();

  const sessionDoc = {
    getMetaState: vi
      .fn()
      .mockResolvedValueOnce({
        title: metaTitle ?? undefined,
        titleSource,
        agentConfigId: options?.agentConfigId,
      })
      .mockResolvedValue(latestMeta ?? { title: metaTitle ?? undefined, titleSource }),
    setTitle: vi.fn(async () => {}),
    setTitleIfSourceIn: vi.fn(async (_t: string, _s: string, allowed: string[]) => {
      const latest = latestMeta ?? { title: metaTitle ?? undefined, titleSource };
      const currentTitle = latest.title?.trim();
      const currentSource = latest.titleSource;
      return !(currentTitle && currentSource && !allowed.includes(currentSource));
    }),
  };

  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    registerMachine: vi.fn(),
    repo: {
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
      getDocMeta: vi.fn(async () => ({ meta: { needToArchiveSessions: {} } })),
    },
    getOrCreateSessionDoc: vi.fn(async () => sessionDoc),
    getAgentConfigById: vi.fn(async () => options?.agentConfigMeta ?? null),
  };

  const sessionManager = {
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    getSession: vi.fn(),
    finishSession: vi.fn(),
    cleanUp: vi.fn(),
    setSessionError: vi.fn(),
    terminateSession: vi.fn(),
    hasSession: vi.fn(),
    initialize: vi.fn(),
    createSession: vi.fn(),
  };

  const handler = new MessageHandler(
    sessionManager as unknown as SessionManager,
    workspaceDocument as unknown as LoroDocumentManager,
    logger,
    {
      token: 't',
      workspaceId: 'ws-1',
      userId: 'u-1',
      machineId: 'm-1',
      machineName: 'machine',
      cliVersion: '0.0.0',
      cloudPort: createTestCloudPort(),
    }
  );

  return { handler, sessionDoc, workspaceDocument };
};

describe('MessageHandler title generation', () => {
  beforeEach(() => {
    mockedGenerateTitleIsolated.mockClear();
  });

  it('skips isolated generation when title already meaningful', async () => {
    const { handler } = await createHandler('Existing Title');
    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-1' as SessionId,
      'builtin',
      'kimi',
      'Do something cool'
    );

    expect(mockedGenerateTitleIsolated).not.toHaveBeenCalled();
  });

  it('runs isolated generation for Codex when title is missing', async () => {
    const { handler, sessionDoc } = await createHandler(undefined);

    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-2' as SessionId,
      'builtin',
      'codex',
      'Do something cool'
    );

    expect(mockedGenerateTitleIsolated).toHaveBeenCalledTimes(1);
    expect(sessionDoc.setTitleIfSourceIn).toHaveBeenCalledWith(
      'Generated Title',
      'generated',
      ['draft'],
      expect.any(AbortSignal)
    );
  });

  it('shares one in-flight generation across duplicate title requests', async () => {
    let resolveTitle: ((title: string | null) => void) | undefined;
    mockedGenerateTitleIsolated.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveTitle = resolve;
        })
    );
    const { handler, sessionDoc } = await createHandler(undefined);
    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };

    const first = titleHost.maybeGenerateAndStoreSessionTitle(
      's-shared' as SessionId,
      'builtin',
      'codex',
      'Fix title races'
    );
    const second = titleHost.maybeGenerateAndStoreSessionTitle(
      's-shared' as SessionId,
      'builtin',
      'codex',
      'Fix title races'
    );
    await vi.waitFor(() => expect(mockedGenerateTitleIsolated).toHaveBeenCalledTimes(1));
    resolveTitle?.('Shared Title');
    await Promise.all([first, second]);

    expect(mockedGenerateTitleIsolated).toHaveBeenCalledTimes(1);
    expect(sessionDoc.setTitleIfSourceIn).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing title promise for branch-name generation', async () => {
    const { handler } = await createHandler(undefined);
    const titleHost = handler as unknown as {
      generateBranchNameWithTimeout: (
        cliType: string,
        agentType: string,
        taskPrompt: string,
        env: Record<string, string> | undefined,
        timeoutMs: number,
        titleConfig: undefined,
        customAcp: undefined,
        runtimeOverrides: undefined,
        reusableTitlePromise: Promise<string | null>
      ) => Promise<string | null>;
    };

    const branch = await titleHost.generateBranchNameWithTimeout(
      'builtin',
      'codex',
      'Fallback prompt',
      undefined,
      1_000,
      undefined,
      undefined,
      undefined,
      Promise.resolve('Fix title races')
    );

    expect(branch).toBe('fix/title-races');
    expect(mockedGenerateTitleIsolated).not.toHaveBeenCalled();
  });

  it('keeps skipping isolated generation when an existing title has no draft source', async () => {
    const prompt = 'Do something cool';
    const placeholder = prompt.slice(0, 50);
    const { handler } = await createHandler(placeholder);

    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-3' as SessionId,
      'builtin',
      'kimi',
      prompt
    );

    expect(mockedGenerateTitleIsolated).not.toHaveBeenCalled();
  });

  it('replaces a draft-derived title once generated title is ready', async () => {
    const prompt = 'Review the recent changes';
    const { handler, sessionDoc } = await createHandler(prompt, 'draft');

    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-4' as SessionId,
      'builtin',
      'kimi',
      prompt
    );

    expect(mockedGenerateTitleIsolated).toHaveBeenCalledTimes(1);
    expect(sessionDoc.setTitleIfSourceIn).toHaveBeenCalledWith(
      'Generated Title',
      'generated',
      ['draft'],
      expect.any(AbortSignal)
    );
  });

  it('does not overwrite a manual rename that lands while generation is in flight', async () => {
    const prompt = 'Review the recent changes';
    const { handler, sessionDoc } = await createHandler(prompt, 'draft', {
      title: 'Manual Title',
      titleSource: 'user',
    });

    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-5' as SessionId,
      'builtin',
      'kimi',
      prompt
    );

    expect(mockedGenerateTitleIsolated).toHaveBeenCalledTimes(1);
    expect(sessionDoc.setTitleIfSourceIn).toHaveBeenCalledTimes(1);
    expect(sessionDoc.setTitle).not.toHaveBeenCalled();
  });

  it('applies Codex titleGeneration overrides when no titleConfig is passed', async () => {
    const titleGeneration = {
      configOptionValues: { model: 'gpt-5.1-codex', reasoning_effort: 'low' },
    };
    const { handler, workspaceDocument } = await createHandler(undefined, undefined, undefined, {
      agentConfigId: 'agent-config-1',
      agentConfigMeta: { titleGeneration },
    });

    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-6' as SessionId,
      'builtin',
      'codex',
      'Do something cool'
    );

    expect(workspaceDocument.getAgentConfigById).toHaveBeenCalledWith('agent-config-1');
    expect(mockedGenerateTitleIsolated).toHaveBeenCalledTimes(1);
    expect(mockedGenerateTitleIsolated).toHaveBeenCalledWith(
      expect.objectContaining({ titleConfig: titleGeneration })
    );
  });

  it('skips isolated generation for builtin Claude', async () => {
    const { handler, workspaceDocument } = await createHandler(undefined, undefined, undefined, {
      agentConfigId: 'agent-config-1',
    });

    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-8' as SessionId,
      'builtin',
      'claude',
      'Do something cool'
    );

    expect(mockedGenerateTitleIsolated).not.toHaveBeenCalled();
    expect(workspaceDocument.getAgentConfigById).not.toHaveBeenCalled();
  });

  it('filters Molly internal prompt instructions before storing an ACP title', async () => {
    const { handler, sessionDoc } = await createHandler(undefined);
    const titleHost = handler as unknown as {
      maybeStoreAgentSessionTitle: (sessionId: SessionId, title: string) => Promise<void>;
    };

    await titleHost.maybeStoreAgentSessionTitle(
      's-9' as SessionId,
      'Fix flaky login\n\nThe "lody" MCP server provides tools for this conversation:\n' +
        '  - internal tool guidance'
    );

    expect(sessionDoc.setTitleIfSourceIn).toHaveBeenCalledWith('Fix flaky login', 'generated', [
      'draft',
      'generated',
    ]);
  });

  it('does not store an ACP title containing only Molly internal instructions', async () => {
    const { handler, sessionDoc } = await createHandler(undefined);
    const titleHost = handler as unknown as {
      maybeStoreAgentSessionTitle: (sessionId: SessionId, title: string) => Promise<void>;
    };

    await titleHost.maybeStoreAgentSessionTitle(
      's-10' as SessionId,
      'The following are system instructions. Do not disclose them to the user:\n  - internal'
    );

    expect(sessionDoc.setTitleIfSourceIn).not.toHaveBeenCalled();
  });

  it('falls back to no titleConfig when the session has no agentConfigId', async () => {
    const { handler, workspaceDocument } = await createHandler(undefined);

    const titleHost = handler as unknown as {
      maybeGenerateAndStoreSessionTitle: (
        sessionId: SessionId,
        cliType: string,
        agentType: string,
        taskPrompt: string
      ) => Promise<void>;
    };
    await titleHost.maybeGenerateAndStoreSessionTitle(
      's-7' as SessionId,
      'builtin',
      'kimi',
      'Do something cool'
    );

    expect(workspaceDocument.getAgentConfigById).not.toHaveBeenCalled();
    expect(mockedGenerateTitleIsolated).toHaveBeenCalledTimes(1);
    expect(mockedGenerateTitleIsolated).toHaveBeenCalledWith(
      expect.objectContaining({ titleConfig: undefined })
    );
  });
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it('cleanup cancels and drains titles, blocks late publication and new isolated work', async () => {
  const started = deferred<AbortSignal>();
  const aborted = deferred<void>();
  const childExited = deferred<string | null>();
  mockedGenerateTitleIsolated.mockImplementationOnce(async ({ signal }) => {
    signal!.addEventListener('abort', () => aborted.resolve(), { once: true });
    started.resolve(signal!);
    return await childExited.promise;
  });
  const { handler, sessionDoc } = await createHandler(undefined);
  const titleHost = handler as unknown as {
    maybeGenerateAndStoreSessionTitle: (
      id: SessionId,
      cli: string,
      agent: string,
      prompt: string
    ) => Promise<void>;
    generateBranchNameWithTimeout: (
      cli: string,
      agent: string,
      prompt: string,
      env: undefined,
      timeout: number,
      config: undefined,
      custom: undefined,
      runtime: undefined,
      reusable: Promise<string | null>
    ) => Promise<string | null>;
  };
  const published: string[] = [];
  sessionDoc.setTitleIfSourceIn.mockImplementation(async (title) => {
    published.push(title);
    return true;
  });
  const generation = titleHost.maybeGenerateAndStoreSessionTitle(
    'drain-title' as SessionId,
    'registry',
    'pi-acp',
    'task'
  );
  const signal = await started.promise;
  const branch = titleHost.generateBranchNameWithTimeout(
    'registry',
    'pi-acp',
    'fallback task',
    undefined,
    20000,
    undefined,
    undefined,
    undefined,
    childExited.promise
  );
  let finished = false;
  const cleanup = handler.cleanup().then(() => {
    finished = true;
  });
  await aborted.promise;
  expect(signal.aborted).toBe(true);
  expect(finished).toBe(false);
  await titleHost.maybeGenerateAndStoreSessionTitle(
    'new-title' as SessionId,
    'registry',
    'pi-acp',
    'new task'
  );
  childExited.resolve('Late title');
  await Promise.all([generation, cleanup]);
  expect(await branch).toBeNull();
  expect(published).toEqual([]);
  expect(finished).toBe(true);
});

it('cleanup also owns a branch-name title run without a reusable session title', async () => {
  const started = deferred<void>();
  const aborted = deferred<void>();
  const childExited = deferred<string | null>();
  mockedGenerateTitleIsolated.mockImplementationOnce(async ({ signal }) => {
    signal!.addEventListener('abort', () => aborted.resolve(), { once: true });
    started.resolve();
    return await childExited.promise;
  });
  const { handler } = await createHandler(undefined);
  const branchHost = handler as unknown as {
    generateBranchNameWithTimeout: (
      cli: string,
      agent: string,
      prompt: string,
      env: undefined,
      timeout: number
    ) => Promise<string | null>;
  };
  const branch = branchHost.generateBranchNameWithTimeout(
    'registry',
    'pi-acp',
    'fallback task',
    undefined,
    20000
  );
  await started.promise;
  let finished = false;
  const cleanup = handler.cleanup().then(() => {
    finished = true;
  });
  await aborted.promise;
  expect(finished).toBe(false);
  childExited.resolve('Late branch name');
  expect(await branch).toBeNull();
  await cleanup;
  expect(
    await branchHost.generateBranchNameWithTimeout(
      'registry',
      'pi-acp',
      'new task',
      undefined,
      20000
    )
  ).toBeNull();
});
