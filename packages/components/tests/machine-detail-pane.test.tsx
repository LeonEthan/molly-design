// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { MachineId, MachineViewMeta } from '@molly/shared';
import { MachineDetailPane } from '../src/components/settings/machine-detail-pane';
import { initI18n } from '../src/i18n';
import { TooltipProvider } from '../src/ui/tooltip';

const machine: MachineViewMeta = {
  id: 'machine-test' as MachineId,
  name: 'MacBook Pro',
  cliVersion: '0.57.0',
  os: 'macOS',
  sessions: [],
  raceLimits: {},
  ownerUserId: 'user-1',
};

const findConfirmDialog = (): HTMLElement => {
  const dialog = document.body.querySelector<HTMLElement>('[role="alertdialog"]');
  if (!dialog) throw new Error('Expected the revoke confirm dialog');
  return dialog;
};

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('MachineDetailPane local machine removal', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  const renderPane = async (
    options?: {
      readOnly?: boolean;
      canDelete?: boolean;
      onDelete?: (machine: MachineViewMeta) => Promise<void>;
    }
  ) => {
    await act(async () => {
      root?.render(
        <TooltipProvider>
          <MachineDetailPane
            machine={machine}
            readOnly={options?.readOnly}
            configs={[]}
            isOwn
            isLocal
            ownerName={null}
            canDelete={options?.canDelete ?? false}
            onRename={vi.fn(async () => {})}
            onDelete={options?.onDelete ?? vi.fn(async () => {})}
            onAddConfig={vi.fn()}
            onEditConfig={vi.fn()}
          />
        </TooltipProvider>
      );
    });
  };

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await initI18n('en');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = undefined;
    container?.remove();
    container = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps removal discoverable while an owned machine is online', async () => {
    await renderPane();

    const removeButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove from workspace"]'
    );
    expect(removeButton).not.toBeNull();
    expect(removeButton?.disabled).toBe(true);
  });

  it('removes an offline owned machine from the current workspace after confirmation', async () => {
    const onDelete = vi.fn(async () => {});
    await renderPane({ canDelete: true, onDelete });

    const removeButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove from workspace"]'
    );
    if (!removeButton) throw new Error('Expected the remove-from-workspace button');
    await click(removeButton);

    const dialog = findConfirmDialog();
    expect(dialog.textContent).toContain('Remove machine from workspace?');
    const confirmButton = Array.from(dialog.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Remove'
    );
    if (!confirmButton) throw new Error('Expected the remove confirmation button');
    await click(confirmButton);

    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith(machine));
  });

  it('does not expose owner mutations on the workspace Machines surface', async () => {
    await renderPane({ readOnly: true });

    expect(document.body.querySelector('button[aria-label="Edit machine name"]')).toBeNull();
    expect(
      document.body.querySelector('[aria-label="Share MacBook Pro with the team"]')
    ).toBeNull();
    expect(document.body.querySelector('button[aria-label="Revoke machine access"]')).toBeNull();
    expect(document.body.querySelector('button[aria-label="Remove from workspace"]')).toBeNull();
  });
});
