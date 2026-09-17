// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionFilePayload, SessionId } from '@molly/shared';
import { SessionLocalImage } from '../src/components/ai-gui/session-local-image';
const state = vi.hoisted(() => ({ supported: true, requests: [] as unknown[], fail: false }));
vi.mock('../src/atoms', async () => ({
  currentWorkspaceIdAtom: (await import('jotai')).atom('workspace-1'),
}));
vi.mock('../src/atoms/local-probe', async () => ({
  localMachineIdAtom: (await import('jotai')).atom('machine-1'),
}));
vi.mock('../src/hooks/use-resolved-machine-meta', () => ({
  useResolvedMachineMeta: () => ({
    machine: {
      protocolCapabilities: state.supported ? { localSessionAttachments: 1 } : {},
    },
  }),
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    machineRpc: {
      previewFile: async (request: unknown) => {
        state.requests.push(request);
        if (state.fail) throw new Error('Blob missing');
        return { status: 'resource', kind: 'binary', url: 'lody-file://opaque-image' };
      },
    },
  }),
}));
vi.mock('../src/components/shared/zoomable-image-viewer', () => ({
  ZoomableImageViewer: ({ open, images }: { open: boolean; images: { src?: string }[] }) =>
    open ? createElement('div', { 'data-viewer-src': images[0]?.src }, 'Image viewer') : null,
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const file: SessionFilePayload = {
  type: 'file',
  fileId: 'file-reference',
  fileName: 'reference.png',
  sha256: 'a'.repeat(64),
  mimeType: 'image/png',
  sizeBytes: 765,
  transport: 'local',
  machineId: 'machine-1',
  uploadedAt: 1,
  textPreview: false,
};
let root: Root | undefined;
let container: HTMLDivElement | undefined;
async function mount(targetFile: SessionFilePayload = file) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(SessionLocalImage, { file: targetFile, sessionId: 'session-1' as SessionId })
    )
  );
}
function unmount() {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
}
afterEach(() => {
  unmount();
  state.requests = [];
  state.fail = false;
  state.supported = true;
});
describe('sent local reference image', () => {
  it('renders the controlled resource, opens the shared viewer, and reads again after remount', async () => {
    await mount();
    expect(container?.querySelector('img')?.getAttribute('src')).toBe('lody-file://opaque-image');
    act(() => container?.querySelector('button')?.click());
    expect(container?.querySelector('[data-viewer-src]')?.getAttribute('data-viewer-src')).toBe(
      'lody-file://opaque-image'
    );
    unmount();
    await mount();
    expect(container?.querySelector('img')?.getAttribute('src')).toBe('lody-file://opaque-image');
    expect(state.requests).toContainEqual({
      machineId: 'machine-1',
      workspaceId: 'workspace-1',
      method: 'file/resolve-local',
      params: {
        v: 3,
        sessionId: 'session-1',
        attachment: { fileId: file.fileId, sha256: file.sha256 },
      },
    });
  });
  it('shows a read error instead of pending upload', async () => {
    state.fail = true;
    await mount();
    expect(container?.textContent).toContain('Blob missing');
    expect(container?.querySelector('button')?.disabled).toBe(true);
  });
  it('asks the local runtime for a legacy relay image retained in its cache', async () => {
    const legacyFile: SessionFilePayload = {
      ...file,
      fileId: 'relay-file-reference',
      transport: 'r2',
      machineId: undefined,
    };
    await mount(legacyFile);
    expect(container?.querySelector('img')?.getAttribute('src')).toBe('lody-file://opaque-image');
    expect(state.requests).toContainEqual({
      machineId: 'machine-1',
      workspaceId: 'workspace-1',
      method: 'file/resolve-local',
      params: {
        v: 3,
        sessionId: 'session-1',
        attachment: { fileId: legacyFile.fileId, sha256: legacyFile.sha256 },
      },
    });
  });
  it('does not send unsupported attachment parameters to an older daemon', async () => {
    state.supported = false;
    await mount();
    expect(container?.querySelector('button')?.disabled).toBe(true);
    expect(state.requests).toEqual([]);
  });
});
