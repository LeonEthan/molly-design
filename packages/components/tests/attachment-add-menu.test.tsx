// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceMcpServerMeta } from '@molly/shared';
import { AttachmentAddMenu } from '../src/components/chat/attachment-add-menu';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class TestPointerEvent extends MouseEvent {
  readonly pointerType: string;

  constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? '';
  }
}

describe('AttachmentAddMenu', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    await initI18n('en');
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('opens the file picker directly when attachment is the only action', async () => {
    const onAddAttachment = vi.fn();
    await act(async () => {
      root.render(<AttachmentAddMenu onAddAttachment={onAddAttachment} />);
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add attachment"]'
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger!.click());

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(onAddAttachment).toHaveBeenCalledOnce();
  });

  it('keeps the menu once MCP joins the attachment action', async () => {
    const onAddAttachment = vi.fn();
    await act(async () => {
      root.render(
        <AttachmentAddMenu
          onAddAttachment={onAddAttachment}
          mcp={{
            servers: [
              {
                id: 'server-1',
                name: 'Server 1',
                transport: 'stdio',
                connection: { transport: 'stdio', command: 'serve' },
              } as unknown as WorkspaceMcpServerMeta,
            ],
            selectedIds: [],
            onSelectedIdsChange: () => undefined,
          }}
        />
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add attachment"]'
    );
    await act(async () => {
      trigger!.dispatchEvent(
        new TestPointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
        })
      );
    });

    const items = document.body.querySelectorAll<HTMLElement>('[role="menuitem"]');
    expect(items[0]?.textContent).toContain('Add attachment');
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(onAddAttachment).not.toHaveBeenCalled();
    await act(async () => items[0]!.click());
    expect(onAddAttachment).toHaveBeenCalledOnce();
  });
});
