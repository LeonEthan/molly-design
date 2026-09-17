import { afterEach, describe, expect, it, vi } from 'vitest';

const getIpcServicesMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: getIpcServicesMock,
}));

import { latestCommittedDesignRevision, syncOpenDesignCanvas } from '../src/lib/design-canvas-sync';

const sha = (seed: string) => seed.repeat(64).slice(0, 64);
const ARTWORK = 'artwork-1';
const FIRST = sha('a');
const SECOND = sha('b');

const committed = (revisionId: string, artworkId = ARTWORK) => ({
  designOutcome: {
    version: 1,
    status: 'committed',
    turnId: 'turn-1',
    artworkId,
    revisionId,
    timestamp: '2026-09-10T00:00:00.000Z',
  },
});

afterEach(() => {
  getIpcServicesMock.mockReset();
});

describe('latestCommittedDesignRevision', () => {
  it('is absent when no turn has committed a revision', () => {
    expect(latestCommittedDesignRevision(undefined, ARTWORK)).toBeUndefined();
    expect(latestCommittedDesignRevision([], ARTWORK)).toBeUndefined();
    expect(
      latestCommittedDesignRevision(
        [
          {
            designOutcome: {
              version: 1,
              status: 'candidate',
              turnId: 'turn-1',
              artworkId: ARTWORK,
              candidateId: sha('c'),
              timestamp: '2026-09-10T00:00:00.000Z',
            },
          },
          {
            designOutcome: {
              version: 1,
              status: 'cancelled',
              turnId: 'turn-2',
              artworkId: ARTWORK,
              timestamp: '2026-09-10T00:01:00.000Z',
            },
          },
        ],
        ARTWORK
      )
    ).toBeUndefined();
  });

  it('returns the last committed revision for this artwork', () => {
    expect(latestCommittedDesignRevision([committed(FIRST)], ARTWORK)).toBe(FIRST);
    expect(
      latestCommittedDesignRevision(
        [
          committed(FIRST),
          {
            designOutcome: {
              version: 1,
              status: 'invalid',
              turnId: 'turn-2',
              artworkId: ARTWORK,
              timestamp: '2026-09-10T00:02:00.000Z',
            },
          },
          committed(SECOND),
        ],
        ARTWORK
      )
    ).toBe(SECOND);
  });

  it('ignores another artwork and a committed turn with no revision', () => {
    expect(
      latestCommittedDesignRevision(
        [
          committed(FIRST, 'other-artwork'),
          {
            designOutcome: {
              version: 1,
              status: 'committed',
              turnId: 'turn-2',
              artworkId: ARTWORK,
              timestamp: '2026-09-10T00:02:00.000Z',
            },
          },
        ],
        ARTWORK
      )
    ).toBeUndefined();
  });

  it('does not change when the same committed revision later gains a thumbnail', () => {
    const withThumbnail = {
      designOutcome: {
        ...committed(FIRST).designOutcome,
        thumbnail: {
          path: `design-thumbnail/${FIRST}.png`,
          width: 480,
          height: 360,
        },
      },
    };
    expect(latestCommittedDesignRevision([committed(FIRST)], ARTWORK)).toBe(FIRST);
    expect(latestCommittedDesignRevision([withThumbnail], ARTWORK)).toBe(FIRST);
  });
});

describe('syncOpenDesignCanvas', () => {
  it('does nothing when no Electron design service is present', async () => {
    getIpcServicesMock.mockReturnValue(null);
    await expect(syncOpenDesignCanvas(ARTWORK)).resolves.toBeUndefined();
    getIpcServicesMock.mockReturnValue({} as never);
    await expect(syncOpenDesignCanvas(ARTWORK)).resolves.toBeUndefined();
  });

  it('asks the design service to reload the open editor from the store', async () => {
    const syncFromStore = vi.fn().mockResolvedValue(undefined);
    getIpcServicesMock.mockReturnValue({ design: { syncFromStore } } as never);
    await syncOpenDesignCanvas(ARTWORK);
    expect(syncFromStore).toHaveBeenCalledWith(ARTWORK);
  });

  it('rejects when the reload fails so the canvas can surface it', async () => {
    const failure = new Error('Design service stopped; retry to check the saved drawing');
    getIpcServicesMock.mockReturnValue({
      design: { syncFromStore: vi.fn().mockRejectedValue(failure) },
    } as never);
    await expect(syncOpenDesignCanvas(ARTWORK)).rejects.toThrow(failure.message);
  });
});
