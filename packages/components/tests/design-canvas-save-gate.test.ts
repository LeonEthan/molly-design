import { formatDesignElementReference } from '@molly/shared/design-element-reference';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getIpcServicesMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: getIpcServicesMock,
}));

import { flushDesignCanvasBeforeSend } from '../src/lib/design-canvas-save-gate';

afterEach(() => {
  getIpcServicesMock.mockReset();
});

describe('flushDesignCanvasBeforeSend', () => {
  it('proceeds when no Electron IPC host provides a design service', async () => {
    getIpcServicesMock.mockReturnValue(null);
    await expect(flushDesignCanvasBeforeSend('artwork-1')).resolves.toBeUndefined();
  });

  it('proceeds when the host has no design service', async () => {
    getIpcServicesMock.mockReturnValue({} as never);
    await expect(flushDesignCanvasBeforeSend('artwork-1')).resolves.toBeUndefined();
  });

  it('resolves only after the design save completes', async () => {
    let releaseSave: (() => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        })
    );
    getIpcServicesMock.mockReturnValue({ design: { save } } as never);

    let settled = false;
    const gate = flushDesignCanvasBeforeSend('artwork-7').then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(save).toHaveBeenCalledWith('artwork-7');
    expect(settled).toBe(false);

    releaseSave?.();
    await gate;
    expect(settled).toBe(true);
  });

  it('rejects when the save fails so callers block the send', async () => {
    const failure = new Error('DESIGN_CONFLICT');
    const save = vi.fn().mockRejectedValue(failure);
    getIpcServicesMock.mockReturnValue({ design: { save } } as never);

    await expect(flushDesignCanvasBeforeSend('artwork-9')).rejects.toThrow('DESIGN_CONFLICT');
  });
});

it('validates the post-flush saved baseline and retains stale reference identity', async () => {
  const reference = { artworkId: 'art', baselineRevisionId: 'a'.repeat(64), elementIds: ['title'] };
  const prompt = formatDesignElementReference(reference);
  let saved = false;
  getIpcServicesMock.mockReturnValue({ design: {
    save: async () => { saved = true; },
    read: async () => { expect(saved).toBe(true); return { revisionId: 'b'.repeat(64), doc: { elements: [{ id: 'title' }] } }; },
  } });
  await expect(flushDesignCanvasBeforeSend('art', prompt)).rejects.toThrow('stale');
  expect(reference.baselineRevisionId).toBe('a'.repeat(64));
});
