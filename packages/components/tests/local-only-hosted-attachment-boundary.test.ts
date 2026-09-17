import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionId, WorkspaceId } from '@molly/shared';
import { getSessionImageBlobUrl } from '../src/lib/session-image-cache';
import { downloadSessionFile, fetchSessionFilePreview } from '../src/lib/session-file-download';

const workspaceId = 'local-workspace' as WorkspaceId;
const sessionId = 'old-session' as SessionId;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('hosted attachment metadata in the local desktop', () => {
  it('reads a preserved session image cache without requesting the product cloud', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected network request');
    });
    vi.stubGlobal('window', {
      caches: {
        open: async () => ({
          match: async () => new Response(new Blob(['cached-image'], { type: 'image/png' })),
          keys: async () => [],
        }),
      },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:legacy-session-image');
    await expect(
      getSessionImageBlobUrl({ workspaceId, sessionId, imageId: 'old-image', token: 'old-token' })
    ).resolves.toBe('blob:legacy-session-image');
  });

  it('reports missing hosted file bytes without requesting the product cloud', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected network request');
    });
    await expect(
      downloadSessionFile({
        workspaceId,
        sessionId,
        fileId: 'old-file',
        fileName: 'old.txt',
        token: 'old-token',
      })
    ).rejects.toThrow('Hosted attachment bytes are unavailable');
    await expect(
      fetchSessionFilePreview({
        workspaceId,
        sessionId,
        fileId: 'old-file',
        token: 'old-token',
        sizeBytes: 100,
      })
    ).rejects.toThrow('Hosted attachment bytes are unavailable');
  });
});
