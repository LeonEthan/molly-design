import { expect, it, vi } from 'vitest';
import { LoroRepo } from 'loro-repo';
import type { SessionId } from '@molly/shared';
import { SessionDocument } from '../src/lib/loro/doc';

it('does not begin title publication after cancellation during metadata reads', async () => {
  const repo = await LoroRepo.create({});
  const doc = new SessionDocument(repo, 'title-cancellation' as SessionId);
  await doc.initOffline();
  try {
    await doc.setTitleIfSourceIn('Original', 'draft', []);
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getMetaState = doc.getMetaState.bind(doc);
    const read = vi.spyOn(doc, 'getMetaState').mockImplementationOnce(async () => {
      entered();
      await released;
      return await getMetaState();
    });
    const controller = new AbortController();
    const publishing = doc.setTitleIfSourceIn('Late', 'generated', ['draft'], controller.signal);
    await reading;
    controller.abort();
    release();
    expect(await publishing).toBe(false);
    read.mockRestore();
    expect((await doc.getMetaState())?.title).toBe('Original');
    // Existing ordinary writes remain valid and preserve their source guard.
    expect(await doc.setTitleIfSourceIn('Normal', 'generated', ['draft'])).toBe(true);
    expect((await doc.getMetaState())?.title).toBe('Normal');
  } finally {
    await repo.destroy();
  }
});
