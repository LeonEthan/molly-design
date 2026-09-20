import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ACPSessionId, MachineId, SessionId, WorkspaceId } from '@molly/shared';
import type { Logger } from '@/utils/logger';

const connectionMocks = vi.hoisted(() => ({
  extMethod: vi.fn(),
  prompt: vi.fn(),
  initialize: vi.fn(),
  newSession: vi.fn(),
  loadSession: vi.fn(),
  resumeSession: vi.fn(),
  setSessionConfigOption: vi.fn(),
  unstable_forkSession: vi.fn(),
  closeSession: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: 1,
  ClientSideConnection: class {
    readonly closed = new Promise<void>(() => {});
    readonly extMethod = connectionMocks.extMethod;
    readonly prompt = connectionMocks.prompt;
    readonly initialize = connectionMocks.initialize;
    readonly newSession = connectionMocks.newSession;
    readonly loadSession = connectionMocks.loadSession;
    readonly resumeSession = connectionMocks.resumeSession;
    readonly setSessionConfigOption = connectionMocks.setSessionConfigOption;
    readonly unstable_forkSession = connectionMocks.unstable_forkSession;
    readonly closeSession = connectionMocks.closeSession;
    readonly cancel = connectionMocks.cancel;
  },
}));

import { AgentClient } from './agent-client';
import { applyAcpSessionRunConfig } from '@/session/acp-session-config-applier';

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
    setDebug: vi.fn(),
    child: vi.fn(() => logger),
    close: vi.fn(async () => undefined),
  };
  return logger;
}

describe('AgentClient session preparation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMocks.initialize.mockResolvedValue({ agentCapabilities: {} });
    connectionMocks.newSession.mockResolvedValue({ sessionId: 'acp-session-1' });
  });

  it('initializes before the claim and starts the ACP session only with the claimed workdir', async () => {
    const target = deferred<{ workdir: string }>();
    const stages: string[] = [];
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-1' as SessionId,
      terminalManager: {} as never,
      onStartupStage: (event) => stages.push(event.type),
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    const startPromise = client.startSession(
      {} as never,
      '/provisional',
      undefined,
      {},
      undefined,
      async () => await target.promise
    );

    await vi.waitFor(() => expect(stages).toEqual(['initialize_start', 'initialize_end']));
    expect(connectionMocks.initialize).toHaveBeenCalledTimes(1);
    expect(connectionMocks.newSession).not.toHaveBeenCalled();
    expect(stages).toEqual(['initialize_start', 'initialize_end']);

    target.resolve({ workdir: '/claimed' });
    await expect(startPromise).resolves.toEqual({ sessionId: 'acp-session-1' });
    expect(connectionMocks.newSession).toHaveBeenCalledWith({
      cwd: '/claimed',
      mcpServers: [],
    });
    expect(stages).toEqual([
      'initialize_start',
      'initialize_end',
      'new_session_start',
      'new_session_end',
    ]);
  });

  it('starts initial and replacement sessions with selected config option values', async () => {
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-grok' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'grok' },
      configOptionValues: { permission_mode: 'always-approve' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');

    expect(connectionMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        _meta: { clientIdentifier: 'lody:session-grok' },
      })
    );
    expect(connectionMocks.newSession).toHaveBeenCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        clientIdentifier: 'lody:session-grok',
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: { permission_mode: 'always-approve' },
          },
        },
      },
    });

    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });
    await client.prepareReplacementSession();

    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        clientIdentifier: 'lody:session-grok',
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: { permission_mode: 'always-approve' },
          },
        },
      },
    });
  });

  it('sends initial config without provider-specific startup fields', async () => {
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-neutral-config' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'codex' },
      configOptionValues: { approval_policy: 'never' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');

    expect(connectionMocks.newSession).toHaveBeenCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: { approval_policy: 'never' },
          },
        },
      },
    });
  });

  it('carries successful live config changes into replacement session startup', async () => {
    connectionMocks.setSessionConfigOption.mockResolvedValue({});
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-grok-switch' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'grok' },
      configOptionValues: { permission_mode: 'ask' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');
    await client.setSessionConfigOption(
      'acp-session-1' as never,
      'permission_mode',
      'always-approve'
    );

    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });
    await client.prepareReplacementSession();
    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        clientIdentifier: 'lody:session-grok-switch',
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: { permission_mode: 'always-approve' },
          },
        },
      },
    });

    await client.setSessionConfigOption('acp-session-1' as never, 'permission_mode', 'ask');
    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-3' });
    await client.prepareReplacementSession();
    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        clientIdentifier: 'lody:session-grok-switch',
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: { permission_mode: 'ask' },
          },
        },
      },
    });
  });

  it('projects a legacy acknowledged value and carries the same value into replacement startup', async () => {
    connectionMocks.newSession.mockResolvedValueOnce({
      sessionId: 'acp-session-1',
      configOptions: [
        {
          id: 'effort',
          category: 'thought_level',
          type: 'select',
          name: 'Effort',
          currentValue: 'low',
          options: [
            { value: 'low', name: 'Low' },
            { value: 'high', name: 'High' },
          ],
        },
      ],
    });
    connectionMocks.setSessionConfigOption.mockResolvedValue({});
    const logger = createLogger();
    const client = new AgentClient({
      logger,
      sessionId: 'session-legacy-projection' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'codex' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');
    const result = await applyAcpSessionRunConfig({
      session: {
        sessionId: 'session-legacy-projection' as SessionId,
        acpSessionId: 'acp-session-1' as never,
        agentClient: client,
      },
      config: { configOptionValues: { effort: 'high' } },
      logger,
    });

    expect(result.runtimeConfigPatch).toEqual({
      acpSessionId: 'acp-session-1',
      configOptionValues: { effort: 'high' },
    });

    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });
    await client.prepareReplacementSession();
    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: { effort: 'high' },
          },
        },
      },
    });
  });

  it('treats an empty set-config response as an authoritative full snapshot', async () => {
    connectionMocks.setSessionConfigOption.mockResolvedValue({ configOptions: [] });
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-empty-config-snapshot' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'codex' },
      configOptionValues: { collaboration_mode: 'plan', reasoning_effort: 'high' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');
    await client.setSessionConfigOption('acp-session-1' as never, 'collaboration_mode', 'default');

    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });
    await client.prepareReplacementSession();
    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
    });
  });

  it('uses accepted Grok config for permission decisions and notifies pending requests', async () => {
    const permissions = (currentValue: string) => [
      {
        id: 'permission_mode',
        category: '_permission',
        type: 'select' as const,
        name: 'Permissions',
        currentValue,
        options: [],
      },
    ];
    connectionMocks.newSession.mockResolvedValueOnce({
      sessionId: 'acp-session-1',
      configOptions: permissions('ask'),
    });
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'grok-config' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'grok' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });
    await client.startSession({} as never, '/workdir');
    const request = {
      sessionId: 'acp-session-1',
      toolCall: { toolCallId: 'tool' },
      options: [{ kind: 'allow_once' as const, optionId: 'once', name: 'Once' }],
    };
    const outcomes: unknown[] = [];
    const unsubscribe = client.subscribeConfigOptions(() => {
      outcomes.push(client.getAutomaticToolPermissionOutcome(request, true));
    });
    const response = deferred<{ configOptions: ReturnType<typeof permissions> }>();
    connectionMocks.setSessionConfigOption.mockReturnValueOnce(response.promise);
    const setting = client.setSessionConfigOption(
      'acp-session-1' as never,
      'permission_mode',
      'always-approve'
    );
    expect(client.getAutomaticToolPermissionOutcome(request, false)).toBeUndefined();
    response.resolve({ configOptions: permissions('always-approve') });
    await setting;
    expect(outcomes).toEqual([{ outcome: 'selected', optionId: 'once' }]);
    expect(
      client.getAutomaticToolPermissionOutcome({ ...request, sessionId: 'other' }, true)
    ).toBeUndefined();

    // Runtime rejection preserves the accepted state and cannot spuriously drain requests.
    connectionMocks.setSessionConfigOption.mockRejectedValueOnce(new Error('unsupported value'));
    await expect(
      client.setSessionConfigOption('acp-session-1' as never, 'permission_mode', 'ask')
    ).rejects.toThrow('unsupported value');
    expect(outcomes).toHaveLength(1);

    connectionMocks.setSessionConfigOption.mockResolvedValueOnce({});
    await client.setSessionConfigOption('acp-session-1' as never, 'permission_mode', 'ask');
    expect(outcomes).toEqual([{ outcome: 'selected', optionId: 'once' }, undefined]);
    await client.sessionUpdate({
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: permissions('always-approve'),
      },
    } as never);
    expect(outcomes.at(-1)).toEqual({ outcome: 'selected', optionId: 'once' });
    unsubscribe();
    connectionMocks.setSessionConfigOption.mockResolvedValueOnce({ configOptions: [] });
    await client.setSessionConfigOption('acp-session-1' as never, 'permission_mode', 'ask');
    expect(client.getAutomaticToolPermissionOutcome(request, false)).toBeUndefined();
    expect(outcomes).toHaveLength(3);
  });

  it('carries agent-originated config updates into replacement session startup', async () => {
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-agent-config-update' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'codex' },
      configOptionValues: { collaboration_mode: 'plan', reasoning_effort: 'high' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');
    await client.sessionUpdate({
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'collaboration_mode',
            category: 'collaboration_mode',
            type: 'select',
            name: 'Collaboration mode',
            currentValue: 'default',
            options: [],
          },
          {
            id: 'reasoning_effort',
            category: 'thought_level',
            type: 'select',
            name: 'Reasoning effort',
            currentValue: 'low',
            options: [],
          },
        ],
      },
    } as never);

    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });
    await client.prepareReplacementSession();

    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: {
              collaboration_mode: 'default',
              reasoning_effort: 'low',
            },
          },
        },
      },
    });
  });

  it('loads sessions with selected config option values', async () => {
    connectionMocks.initialize.mockResolvedValue({
      agentCapabilities: { loadSession: true },
    });
    connectionMocks.loadSession.mockResolvedValue({});
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-grok-load' as SessionId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'grok' },
      configOptionValues: { permission_mode: 'always-approve' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir', 'stored-grok-session' as never);

    expect(connectionMocks.loadSession).toHaveBeenCalledWith({
      sessionId: 'stored-grok-session',
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        clientIdentifier: 'lody:session-grok-load',
        lody: {
          sessionConfig: {
            version: 1,
            configOptionValues: { permission_mode: 'always-approve' },
          },
        },
      },
    });
  });

  it('injects Molly MCP into DeepSeek Harness sessions', async () => {
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-deepseek' as SessionId,
      workspaceId: 'workspace-1' as WorkspaceId,
      machineId: 'machine-1' as MachineId,
      terminalManager: {} as never,
      agentConfig: { cliType: 'builtin', agentType: 'deepseek' },
      taskToolsEnabled: true,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    await client.startSession({} as never, '/workdir');

    expect(connectionMocks.newSession).toHaveBeenCalledWith({
      cwd: '/workdir',
      mcpServers: [
        expect.objectContaining({
          name: 'molly',
          command: process.execPath,
          args: expect.arrayContaining(['__internal', 'molly-mcp-server']),
          env: expect.arrayContaining([
            { name: 'MOLLY_MCP_SESSION_ID', value: 'session-deepseek' },
            { name: 'MOLLY_MCP_WORKSPACE_ID', value: 'workspace-1' },
            { name: 'MOLLY_MCP_MACHINE_ID', value: 'machine-1' },
            { name: 'MOLLY_MCP_WORKDIR', value: '/workdir' },
            { name: 'MOLLY_MCP_TASK_TOOLS_ENABLED', value: '1' },
          ]),
        }),
      ],
    });
  });

  it('aborts while waiting for a claim without creating an ACP session', async () => {
    const target = deferred<{ workdir: string }>();
    const startupAbort = deferred<never>();
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-aborted' as SessionId,
      terminalManager: {} as never,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });

    const startPromise = client.startSession(
      {} as never,
      '/provisional',
      undefined,
      {},
      startupAbort.promise,
      async () => await target.promise
    );
    await vi.waitFor(() => expect(connectionMocks.initialize).toHaveBeenCalledTimes(1));

    const abortError = new Error('preparation cancelled');
    abortError.name = 'AbortError';
    startupAbort.reject(abortError);

    await expect(startPromise).rejects.toBe(abortError);
    expect(connectionMocks.newSession).not.toHaveBeenCalled();
  });

  it('prepares a turn-addressed fork before adopting it', async () => {
    connectionMocks.initialize.mockResolvedValue({
      agentCapabilities: {
        sessionCapabilities: { fork: {}, close: {} },
        _meta: { lody: { forkAtTurn: { version: 1 } } },
      },
    });
    connectionMocks.unstable_forkSession.mockResolvedValue({ sessionId: 'acp-session-2' });
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-fork' as SessionId,
      terminalManager: {} as never,
      configOptionValues: { interaction_mode: 'plan' },
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });
    await client.startSession({} as never, '/workdir');

    const prepared = await client.prepareReplacementSession('provider-turn-1');

    expect(prepared).toEqual({ sessionId: 'acp-session-2' });
    expect(connectionMocks.unstable_forkSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'acp-session-1',
        cwd: '/workdir',
        _meta: {
          lody: {
            forkAtTurn: { version: 1, turnId: 'provider-turn-1' },
            sessionConfig: {
              version: 1,
              configOptionValues: { interaction_mode: 'plan' },
            },
          },
        },
      })
    );
    await client.cancel('acp-session-1' as never);
    expect(connectionMocks.cancel).toHaveBeenCalledWith({ sessionId: 'acp-session-1' });

    client.adoptPreparedSession(prepared);
    await client.closeDetachedSession('acp-session-1' as never);
    expect(connectionMocks.closeSession).toHaveBeenCalledWith({ sessionId: 'acp-session-1' });
  });

  it('prepares a fresh provider session for editing the first user message', async () => {
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'session-first' as SessionId,
      terminalManager: {} as never,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });
    await client.startSession({} as never, '/workdir');
    connectionMocks.newSession.mockResolvedValueOnce({ sessionId: 'acp-session-2' });

    await expect(client.prepareReplacementSession()).resolves.toEqual({
      sessionId: 'acp-session-2',
    });
    expect(connectionMocks.newSession).toHaveBeenLastCalledWith({
      cwd: '/workdir',
      mcpServers: [],
    });
  });
});

describe('retired design hook startup options', () => {
  it('does not forward old hook options during initial or replacement session setup', async () => {
    const requests: unknown[] = [];
    const methods: string[] = [];
    connectionMocks.initialize.mockResolvedValue({ agentCapabilities: {} });
    connectionMocks.newSession.mockImplementation(async (request) => {
      requests.push(request);
      return { sessionId: 'synthetic-native' };
    });
    connectionMocks.extMethod.mockImplementation(async (method: string) => {
      methods.push(method);
      throw new Error('Retired hook reload must not run');
    });
    // Structural extra fields model an older in-memory caller without adding
    // these retired options back to the product interface.
    const options = {
      logger: createLogger(),
      sessionId: 'molly-design' as SessionId,
      terminalManager: {} as never,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
      grokDesignReminderPluginDir: '/molly/grok-plugin',
      claudeDesignHookSettings: { hooks: { UserPromptSubmit: [{ command: 'retired' }] } },
      configOptionValues: { model: 'synthetic-explicit-model' },
    };
    const client = new AgentClient(options);
    expect((await client.startSession({} as never, '/workdir')).sessionId).toBe('synthetic-native');
    expect((await client.prepareReplacementSession()).sessionId).toBe('synthetic-native');
    const expected = {
      cwd: '/workdir',
      mcpServers: [],
      _meta: {
        lody: { sessionConfig: { version: 1, configOptionValues: options.configOptionValues } },
      },
    };
    expect(requests).toEqual([expected, expected]);
    expect(methods).toEqual([]);
  });
});

describe('Grok explicit Stop residency', () => {
  async function createGrok() {
    connectionMocks.initialize.mockResolvedValue({
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
    });
    connectionMocks.newSession.mockResolvedValue({ sessionId: 'grok-resident' });
    const client = new AgentClient({
      logger: createLogger(),
      sessionId: 'grok-task' as SessionId,
      agentConfig: { cliType: 'builtin', agentType: 'grok' },
      terminalManager: {} as never,
      onUpdateMessage: vi.fn(),
      onRequestPermission: vi.fn(),
    });
    await client.startSession({} as never, '/synthetic-project');
    return client;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMocks.prompt.mockResolvedValue({ stopReason: 'end_turn' });
  });

  it('waits for actual closure, refuses stopped prompts, then loads only for explicit continuation', async () => {
    const events: string[] = [];
    const closed = deferred<{ _meta: { 'x.ai/closeOutcome': string } }>();
    connectionMocks.closeSession.mockImplementation(async () => {
      events.push('close');
      return closed.promise;
    });
    connectionMocks.loadSession.mockImplementation(async (request) => {
      events.push('load:' + request.sessionId);
      return {};
    });
    connectionMocks.prompt.mockImplementation(async () => {
      events.push('prompt');
      return { stopReason: 'end_turn' };
    });
    const client = await createGrok();
    const sessionId = 'grok-resident' as ACPSessionId;
    const stopped = client.closeAfterStop(sessionId)!;
    expect(client.closeAfterStop(sessionId)).toBe(stopped);
    await expect(client.prompt(sessionId, [])).rejects.toThrow('resident session is stopped');
    closed.resolve({ _meta: { 'x.ai/closeOutcome': 'closed' } });
    await stopped;
    expect(events).toEqual(['close']);
    await expect(client.prompt(sessionId, [])).rejects.toThrow('resident session is stopped');
    await client.resumeAfterStop(sessionId);
    await client.prompt(sessionId, [{ type: 'text', text: 'new explicit input' }]);
    expect(events).toEqual(['close', 'load:grok-resident', 'prompt']);
  });

  it.each([undefined, 'superseded', 'unknown'])(
    'rejects unconfirmed native close outcome %s without loading or prompting',
    async (outcome) => {
      connectionMocks.closeSession.mockResolvedValue({ _meta: { 'x.ai/closeOutcome': outcome } });
      const client = await createGrok();
      const sessionId = 'grok-resident' as ACPSessionId;
      await expect(client.closeAfterStop(sessionId)).rejects.toThrow('could not confirm closure');
      await expect(client.resumeAfterStop(sessionId)).rejects.toThrow('could not confirm closure');
      await expect(client.prompt(sessionId, [])).rejects.toThrow('resident session is stopped');
    }
  );

  it('requires an explicit retry after a failed close and can then resume', async () => {
    connectionMocks.closeSession
      .mockRejectedValueOnce(Error('transport failed'))
      .mockResolvedValue({ _meta: { 'x.ai/closeOutcome': 'notResident' } });
    connectionMocks.loadSession.mockResolvedValue({});
    const client = await createGrok();
    const sessionId = 'grok-resident' as ACPSessionId;
    await expect(client.closeAfterStop(sessionId)).rejects.toThrow('could not confirm closure');
    await expect(client.resumeAfterStop(sessionId)).rejects.toThrow('could not confirm closure');
    await client.retryCloseAfterStop(sessionId);
    await client.resumeAfterStop(sessionId);
    await expect(
      client.prompt(sessionId, [{ type: 'text', text: 'explicit new input' }])
    ).resolves.toEqual({ stopReason: 'end_turn' });
  });

  it('does not treat a close timeout as a terminal resident state', async () => {
    const client = await createGrok();
    connectionMocks.closeSession.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const stopped = client.closeAfterStop('grok-resident' as ACPSessionId);
      const rejected = expect(stopped).rejects.toThrow('could not confirm closure');
      await vi.advanceTimersByTimeAsync(10000);
      await rejected;
      await expect(client.prompt('grok-resident' as ACPSessionId, [])).rejects.toThrow(
        'resident session is stopped'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['closed', 'notResident'])(
    'retains late %s evidence and coalesces retries after timeout',
    async (outcome) => {
      const response = deferred<{ _meta: { 'x.ai/closeOutcome': string } }>();
      const entered = deferred<void>();
      const events: string[] = [];
      connectionMocks.closeSession.mockImplementation(() => {
        events.push('close');
        entered.resolve();
        return response.promise;
      });
      connectionMocks.loadSession.mockImplementation(async () => {
        events.push('load');
        return {};
      });
      const client = await createGrok();
      const sessionId = 'grok-resident' as ACPSessionId;
      vi.useFakeTimers();
      try {
        const waiting = client.closeAfterStop(sessionId);
        const failedWait = expect(waiting).rejects.toThrow('could not confirm closure');
        const nativeCompletion = client.nativeStopCompletion;
        await entered.promise;
        await vi.advanceTimersByTimeAsync(10000);
        await failedWait;
        const retry = client.retryCloseAfterStop(sessionId);
        expect(client.retryCloseAfterStop(sessionId)).toBe(retry);
        expect(client.nativeStopCompletion).toBe(nativeCompletion);
        await vi.advanceTimersByTimeAsync(0);
        expect(events).toEqual(['close']);
        response.resolve({ _meta: { 'x.ai/closeOutcome': outcome } });
        await retry;
        await nativeCompletion;
        await expect(client.prompt(sessionId, [])).rejects.toThrow('resident session is stopped');
        expect(events).toEqual(['close']);
        await client.resumeAfterStop(sessionId);
        expect(events).toEqual(['close', 'load']);
        expect(client.nativeStopCompletion).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('waits for the original load RPC after timeout before retrying close', async () => {
    const events: string[] = [];
    const loading = deferred<void>(),
      originalLoad = deferred<Record<string, never>>();
    connectionMocks.closeSession.mockImplementation(async () => {
      events.push('close');
      return { _meta: { 'x.ai/closeOutcome': 'notResident' } };
    });
    connectionMocks.loadSession.mockImplementation(async () => {
      events.push('load');
      loading.resolve();
      return originalLoad.promise;
    });
    const client = await createGrok();
    const sessionId = 'grok-resident' as ACPSessionId;
    await client.closeAfterStop(sessionId);
    vi.useFakeTimers();
    try {
      const restoration = client.resumeAfterStop(sessionId);
      const timedOut = expect(restoration).rejects.toThrow();
      await loading.promise;
      await vi.advanceTimersByTimeAsync(120000);
      await timedOut;
      const closing = client.retryCloseAfterStop(sessionId);
      await vi.advanceTimersByTimeAsync(10000);
      expect(events).toEqual(['close', 'load']);
      await expect(client.prompt(sessionId, [])).rejects.toThrow('resident session is stopped');
      originalLoad.resolve({});
      await closing;
      expect(events).toEqual(['close', 'load', 'close']);
      await expect(client.prompt(sessionId, [])).rejects.toThrow('resident session is stopped');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes a restore cancelled while native load is still pending', async () => {
    const events: string[] = [];
    const loading = deferred<void>(),
      loaded = deferred<Record<string, never>>();
    connectionMocks.closeSession.mockImplementation(async () => {
      events.push('closed');
      return { _meta: { 'x.ai/closeOutcome': 'closed' } };
    });
    connectionMocks.loadSession.mockImplementation(async () => {
      events.push('loading');
      loading.resolve();
      return loaded.promise;
    });
    const client = await createGrok();
    const sessionId = 'grok-resident' as ACPSessionId;
    await client.closeAfterStop(sessionId);
    const restore = client.resumeAfterStop(sessionId);
    await loading.promise;
    const stopped = client.closeAfterStop(sessionId);
    expect(events).toEqual(['closed', 'loading']);
    loaded.resolve({});
    await restore;
    await stopped;
    expect(events).toEqual(['closed', 'loading', 'closed']);
    await expect(client.prompt(sessionId, [])).rejects.toThrow('resident session is stopped');
  });
});
