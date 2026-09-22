import { describe, expect, it } from 'vitest';
import { LoroRepo } from 'loro-repo';

type InspectedRepo = LoroRepo & {
  metadataManager: { cache: { cache: Map<string, unknown> } };
  syncRunner: { metaHydrationQueue: Promise<void> };
};

// The upstream repository has no cache diagnostics API. Inspect only the owner
// while exercising its public read/write/delete/restore and real Flock import paths.
async function createRepo() {
  return (await LoroRepo.create({})) as InspectedRepo;
}

async function settle(repo: InspectedRepo) {
  await repo.syncRunner.metaHydrationQueue;
}

describe('deleted document metadata cache retirement', () => {
  it('releases deleted copies even after reads/listing; restores losslessly', async () => {
    const repo = await createRepo();
    try {
      await repo.upsertDocMeta('active', { title: 'Active' });
      for (let i = 0; i < 40; i++) {
        const id = `deleted-${i}`;
        const meta = { title: id, nested: { keep: ['restorable', i] } };
        await repo.upsertDocMeta(id, meta);
        await repo.deleteDoc(id);
        await settle(repo);
        expect(await repo.getDocMeta(id)).toEqual({ meta, deleted: true });
      }
      expect((await repo.listDoc()).length).toBe(41);
      expect([...repo.metadataManager.cache.cache.keys()]).toEqual(['active']);
      expect(repo.getMeta().scan({ prefix: ['e'] }).length).toBe(41);
      await repo.restoreDoc('deleted-0');
      expect(await repo.getDocMeta('deleted-0')).toEqual({
        meta: { title: 'deleted-0', nested: { keep: ['restorable', 0] } },
        deleted: false,
      });
    } finally {
      await repo.destroy();
    }
  });

  it('retires remote deletion and rehydrates updates, field removal and restoration', async () => {
    const repo = await createRepo();
    const remote = await createRepo();
    try {
      await remote.upsertDocMeta('session', { title: 'Before', remove: 'old' });
      const importRemote = async () => {
        repo.getMeta().importJson(remote.getMeta().exportJson());
        await settle(repo);
      };
      await importRemote();
      await repo.getDocMeta('session');
      await remote.deleteDoc('session');
      await importRemote();
      expect(repo.metadataManager.cache.cache.has('session')).toBe(false);
      await remote.upsertDocMeta('session', { title: 'After', remove: undefined });
      await importRemote();
      expect(await repo.getDocMeta('session')).toEqual({ meta: { title: 'After' }, deleted: true });
      expect(repo.metadataManager.cache.cache.has('session')).toBe(false);
      await remote.restoreDoc('session');
      await importRemote();
      expect(await repo.getDocMeta('session')).toEqual({
        meta: { title: 'After' },
        deleted: false,
      });
    } finally {
      await repo.destroy();
      await remote.destroy();
    }
  });

  it('preserves serialized tombstones and legacy whole-object removal events', async () => {
    const repo = await createRepo();
    const remote = await createRepo();
    const restarted = await createRepo();
    try {
      const importRemote = async () => {
        repo.getMeta().importJson(remote.getMeta().exportJson());
        await settle(repo);
      };
      remote.getMeta().put(['e', 'legacy'], true);
      remote.getMeta().put(['m', 'legacy'], { title: 'Legacy', remove: 'before' });
      await importRemote();
      await repo.getDocMeta('legacy');
      await remote.deleteDoc('legacy');
      await importRemote();
      expect(repo.metadataManager.cache.cache.has('legacy')).toBe(true);
      const patches: unknown[] = [];
      const subscription = repo.watch((event) => {
        if (event.kind === 'doc-metadata') patches.push(event.patch);
      });
      remote.getMeta().put(['m', 'legacy'], { title: 'Legacy' });
      await importRemote();
      expect(patches).toContainEqual({ remove: null });
      subscription.unsubscribe();
      await repo.upsertDocMeta('modern', { title: 'Still restorable' });
      await repo.deleteDoc('modern');
      const serialized = repo.getMeta().exportJson();
      await repo.listDoc();
      expect(repo.getMeta().exportJson()).toEqual(serialized);
      restarted.getMeta().importJson(serialized);
      await settle(restarted);
      expect(await restarted.getDocMeta('modern')).toEqual({
        meta: { title: 'Still restorable' },
        deleted: true,
      });
      expect(restarted.metadataManager.cache.cache.has('modern')).toBe(false);
      await restarted.restoreDoc('modern');
      expect(await restarted.getDocMeta('modern')).toEqual({
        meta: { title: 'Still restorable' },
        deleted: false,
      });
    } finally {
      await repo.destroy();
      await remote.destroy();
      await restarted.destroy();
    }
  });
});
