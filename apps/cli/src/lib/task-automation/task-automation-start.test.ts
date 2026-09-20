import { Flock } from '@loro-dev/flock-wasm';
import { LoroDoc } from 'loro-crdt';
import { Mirror } from 'loro-mirror';
import {
  getTaskRoomId,
  getSessionRoomId,
  getTaskIndexFlockDocId,
  taskDocSchema,
  type MachineId,
  type TaskDocMeta,
  type TaskId,
  type WorkspaceId,
  type SessionId,
  type SessionMeta,
} from '@molly/shared';
import { encodeMollyModelOption } from '@molly/shared/embedded-harness';
import { describe, expect, it } from 'vitest';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import { readTask, linkTaskSessionFromCli } from '@/lib/task-doc';
import { startDelegatedTask, type TaskAutomationStartDeps } from './task-automation-start';
import { recoverTaskAutomationStatuses } from './task-automation-recovery';

const taskId = 'synthetic-task' as TaskId;
const agentConfigId = 'synthetic-molly';
const modelId = encodeMollyModelOption('synthetic-connection', 'synthetic-model');
const meta: TaskDocMeta = {
  taskId,
  title: 'Synthetic delegated task',
  ownerId: 'synthetic-user',
  status: 'backlog',
  order: 'z0',
  createdAt: 1,
  updatedAt: 1,
  agent: { agentConfigId, modelId, configOptionValues: { reasoning_effort: 'high' } },
  projects: [{ kind: 'local', localProjectId: 'synthetic-project' }],
};

function fixture(overrides: Partial<TaskDocMeta> = {}) {
  const doc = new LoroDoc();
  const seed = new Mirror({
    doc,
    schema: taskDocSchema,
    initialState: { meta, body: '', links: [], timeline: [] },
  });
  seed.setState((draft) => {
    Object.assign(draft.meta, { ...meta, ...overrides });
    draft.body = 'Synthetic task instructions.';
  });
  seed.dispose();
  const index = new Flock('synthetic-index');
  const existence = new Flock('synthetic-existence');
  existence.set(['e', getTaskRoomId(taskId)], true);
  const sessionMeta = new Map<string, Partial<SessionMeta>>();
  const manager = {
    syncDocOrThrow: async () => {},
    repo: {
      getMeta: () => existence,
      getDocMeta: async (id: string) =>
        sessionMeta.has(id) ? { meta: sessionMeta.get(id) } : undefined,
      upsertDocMeta: async (id: string, patch: Partial<SessionMeta>) => {
        sessionMeta.set(id, { ...sessionMeta.get(id), ...patch });
      },
      openPersistedDoc: async (id: string) => {
        if (id !== getTaskRoomId(taskId)) throw new Error('unexpected task');
        return { doc, syncOnce: async () => {} };
      },
      openFlockDoc: async (id: string) => {
        if (id !== getTaskIndexFlockDocId('synthetic-workspace' as WorkspaceId))
          throw new Error(`unexpected index ${id}`);
        return { flock: index, syncOnce: async () => {} };
      },
      flush: async () => {},
    },
  } as unknown as LoroDocumentManager;
  const dispatched: Parameters<TaskAutomationStartDeps['createSession']>[0][] = [];
  const deps: TaskAutomationStartDeps = {
    auth: {
      token: 'unused-synthetic',
      userId: 'synthetic-user',
      userName: 'Synthetic',
      userEmail: 'synthetic@example.invalid',
      machineId: 'synthetic-machine' as MachineId,
      machineName: 'Synthetic machine',
    },
    workspace: { id: 'synthetic-workspace', name: 'Synthetic', slug: null, role: 'owner' },
    manager,
    logger: { debug: () => {} } as TaskAutomationStartDeps['logger'],
    createSession: async (args) => {
      expect((await readTask(manager, taskId))?.meta.status).toBe('backlog');
      dispatched.push(args);
      const roomId = getSessionRoomId('synthetic-session' as SessionId);
      existence.set(['e', roomId], true);
      sessionMeta.set(roomId, {
        id: 'synthetic-session' as SessionId,
        machineId: deps.auth.machineId,
        userId: deps.auth.userId,
        cliType: 'builtin',
        agentType: 'molly',
        agentConfigId,
        taskId,
        latestUserMsgId: 'synthetic-turn',
        taskAutomationStatusRepair: {
          version: 1,
          dispatchState: 'dispatched',
          taskId,
          agentConfigId,
          ownerId: deps.auth.userId,
          taskStateHash: String(args.options.taskAutomationStateHash),
          userTurnId: 'synthetic-turn',
        },
      });
      return { sessionId: 'synthetic-session' };
    },
  };
  return { deps, manager, dispatched, index, doc, sessionMeta, existence };
}

describe('delegated task start with persisted run configuration', () => {
  const recoveryDeps = ({ deps }: ReturnType<typeof fixture>) => ({
    manager: deps.manager,
    workspaceId: deps.workspace.id as WorkspaceId,
    machineId: deps.auth.machineId,
    userId: deps.auth.userId,
  });

  it('repairs after reopening persisted Task bytes without retaining the dispatch callback', async () => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    const restored = new LoroDoc();
    restored.import(f.doc.export({ mode: 'snapshot' }));
    f.manager.repo.openPersistedDoc = async (id) => {
      if (id !== getTaskRoomId(taskId)) throw new Error('must not open Session history');
      return { doc: restored, syncOnce: async () => {} } as never;
    };
    await recoverTaskAutomationStatuses(recoveryDeps(f));
    expect((await readTask(f.manager, taskId))?.meta.status).toBe('in_progress');
    expect(
      f.sessionMeta.get(getSessionRoomId('synthetic-session'))?.taskAutomationStatusRepair
    ).toBeUndefined();
    expect(f.dispatched.map((args) => args.options.taskId)).toEqual([taskId]);
  });

  it('allows the dispatch-owned Task link while preserving the snapshot guard', async () => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    await linkTaskSessionFromCli(
      f.manager,
      f.deps.workspace.id as WorkspaceId,
      taskId,
      { sessionId: 'synthetic-session', origin: 'run' },
      { agentConfigId }
    );
    await recoverTaskAutomationStatuses(recoveryDeps(f));
    expect((await readTask(f.manager, taskId))?.meta.status).toBe('in_progress');
  });

  it('retains prepared-only evidence as an unknown outcome without reopening Task or Session', async () => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    const roomId = getSessionRoomId('synthetic-session');
    const record = f.sessionMeta.get(roomId);
    if (!record?.taskAutomationStatusRepair) throw new Error('missing fixture receipt');
    record.taskAutomationStatusRepair.dispatchState = 'prepared';
    f.manager.repo.openPersistedDoc = async () => {
      throw new Error('must not open documents');
    };
    await expect(recoverTaskAutomationStatuses(recoveryDeps(f))).rejects.toThrow(
      'task_automation_dispatch_outcome_unknown'
    );
    expect(record.taskAutomationStatusRepair.dispatchState).toBe('prepared');
    expect(f.dispatched.map((args) => args.options.taskId)).toEqual([taskId]);
  });

  it('retries persistence of a cleared receipt before declaring recovery complete', async () => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    const roomId = getSessionRoomId('synthetic-session');
    let durableReceipt = structuredClone(f.sessionMeta.get(roomId)?.taskAutomationStatusRepair);
    let failClear = true;
    f.manager.repo.flush = async () => {
      const current = f.sessionMeta.get(roomId)?.taskAutomationStatusRepair;
      if (current === undefined && failClear) throw new Error('clear not durable');
      durableReceipt = structuredClone(current);
    };
    await expect(recoverTaskAutomationStatuses(recoveryDeps(f))).rejects.toThrow(
      'clear not durable'
    );
    expect(f.sessionMeta.get(roomId)?.taskAutomationStatusRepair).toBeUndefined();
    expect(durableReceipt).toBeDefined();
    await expect(recoverTaskAutomationStatuses(recoveryDeps(f))).rejects.toThrow(
      'clear not durable'
    );
    failClear = false;
    await recoverTaskAutomationStatuses(recoveryDeps(f));
    expect(durableReceipt).toBeUndefined();
    expect((await readTask(f.manager, taskId))?.meta.status).toBe('in_progress');
    expect(f.dispatched.map((args) => args.options.taskId)).toEqual([taskId]);
  });

  it('keeps the receipt after a Task flush failure and finishes on a fresh recovery pass', async () => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    f.manager.repo.flush = async () => {
      throw new Error('disk unavailable');
    };
    await expect(recoverTaskAutomationStatuses(recoveryDeps(f))).rejects.toThrow(
      'disk unavailable'
    );
    expect(
      f.sessionMeta.get(getSessionRoomId('synthetic-session'))?.taskAutomationStatusRepair
    ).toBeDefined();
    f.manager.repo.flush = async () => {};
    await recoverTaskAutomationStatuses(recoveryDeps(f));
    expect(f.index.get(['task', taskId])).toMatchObject({ status: 'in_progress' });
    expect(
      (await readTask(f.manager, taskId))?.timeline.filter(
        (e) => e.activityType === 'status_changed'
      )
    ).toHaveLength(1);
  });

  it.each([
    { status: 'todo' },
    { agent: { ...meta.agent, modelId: encodeMollyModelOption('other', 'model') } },
    { projects: [{ kind: 'local', localProjectId: 'other-project' }] },
  ])('preserves later consent/task changes during recovery %#', async (change) => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    for (const [key, value] of Object.entries(change)) f.doc.getMap('meta').set(key, value);
    f.doc.commit();
    const before = await readTask(f.manager, taskId);
    await recoverTaskAutomationStatuses(recoveryDeps(f));
    expect(await readTask(f.manager, taskId)).toEqual(before);
  });

  it.each([{ machineId: 'foreign-machine' }, { userId: 'foreign-user' }])(
    'ignores another execution owner before opening a Task %#',
    async (change) => {
      const f = fixture();
      await startDelegatedTask(f.deps, taskId, agentConfigId);
      const roomId = getSessionRoomId('synthetic-session');
      f.sessionMeta.set(roomId, { ...f.sessionMeta.get(roomId), ...change });
      f.manager.repo.openPersistedDoc = async () => {
        throw new Error('foreign Task opened');
      };
      await recoverTaskAutomationStatuses(recoveryDeps(f));
      expect(f.sessionMeta.get(roomId)?.taskAutomationStatusRepair).toBeDefined();
    }
  );

  it('fails closed on malformed repair metadata without opening a Task', async () => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    const roomId = getSessionRoomId('synthetic-session');
    const stored = f.sessionMeta.get(roomId);
    if (!stored?.taskAutomationStatusRepair) throw new Error('missing synthetic receipt');
    f.sessionMeta.set(roomId, {
      ...stored,
      taskAutomationStatusRepair: {
        ...stored.taskAutomationStatusRepair,
        taskStateHash: 'invalid',
      },
    });
    f.manager.repo.openPersistedDoc = async () => {
      throw new Error('must not open');
    };
    await expect(recoverTaskAutomationStatuses(recoveryDeps(f))).rejects.toThrow();
    expect(f.doc.getMap('meta').get('status')).toBe('backlog');
  });

  it('does not recreate a missing Task during recovery', async () => {
    const f = fixture();
    await startDelegatedTask(f.deps, taskId, agentConfigId);
    f.existence.set(['e', getTaskRoomId(taskId)], false);
    f.manager.repo.openPersistedDoc = async () => {
      throw new Error('must not recreate Task');
    };
    await recoverTaskAutomationStatuses(recoveryDeps(f));
    expect(
      f.sessionMeta.get(getSessionRoomId('synthetic-session'))?.taskAutomationStatusRepair
    ).toBeUndefined();
  });
  it('passes the explicit model and thinking to dispatch and only then advances status', async () => {
    const { deps, manager, dispatched, index } = fixture();
    const dispatchedTask = await startDelegatedTask(deps, taskId, agentConfigId);
    expect((await readTask(manager, taskId))?.meta.status).toBe('backlog');
    await dispatchedTask.settle();
    expect(
      dispatched.map(({ dispatchConfig, options, prompt }) => ({ dispatchConfig, options, prompt }))
    ).toEqual([
      {
        dispatchConfig: {
          modelId,
          configOptionValues: { reasoning_effort: 'high' },
          taskToolsEnabled: true,
          inheritSessionDefaults: false,
        },
        options: {
          agentConfig: agentConfigId,
          taskId,
          taskLinkOrigin: 'run',
          taskAutomationStateHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          title: meta.title,
          localProject: 'synthetic-project',
        },
        prompt: expect.stringContaining('Synthetic task instructions.'),
      },
    ]);
    expect((await readTask(manager, taskId))?.meta).toMatchObject({
      status: 'in_progress',
      agent: meta.agent,
    });
    expect(index.get(['task', taskId])).toMatchObject({ status: 'in_progress' });
  });

  it.each([
    { agent: undefined },
    { agent: { ...meta.agent, agentConfigId: 'different-agent' } },
    { ownerId: 'different-user' },
    { status: 'done' as const },
    { status: 'in_progress' as const },
  ])(
    'rejects changed consent or eligibility without dispatch or rewriting the task %#',
    async (overrides) => {
      const { deps, manager, dispatched } = fixture(overrides);
      const before = await readTask(manager, taskId);
      await expect(startDelegatedTask(deps, taskId, agentConfigId)).rejects.toThrow(
        'task_automation_consent_changed'
      );
      expect(dispatched).toEqual([]);
      expect(await readTask(manager, taskId)).toEqual(before);
    }
  );

  it.each([
    { agentConfigId },
    { ...meta.agent, agentConfigId, modeId: 'legacy-mode' },
    { ...meta.agent, agentConfigId, modelId: 'legacy-model' },
    { ...meta.agent, agentConfigId, configOptionValues: { fast: 'true' } },
  ])('does not substitute defaults for missing or unsupported selections %#', async (agent) => {
    const { deps, manager, dispatched } = fixture({ agent });
    const before = await readTask(manager, taskId);
    await expect(startDelegatedTask(deps, taskId, agentConfigId)).rejects.toThrow();
    expect(dispatched).toEqual([]);
    expect(await readTask(manager, taskId)).toEqual(before);
  });

  it('keeps the task unchanged when downstream acceptance rejects the catalog or model', async () => {
    const { deps, manager } = fixture();
    const before = await readTask(manager, taskId);
    deps.createSession = async () => {
      throw new Error('harness_model_selection_unavailable');
    };
    await expect(startDelegatedTask(deps, taskId, agentConfigId)).rejects.toThrow(
      'harness_model_selection_unavailable'
    );
    expect(await readTask(manager, taskId)).toEqual(before);
  });

  it('retries only status durability after a failed write without dispatching again', async () => {
    const { deps, manager, dispatched } = fixture();
    const dispatchedTask = await startDelegatedTask(deps, taskId, agentConfigId);
    manager.repo.flush = async () => {
      throw new Error('synthetic disk failure');
    };
    await expect(dispatchedTask.settle()).rejects.toThrow('synthetic disk failure');
    manager.repo.flush = async () => {};
    await dispatchedTask.settle();
    expect(dispatched.map((args) => args.options.taskId)).toEqual([taskId]);
    const snapshot = await readTask(manager, taskId);
    expect(snapshot?.meta.status).toBe('in_progress');
    expect(snapshot?.timeline.filter((item) => item.activityType === 'status_changed')).toEqual([
      expect.objectContaining({ activityData: { from: 'backlog', to: 'in_progress' } }),
    ]);
  });

  it('flushes an identical index row left by a failed publication', async () => {
    const { deps, manager, index } = fixture();
    const dispatchedTask = await startDelegatedTask(deps, taskId, agentConfigId);
    let failIndexFlush = true;
    let durableIndex: unknown;
    manager.repo.flush = async () => {
      const current = index.get(['task', taskId]);
      if (current !== undefined && failIndexFlush) throw new Error('index flush failed');
      durableIndex = current;
    };
    await expect(dispatchedTask.settle()).rejects.toThrow('index flush failed');
    expect(durableIndex).toBeUndefined();
    failIndexFlush = false;
    await dispatchedTask.settle();
    expect(durableIndex).toMatchObject({ taskId, status: 'in_progress' });
  });

  it.each([
    { status: 'done' },
    { status: 'needs_review' },
    { ownerId: 'different-user' },
    { agent: { agentConfigId: 'different-agent' } },
  ])('preserves later task decisions when status settlement is delayed %#', async (change) => {
    const { deps, manager, doc, index } = fixture();
    const dispatchedTask = await startDelegatedTask(deps, taskId, agentConfigId);
    for (const [key, value] of Object.entries(change)) doc.getMap('meta').set(key, value);
    doc.commit();
    const before = await readTask(manager, taskId);
    await dispatchedTask.settle();
    expect(await readTask(manager, taskId)).toEqual(before);
    expect(index.get(['task', taskId])).toMatchObject({ status: before?.meta.status });
  });
});
