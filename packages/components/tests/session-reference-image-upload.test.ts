import { describe, expect, it, vi } from 'vitest';
import type { SessionId, WorkspaceId } from '@molly/shared';
import { uploadSessionReferenceImage } from '../src/lib/session-image-upload';
const local = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/lib/electron-session-file-sender', () => ({
  sendSessionFileToLocalRuntime: async ({ file }: { file: File }) =>
    local.fail
      ? { ok: false, error: 'storage full' }
      : {
          ok: true,
          files: [
            {
              type: 'file',
              fileId: 'file-reference',
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              sha256: 'a'.repeat(64),
              transport: 'local',
              machineId: 'machine-1',
              uploadedAt: 1,
              textPreview: false,
            },
          ],
        },
}));
const args = () => ({
  workspaceId: 'workspace-1' as WorkspaceId,
  sessionId: 'reserved-session' as SessionId,
  localMachineId: 'machine-1',
  file: new File(['synthetic'], 'reference.jpeg', { type: 'image/jpeg' }),
});
describe('local reference image upload', () => {
  it('accepts JPEG without product authentication and pins the reserved storage session', async () => {
    local.fail = false;
    expect(await uploadSessionReferenceImage(args())).toMatchObject({
      type: 'file',
      transport: 'local',
      fileName: 'reference.jpeg',
      mimeType: 'image/jpeg',
      storageSessionId: 'reserved-session',
    });
  });
  it('reports local failure without trying authenticated cloud transport', async () => {
    local.fail = true;
    await expect(uploadSessionReferenceImage(args())).rejects.toThrow('storage full');
  });
});
