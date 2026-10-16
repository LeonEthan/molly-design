import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionId } from '@molly/shared';
import * as electronIpc from '../src/lib/electron-ipc-client';
import {
  closeSessionCanvases,
  isDesignCanvasRetired,
  registerDesignCanvas,
} from '../src/lib/design-canvas-close';

const ID = 'close-lifecycle' as SessionId;

function serviceWith(design: { leave: () => Promise<boolean>; close: () => Promise<boolean> }) {
  vi.spyOn(electronIpc, 'getIpcServices').mockReturnValue({
    design,
  } as unknown as electronIpc.IpcServices);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('design canvas close lifecycle', () => {
  it('does not retire anything when a leave check cancels', async () => {
    serviceWith({ leave: async () => false, close: async () => true });
    const canvas = { reopened: false };
    const unregister = registerDesignCanvas(ID, () => {
      canvas.reopened = true;
    });

    await expect(closeSessionCanvases([ID])).rejects.toThrow('Canvas close cancelled');

    expect(isDesignCanvasRetired(ID)).toBe(false);
    expect(canvas.reopened).toBe(false);
    unregister();
  });

  it('reopens when a native close is refused', async () => {
    serviceWith({ leave: async () => true, close: async () => false });
    const canvas = { reopened: false };
    const unregister = registerDesignCanvas(ID, () => {
      canvas.reopened = true;
    });

    await expect(closeSessionCanvases([ID])).rejects.toThrow('Canvas close cancelled');

    expect(isDesignCanvasRetired(ID)).toBe(false);
    expect(canvas.reopened).toBe(true);
    unregister();
  });

  it('lets a failed overlapping operation release without undoing another', async () => {
    serviceWith({ leave: async () => true, close: async () => true });
    const canvas = { reopened: false };
    const unregister = registerDesignCanvas(ID, () => {
      canvas.reopened = true;
    });
    const failing = await closeSessionCanvases([ID]);
    const succeeding = await closeSessionCanvases([ID]);

    failing.release();
    expect(isDesignCanvasRetired(ID)).toBe(true);
    expect(canvas.reopened).toBe(false);

    succeeding.deleted(ID);
    succeeding.release();
    expect(isDesignCanvasRetired(ID)).toBe(true);
    expect(canvas.reopened).toBe(false);

    unregister();
    expect(isDesignCanvasRetired(ID)).toBe(false);
  });

  it('retains no state once no canvas is mounted and no operation is running', async () => {
    serviceWith({ leave: async () => true, close: async () => true });
    const lifecycle = await closeSessionCanvases([ID]);
    lifecycle.deleted(ID);
    lifecycle.release();

    expect(isDesignCanvasRetired(ID)).toBe(false);
  });

  it('carries a deletion recorded without a canvas to a canvas mounted before release', async () => {
    serviceWith({ leave: async () => true, close: async () => true });
    const lifecycle = await closeSessionCanvases([ID]);
    lifecycle.deleted(ID);
    const canvas = { reopened: false };
    const unregister = registerDesignCanvas(ID, () => {
      canvas.reopened = true;
    });

    lifecycle.release();
    expect(isDesignCanvasRetired(ID)).toBe(true);
    expect(canvas.reopened).toBe(false);

    unregister();
    expect(isDesignCanvasRetired(ID)).toBe(false);
  });
});
