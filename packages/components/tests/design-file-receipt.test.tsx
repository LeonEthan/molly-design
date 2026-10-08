// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  DesignFileReceipt,
  hasDesignFileReceipt,
} from '../src/components/sessions/design-file-receipt';
import { initI18n } from '../src/i18n';
const resolveFile = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    design: { candidateFile: resolveFile },
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
  expect(element.textContent).toContain("wasn't applied");
  expect(element.querySelector('[data-design-result-status]')).toBeNull();
  expect(element.querySelector('img')).toBeNull();
  expect([...element.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    'Open draft',
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

test('a cancelled or failed turn with no diagnostics shows no receipt and no working-file link', async () => {
  for (const status of ['cancelled', 'failed', 'invalid']) {
    expect(hasDesignFileReceipt(outcome(status))).toBe(false);
    await act(async () => root.render(<DesignFileReceipt outcome={outcome(status)} />));
    expect(element.textContent).toBe('');
    expect(element.querySelector('button')).toBeNull();
  }
  expect(hasDesignFileReceipt(outcome('committed', { revisionId: 'b'.repeat(64) }))).toBe(true);
});
