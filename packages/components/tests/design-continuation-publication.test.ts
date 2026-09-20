import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoroRepo } from 'loro-repo';
import { LoroDoc } from 'loro-crdt';
import {
  createSessionMirror,
  DesignContinuationRecordSchema,
  buildDesignContinuationPublication,
  SessionStatusFactory,
  getSessionRoomId,
  type SessionId,
} from '@molly/shared';
import { createDirectWorkspaceWriter } from '../src/providers/workspace-writer-impl';

const record = () =>
  DesignContinuationRecordSchema.parse({
    version: 1,
    workspaceId: 'workspace-1',
    source: {
      id: 'source',
      machineId: 'machine-1',
      userId: 'local:user',
      cliType: 'builtin',
      agentType: 'codex',
      design: { artworkId: 'artwork', path: 'design.json' },
    },
    target: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      agentConfigId: 'molly-config',
      createdAt: '2026-09-20T00:00:00.000Z',
    },
    reference: {
      version: 1,
      source: { sessionId: 'source', artworkId: 'artwork', machineId: 'machine-1' },
      messages: [],
      attachmentCandidates: [],
      omitted: { turns: 0, items: 0, attachments: 0 },
    },
  });
const identity = { workspaceId: 'workspace-1', userId: 'local:user' };
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(withReceipt = true) {
  const receipt = record();
  const repo = await LoroRepo.create({});
  cleanups.push(() => repo.destroy());
  const doc = new LoroDoc();
  const mirror = createSessionMirror({ doc, initialState: { history: [] } });
  if (withReceipt)
    mirror.setState((draft) => {
      draft.designContinuation = { record: receipt };
    });
  cleanups.push(() => mirror.dispose());
  const machine = await repo.openFlockDoc('workspace-1:mf:machine-1');
  const key = ['agentConfig', receipt.target.agentConfigId];
  machine.flock.set(key, {
    id: key[1],
    machineId: 'machine-1',
    name: 'Molly',
    cliType: 'builtin',
    agentType: 'molly',
    env: {},
  });
  machine.flock.commit();
  const sourceRoom = getSessionRoomId('source' as SessionId);
  const targetRoom = getSessionRoomId(receipt.target.sessionId as SessionId);
  await repo.upsertDocMeta(sourceRoom, {
    ...receipt.source,
    title: 'Old source',
    isArchived: true,
  });
  const sourceBefore = await repo.getDocMeta(sourceRoom);
  const handles: string[] = [];
  let waitUntilSynced = async (_signal?: AbortSignal) => {};
  const writer = createDirectWorkspaceWriter({
    repo,
    acquireSessionStore: async () => {
      handles.push('acquire');
      return {
        ...mirror,
        waitUntilSynced: (signal?: AbortSignal) => waitUntilSynced(signal),
      } as never;
    },
    releaseSessionStoreRef: () => {
      handles.push('release');
    },
    acquirePreviewVisualCommentStore: async () => {
      throw new Error('must not touch canvas');
    },
    releasePreviewVisualCommentStoreRef: () => {
      throw new Error('must not touch canvas');
    },
  });
  return {
    receipt,
    repo,
    doc,
    mirror,
    machine,
    key,
    writer,
    handles,
    sourceRoom,
    targetRoom,
    sourceBefore,
    setSync: (fn: typeof waitUntilSynced) => {
      waitUntilSynced = fn;
    },
  };
}

describe('design continuation renderer publication', () => {
  it.each(['success', 'failure', 'cancel', 'delete'] as const)(
    'waits for local durability without rolling back publication: %s',
    async (outcome) => {
      const f = await fixture();
      const controller = new AbortController();
      const events: string[] = [];
      let release: () => void = () => {};
      let entered: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let fail = outcome === 'failure';
      const flush = f.repo.flush.bind(f.repo);
      vi.spyOn(f.repo, 'flush').mockImplementation(async () => {
        events.push('flush-start');
        entered();
        await gate;
        if (fail) throw new Error('synthetic_disk_unavailable');
        await flush();
        events.push('durable');
      });
      const pending = f.writer
        .publishDesignContinuation(f.receipt, { ...identity, signal: controller.signal })
        .then((value) => {
          events.push('acknowledged');
          return value;
        });
      await ready;
      expect(events).toEqual(['flush-start']);
      expect(f.handles).toEqual(['acquire']);
      const published = await f.repo.getDocMeta(f.targetRoom);
      expect(published?.meta).toMatchObject(buildDesignContinuationPublication(f.receipt));
      if (outcome === 'cancel') controller.abort(new Error('synthetic_cancel'));
      if (outcome === 'delete') await f.repo.deleteDoc(f.targetRoom);
      const result =
        outcome === 'success'
          ? expect(pending).resolves.toMatchObject({ id: f.receipt.target.sessionId })
          : expect(pending).rejects.toThrow(
              outcome === 'failure'
                ? 'synthetic_disk_unavailable'
                : outcome === 'cancel'
                  ? 'synthetic_cancel'
                  : 'design_continuation_target_deleted'
            );
      release();
      await result;
      expect(events.includes('acknowledged')).toBe(outcome === 'success');
      expect(f.handles).toEqual(['acquire', 'release']);
      if (outcome === 'delete') {
        expect(await f.repo.getDocMeta(f.targetRoom)).toMatchObject({ deleted: true });
      } else {
        expect(await f.repo.getDocMeta(f.targetRoom)).toEqual(published);
        if (outcome === 'failure') {
          fail = false;
          events.length = 0;
          expect(await f.writer.publishDesignContinuation(f.receipt, identity)).toEqual(
            published?.meta
          );
          expect(events).toEqual(['flush-start', 'durable']);
          expect(await f.repo.getDocMeta(f.targetRoom)).toEqual(published);
        }
      }
      expect(await f.repo.getDocMeta(f.sourceRoom)).toEqual(f.sourceBefore);
    }
  );
  it('publishes the same independent target on concurrent confirmations without history or source writes', async () => {
    const f = await fixture();
    const before = f.doc.version().toJSON();
    const results = await Promise.all([
      f.writer.publishDesignContinuation(f.receipt, identity),
      f.writer.publishDesignContinuation(f.receipt, identity),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual(buildDesignContinuationPublication(f.receipt));
    expect(results[0]).not.toHaveProperty('parentSessionId');
    expect(results[0]).not.toHaveProperty('status');
    expect(f.doc.version().toJSON()).toEqual(before);
    expect(await f.repo.getDocMeta(f.sourceRoom)).toEqual(f.sourceBefore);
    expect(f.handles.sort()).toEqual(['acquire', 'acquire', 'release', 'release']);
  });

  it('keeps a used target unchanged on reopening and reconfirmation', async () => {
    const f = await fixture();
    await f.writer.publishDesignContinuation(f.receipt, identity);
    const active = {
      title: 'Human rename',
      status: SessionStatusFactory.running(),
      isArchived: true,
      lastMessageAt: Date.parse('2026-09-20T01:00:00.000Z'),
      latestUserMsgId: 'new-turn',
    };
    await f.repo.upsertDocMeta(f.targetRoom, active);
    const result = await f.writer.publishDesignContinuation(f.receipt, identity);
    expect(result).toMatchObject(active);
    expect(await f.repo.getDocMeta(f.sourceRoom)).toEqual(f.sourceBefore);
  });

  it('a late concurrent publication cannot reset activity written after its read', async () => {
    const f = await fixture();
    const upsert = f.repo.upsertDocMeta.bind(f.repo);
    vi.spyOn(f.repo, 'upsertDocMeta').mockImplementation(async (id, patch) => {
      if (id === f.targetRoom)
        await upsert(id, {
          title: 'Already renamed',
          status: SessionStatusFactory.running(),
          isArchived: true,
          latestUserMsgId: 'accepted-turn',
        });
      return upsert(id, patch);
    });
    expect(await f.writer.publishDesignContinuation(f.receipt, identity)).toMatchObject({
      title: 'Already renamed',
      status: SessionStatusFactory.running(),
      isArchived: true,
      latestUserMsgId: 'accepted-turn',
    });
  });

  it.each(['before', 'during'] as const)(
    'does not resurrect a target deleted %s publication',
    async (when) => {
      const f = await fixture();
      if (when === 'before') await f.repo.deleteDoc(f.targetRoom);
      else {
        const upsert = f.repo.upsertDocMeta.bind(f.repo);
        vi.spyOn(f.repo, 'upsertDocMeta').mockImplementation(async (id, patch) => {
          if (id === f.targetRoom) await f.repo.deleteDoc(id);
          return upsert(id, patch);
        });
      }
      await expect(f.writer.publishDesignContinuation(f.receipt, identity)).rejects.toThrow(
        'design_continuation_target_deleted'
      );
      expect(await f.repo.getDocMeta(f.targetRoom)).toMatchObject({ deleted: true });
      expect(f.handles).toEqual(['acquire', 'release']);
    }
  );

  it.each(['owner', 'workspace', 'receipt', 'source', 'config', 'target'] as const)(
    'fails closed on changed %s',
    async (kind) => {
      const f = await fixture();
      const caller = { ...identity };
      if (kind === 'owner') caller.userId = 'other';
      if (kind === 'workspace') caller.workspaceId = 'other';
      if (kind === 'receipt')
        f.mirror.setState((draft) => {
          draft.designContinuation!.record.target.createdAt = '2026-09-21T00:00:00.000Z';
        });
      if (kind === 'source')
        await f.repo.upsertDocMeta(f.sourceRoom, {
          design: { artworkId: 'other', path: 'design.json' },
        });
      if (kind === 'config') {
        f.machine.flock.delete(f.key);
        f.machine.flock.commit();
      }
      if (kind === 'target')
        await f.repo.upsertDocMeta(f.targetRoom, {
          ...buildDesignContinuationPublication(f.receipt),
          userId: 'other',
        });
      const before = await f.repo.getDocMeta(f.targetRoom);
      await expect(f.writer.publishDesignContinuation(f.receipt, caller)).rejects.toThrow();
      expect(await f.repo.getDocMeta(f.targetRoom)).toEqual(before);
      expect(f.handles).toEqual(
        kind === 'owner' || kind === 'workspace' ? [] : ['acquire', 'release']
      );
    }
  );

  it('rechecks the live catalog after asynchronous target metadata lookup', async () => {
    const f = await fixture();
    const read = f.repo.getDocMeta.bind(f.repo);
    vi.spyOn(f.repo, 'getDocMeta').mockImplementation(async (id) => {
      const result = await read(id);
      if (id === f.targetRoom) {
        f.machine.flock.delete(f.key);
        f.machine.flock.commit();
      }
      return result;
    });
    await expect(f.writer.publishDesignContinuation(f.receipt, identity)).rejects.toThrow(
      'design_continuation_target_unavailable'
    );
    expect(await read(f.targetRoom)).toBeUndefined();
  });

  it.each(['arrive', 'missing', 'cancel'] as const)(
    'waits for the prepared receipt: %s',
    async (outcome) => {
      const f = await fixture(false);
      const controller = new AbortController();
      f.setSync(async (signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        if (outcome === 'arrive')
          f.mirror.setState((draft) => {
            draft.designContinuation = { record: f.receipt };
          });
        if (outcome === 'cancel') controller.abort(new Error('synthetic cancel'));
      });
      const pending = f.writer.publishDesignContinuation(f.receipt, {
        ...identity,
        signal: controller.signal,
      });
      if (outcome === 'arrive')
        await expect(pending).resolves.toMatchObject({ id: f.receipt.target.sessionId });
      else {
        await expect(pending).rejects.toThrow(
          outcome === 'cancel' ? 'synthetic cancel' : 'design_continuation_receipt_not_ready'
        );
        expect(await f.repo.getDocMeta(f.targetRoom)).toBeUndefined();
      }
      expect(f.handles).toEqual(['acquire', 'release']);
    }
  );
});
