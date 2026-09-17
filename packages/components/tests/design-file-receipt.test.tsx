// @vitest-environment jsdom
import React, { act } from 'react';
import { Provider, createStore } from 'jotai';
import type { SessionId, WorkspaceId } from '@molly/shared';
import { currentWorkspaceIdAtom } from '../src/atoms';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DesignFileReceipt } from '../src/components/sessions/design-file-receipt';
import { initI18n } from '../src/i18n';
const resolveFile = vi.hoisted(() => vi.fn());
const sourcePath = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    design: { candidateFile: resolveFile },
    machineRpc: { send: sourcePath },
  }),
}));
const artworkId = 'aacdd4fb-a160-4c25-9c15-02297145a521';
const candidateId = 'a'.repeat(64);
const outcome = (status: string, extra = {}) => ({
  version: 1,
  artworkId,
  turnId: 'turn-1',
  timestamp: '2026-09-11T00:00:00.000Z',
  status,
  ...extra,
});
let element: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await initI18n('en');
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
  resolveFile.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
});
test('historical candidate opens the verified original file through the ordinary file action', async () => {
  let opened: string | undefined;
  resolveFile.mockImplementation(async (art: string, candidate: string) => {
    if (art !== artworkId || candidate !== candidateId) throw Error('Wrong identity');
    return { path: `/synthetic/chats/${art}/candidates/${candidate}.json` };
  });
  await act(async () =>
    root.render(
      <DesignFileReceipt
        outcome={outcome('candidate', { candidateId })}
        onOpenFile={(path) => {
          opened = path;
        }}
      />
    )
  );
  expect(element.textContent).toContain('not committed');
  expect(element.querySelector('[data-design-result-status]')).toBeNull();
  expect(element.querySelector('img')).toBeNull();
  expect([...element.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    `candidates/${candidateId}.json`,
  ]);
  await act(async () => element.querySelector('button')?.click());
  expect(opened).toBe(`/synthetic/chats/${artworkId}/candidates/${candidateId}.json`);
  resolveFile.mockRejectedValue(Error('Missing original'));
  await act(async () => element.querySelector('button')?.click());
  expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be opened');
});
test('save receipt and rejection diagnostics survive, while execution-only states do not duplicate session status', async () => {
  await act(async () =>
    root.render(
      <DesignFileReceipt outcome={outcome('committed', { revisionId: 'b'.repeat(64) })} />
    )
  );
  expect(element.textContent).toBe('Saved to the current artwork.');
  await act(async () =>
    root.render(
      <DesignFileReceipt
        outcome={outcome('invalid', {
          diagnostics: [
            {
              code: 'MOLLY-E001',
              message:
                'Invalid canvas at /Users/synthetic/private/design.pptd api_key=sk-synthetic12345',
            },
          ],
        })}
      />
    )
  );
  expect(element.textContent).toContain('MOLLY-E001');
  expect(element.textContent).not.toContain('/Users/');
  expect(element.textContent).not.toContain('sk-synthetic');
  expect(element.querySelector('button')).toBeNull();
  for (const status of ['failed', 'cancelled', 'no_artifact']) {
    await act(async () => root.render(<DesignFileReceipt outcome={outcome(status)} />));
    expect(element.textContent).toBe('');
  }
});

test('cancelled working files resolve the historical session and turn through ordinary machine RPC', async () => {
  const store = createStore();
  store.set(currentWorkspaceIdAtom, 'workspace-test' as WorkspaceId);
  let opened: string | undefined;
  sourcePath.mockImplementation(async (request) => {
    expect(request).toEqual({
      machineId: 'machine-test',
      workspaceId: 'workspace-test',
      ownerSessionId: 'history-session',
      method: 'design/source-path',
      params: { turnId: 'turn-1' },
    });
    return {
      ok: true,
      result: { type: 'design/source-path', ok: true, path: '/synthetic/original/design.yaml' },
    };
  });
  await act(async () =>
    root.render(
      <Provider store={store}>
        <DesignFileReceipt
          sessionId={'history-session' as SessionId}
          machineId="machine-test"
          outcome={outcome('cancelled')}
          onOpenFile={(path) => {
            opened = path;
          }}
        />
      </Provider>
    )
  );
  expect(element.textContent).toContain('may have changed');
  expect(element.textContent).not.toContain('Cancelled');
  expect(element.querySelector('button')?.textContent).toBe('design.yaml');
  await act(async () => element.querySelector('button')?.click());
  expect(opened).toBe('/synthetic/original/design.yaml');
  opened = undefined;
  sourcePath.mockResolvedValue({
    ok: true,
    result: { type: 'design/source-path', ok: false, error: 'Changed workspace' },
  });
  await act(async () => element.querySelector('button')?.click());
  expect(opened).toBeUndefined();
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
});
