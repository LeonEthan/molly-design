import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import {
  buildDesignContinuationMeta,
  getSessionRoomId,
  type AgentConfigId,
  type SessionHistoryInput,
  type SessionId,
} from '@molly/shared';
import { SessionDocument } from '@/lib/loro/doc';
import {
  DesignContinuationService,
  designContinuationTargetId,
} from './design-continuation-service';

const sourceId = 'old-source' as SessionId;
const configId = 'molly-config' as AgentConfigId;
const args = {
  sourceSessionId: sourceId,
  targetAgentConfigId: configId,
  requestedByUserId: 'local:user',
};
const history: SessionHistoryInput[] = [
  {
    id: 'old-user',
    timestamp: '2026-09-19T00:00:00.000Z',
    role: 'user',
    status: 'handled',
    fileDiff: [],
    items: [{ type: 'text', text: 'Keep the existing artwork.' }],
  },
];

function fixture(saved = new Map<string, Uint8Array>()) {
  const targetId = designContinuationTargetId('workspace-1', sourceId);
  const source = {
    id: sourceId,
    machineId: 'machine-1',
    userId: args.requestedByUserId,
    cliType: 'builtin',
    agentType: 'codex',
    agentConfigId: 'old-config',
    title: 'Synthetic design',
    design: { artworkId: 'artwork-1', path: 'design.json' },
    acpSessionId: 'old-native-identity',
    latestUserMsgId: 'old-user',
  };
  const metas = new Map<string, unknown>([[getSessionRoomId(sourceId), { meta: source }]]);
  const docs = new Map<SessionId, { session: SessionDocument; loro: LoroDoc }>();
  const state = {
    busy: false,
    failPersist: false,
    now: Date.parse('2026-09-20T00:00:00.000Z'),
    config: { id: configId, machineId: 'machine-1', cliType: 'builtin', agentType: 'molly' } as
      | Record<string, unknown>
      | undefined,
    beforeSourceOpen: undefined as (() => void) | undefined,
  };
  const repo = {
    getDocMeta: async (roomId: string) => metas.get(roomId),
    upsertDocMeta: async () => {
      throw new Error('Preparation must not publish a runnable Session');
    },
  };
  const open = async (id: SessionId) => {
    if (id === sourceId) state.beforeSourceOpen?.();
    const existing = docs.get(id);
    if (existing) return existing.session;
    const loro = new LoroDoc();
    const snapshot = saved.get(id);
    if (snapshot) loro.import(snapshot);
    const session = new SessionDocument(repo as never, id, async () => {});
    session.handle = { doc: loro } as never;
    session.composeSessionData(loro, { history: id === sourceId ? history : [] });
    docs.set(id, { session, loro });
    return session;
  };
  const makeService = () =>
    new DesignContinuationService({
      workspaceDocument: {
        repo,
        getOrCreateSessionDoc: open,
        getAgentConfigById: async () => state.config,
        persistPendingChanges: async () => {
          if (state.failPersist) throw new Error('synthetic_disk_unavailable');
          for (const [id, doc] of docs) saved.set(id, doc.loro.export({ mode: 'snapshot' }));
        },
      } as never,
      workspaceId: 'workspace-1',
      machineId: 'machine-1',
      now: () => state.now,
      isSourceBusy: () => state.busy,
    });
  return { service: makeService(), makeService, source, targetId, metas, docs, state, open, saved };
}

describe('design continuation preparation', () => {
  it('inspects prepared attachments without publishing or changing the receipt', async () => {
    const f = fixture();
    const record = await f.service.prepare(args);
    const before = f.docs.get(f.targetId)?.loro.version().toJSON();
    expect(await f.service.inspectAttachments(args)).toEqual({ record, attachments: [] });
    expect(f.docs.get(f.targetId)?.loro.version().toJSON()).toEqual(before);
    expect(f.metas.has(getSessionRoomId(f.targetId))).toBe(false);
  });

  it.each(['owner', 'artwork', 'deleted', 'busy'] as const)(
    'refuses a source changed during attachment inspection: %s',
    async (kind) => {
      const f = fixture();
      f.state.beforeSourceOpen = () => {
        if (!f.docs.get(f.targetId)?.session.getDesignContinuation()) return;
        if (kind === 'owner') f.source.userId = 'other-user';
        if (kind === 'artwork') f.source.design.artworkId = 'other-artwork';
        if (kind === 'deleted')
          f.metas.set(getSessionRoomId(sourceId), { meta: f.source, deleted: true });
        if (kind === 'busy') f.state.busy = true;
      };
      await expect(f.service.inspectAttachments(args)).rejects.toThrow(
        'design_continuation_source_changed'
      );
      expect(f.metas.has(getSessionRoomId(f.targetId))).toBe(false);
      expect(f.docs.get(f.targetId)?.session.getDesignContinuation()?.source).toMatchObject({
        userId: args.requestedByUserId,
        design: { artworkId: 'artwork-1' },
      });
    }
  );

  it('durably captures one reference and preserves the source without publishing or executing', async () => {
    const f = fixture();
    await f.open(sourceId);
    const before = f.docs.get(sourceId)?.loro.version().toJSON();
    const record = await f.service.prepare(args);
    expect(record.source).toEqual({
      id: sourceId,
      machineId: 'machine-1',
      userId: args.requestedByUserId,
      cliType: 'builtin',
      agentType: 'codex',
      agentConfigId: 'old-config',
      title: 'Synthetic design',
      design: { artworkId: 'artwork-1', path: 'design.json' },
    });
    expect(record.reference.messages[0]?.text).toBe('Keep the existing artwork.');
    expect(f.saved.has(f.targetId)).toBe(true);
    expect(f.metas.has(getSessionRoomId(f.targetId))).toBe(false);
    expect(f.docs.get(sourceId)?.loro.version().toJSON()).toEqual(before);
    const meta = buildDesignContinuationMeta(record);
    expect(meta).toMatchObject({
      id: f.targetId,
      cliType: 'builtin',
      agentType: 'molly',
      agentConfigId: configId,
      design: f.source.design,
      openedBySessionId: sourceId,
      designContinuation: { version: 1, sourceSessionId: sourceId },
    });
    expect(meta).not.toHaveProperty('acpSessionId');
    expect(meta).not.toHaveProperty('parentSessionId');
    expect(meta).not.toHaveProperty('latestUserMsgId');
  });

  it('concurrent explicit clicks and a reopened process reuse the exact original receipt', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.service.prepare(args),
      f.makeService().prepare(args),
    ]);
    expect(first).toEqual(second);
    const reopened = fixture(f.saved);
    reopened.state.now += 1000;
    reopened.source.title = 'Later title';
    expect(await reopened.service.prepare(args)).toEqual(first);
    expect([...reopened.saved.keys()].filter((id) => id !== sourceId)).toEqual([f.targetId]);
  });

  it('rejects a failed durability barrier, then preserves the same receipt on explicit retry', async () => {
    const f = fixture();
    f.state.failPersist = true;
    await expect(f.service.prepare(args)).rejects.toThrow('synthetic_disk_unavailable');
    expect(f.saved.has(f.targetId)).toBe(false);
    const inMemory = (await f.open(f.targetId)).getDesignContinuation();
    f.state.now += 1000;
    f.state.failPersist = false;
    expect(await f.service.prepare(args)).toEqual(inMemory);
    expect(f.saved.has(f.targetId)).toBe(true);
    expect(f.metas.has(getSessionRoomId(f.targetId))).toBe(false);
  });

  it.each(['owner', 'machine', 'missing', 'deleted', 'already-molly', 'busy'] as const)(
    'refuses an ineligible source before opening target/history: %s',
    async (kind) => {
      const f = fixture();
      if (kind === 'owner') f.source.userId = 'another-user';
      if (kind === 'machine') f.source.machineId = 'another-machine';
      if (kind === 'missing') f.metas.delete(getSessionRoomId(sourceId));
      if (kind === 'deleted')
        f.metas.set(getSessionRoomId(sourceId), { meta: f.source, deleted: true });
      if (kind === 'already-molly') f.source.agentType = 'molly';
      if (kind === 'busy') f.state.busy = true;
      await expect(f.service.prepare(args)).rejects.toThrow(/design_continuation_/);
      expect([...f.docs.keys()]).toEqual([]);
      expect([...f.saved.keys()]).toEqual([]);
    }
  );

  it.each(['missing', 'wrong-id', 'legacy', 'foreign'] as const)(
    'rejects the target config: %s',
    async (kind) => {
      const f = fixture();
      if (kind === 'missing') f.state.config = undefined;
      else
        f.state.config = {
          ...f.state.config,
          ...(kind === 'wrong-id' ? { id: 'wrong' } : {}),
          ...(kind === 'legacy' ? { agentType: 'codex' } : {}),
          ...(kind === 'foreign' ? { machineId: 'another-machine' } : {}),
        };
      await expect(f.service.prepare(args)).rejects.toThrow(
        'design_continuation_target_unavailable'
      );
      expect([...f.docs.keys()]).toEqual([]);
    }
  );

  it.each(['deleted', 'existing-meta', 'existing-history'] as const)(
    'preserves a conflicting target: %s',
    async (kind) => {
      const f = fixture();
      if (kind === 'deleted') f.metas.set(getSessionRoomId(f.targetId), { deleted: true });
      if (kind === 'existing-meta')
        f.metas.set(getSessionRoomId(f.targetId), { meta: { id: f.targetId } });
      if (kind === 'existing-history')
        await (await f.open(f.targetId)).sessionData.commands.appendTurn(history[0]!);
      await expect(f.service.prepare(args)).rejects.toThrow(/design_continuation_target_/);
      if (kind === 'deleted') expect(f.docs.has(f.targetId)).toBe(false);
      expect(f.docs.get(f.targetId)?.session.getDesignContinuation()).toBeUndefined();
      if (kind === 'existing-history')
        expect(f.docs.get(f.targetId)?.loro.getList('history').length).toBe(1);
    }
  );

  it.each(['rebound', 'deleted', 'busy'] as const)(
    'rechecks source after opening history: %s',
    async (kind) => {
      const f = fixture();
      f.state.beforeSourceOpen = () => {
        if (kind === 'rebound') f.source.design.artworkId = 'other-artwork';
        if (kind === 'deleted')
          f.metas.set(getSessionRoomId(sourceId), { meta: f.source, deleted: true });
        if (kind === 'busy') f.state.busy = true;
      };
      await expect(f.service.prepare(args)).rejects.toThrow('design_continuation_source_changed');
      expect(f.docs.get(f.targetId)?.session.getDesignContinuation()).toBeUndefined();
      expect(f.saved.has(f.targetId)).toBe(false);
    }
  );

  it('does not reuse an accepted receipt after the source changes artwork', async () => {
    const f = fixture();
    const first = await f.service.prepare(args);
    f.source.design.artworkId = 'another-artwork';
    await expect(f.service.prepare(args)).rejects.toThrow('design_continuation_target_conflict');
    expect((await f.open(f.targetId)).getDesignContinuation()).toEqual(first);
  });

  it('keeps source-child provenance without inheriting root lifecycle ownership', async () => {
    const f = fixture();
    f.metas.set(getSessionRoomId(sourceId), {
      meta: { ...f.source, parentSessionId: 'root-session' },
    });
    f.metas.set(getSessionRoomId('root-session' as SessionId), {
      meta: { id: 'root-session', machineId: 'machine-1', userId: args.requestedByUserId },
    });
    const meta = buildDesignContinuationMeta(await f.service.prepare(args));
    expect(meta.parentSessionId).toBeUndefined();
    expect(meta.openedBySessionId).toBe(sourceId);
    expect(meta.openedByRootSessionId).toBe('root-session');
  });

  it('does not invent an absent parent or nested worktree', async () => {
    const f = fixture();
    f.metas.set(getSessionRoomId(sourceId), {
      meta: { ...f.source, parentSessionId: 'missing-parent' },
    });
    await expect(f.service.prepare(args)).rejects.toThrow('design_continuation_parent_unavailable');
    expect([...f.docs.keys()]).toEqual([]);
  });

  it('preserves an immutable receipt and refuses corrupt or future data without repair', async () => {
    const f = fixture();
    const record = await f.service.prepare(args);
    const target = await f.open(f.targetId);
    expect(() =>
      target.setDesignContinuation({
        ...record,
        target: { ...record.target, agentConfigId: 'other' },
      })
    ).toThrow('design_continuation_record_immutable');
    const raw = f.docs.get(f.targetId)!.loro;
    raw.getMap('designContinuation').set('record', { version: 2, unknown: 'preserve-me' });
    raw.commit();
    const before = raw.version().toJSON();
    await expect(f.service.prepare(args)).rejects.toThrow('invalid_design_continuation_record');
    expect(raw.version().toJSON()).toEqual(before);
    expect(raw.getMap('designContinuation').get('record')).toEqual({
      version: 2,
      unknown: 'preserve-me',
    });
  });
});
