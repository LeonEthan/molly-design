// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppearanceSettingsView } from '../src/components/settings/appearance-setting';
import type { Theme } from '../src/theme-provider';
import { initI18n } from '../src/i18n';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../src/ui/dialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalScrollIntoView = Element.prototype.scrollIntoView;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function AppearanceHarness({ isElectron }: { isElectron: boolean }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [interfaceFontFamily, setInterfaceFontFamily] = useState('Atkinson Hyperlegible');
  const [conversationFontSize, setConversationFontSize] = useState(14);

  return (
    <AppearanceSettingsView
      theme={theme}
      onThemePreview={setTheme}
      onThemeCommit={setTheme}
      onThemeCancel={vi.fn()}
      conversationFontSize={conversationFontSize}
      onConversationFontSizeChange={setConversationFontSize}
      isElectron={isElectron}
      interfaceFontFamily={interfaceFontFamily}
      onInterfaceFontFamilyChange={setInterfaceFontFamily}
      systemFontFamilies={['Atkinson Hyperlegible', 'Fira Code', 'Maple Mono', 'SF Mono']}
      systemFontLoadState="loaded"
      onSystemFontMenuOpen={vi.fn()}
    />
  );
}

describe('AppearanceSettingsView', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    root = undefined;
    container = undefined;
  });

  it('lets the user pick System in the theme selector', async () => {
    await act(async () => root?.render(<AppearanceHarness isElectron={false} />));

    const themeTrigger = Array.from(container?.querySelectorAll('button') ?? []).find((node) =>
      node.textContent?.includes('Light')
    );
    expect(themeTrigger).toBeTruthy();

    await act(async () => {
      themeTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const systemOption = Array.from(document.body.querySelectorAll('[data-preview-item]')).find(
      (node) => node.textContent?.includes('System')
    );
    expect(systemOption).toBeTruthy();

    await act(async () => {
      systemOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(themeTrigger?.textContent).toContain('System');
  });

  it('shows theme and language while hiding Electron-only settings outside Electron', async () => {
    await act(async () => root?.render(<AppearanceHarness isElectron={false} />));

    expect(container?.textContent).toContain('Conversation font size');
    expect(container?.textContent).toContain('Theme');
    expect(container?.textContent).toContain('Language');
    expect(container?.textContent).not.toContain('Interface font');
    expect(container?.textContent).not.toContain('Terminal');
  });

  it('lets the user enter a custom conversation font size', async () => {
    await act(async () => root?.render(<AppearanceHarness isElectron={false} />));

    const sizeInput = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Conversation font size"]'
    );
    expect(sizeInput?.value).toBe('14');

    await act(async () => {
      setInputValue(sizeInput!, '24');
    });

    expect(sizeInput?.value).toBe('24');
  });

  it('renders the interface system font selector in Electron', async () => {
    await act(async () => root?.render(<AppearanceHarness isElectron />));

    const interfaceFontTrigger = Array.from(container?.querySelectorAll('button') ?? []).find(
      (node) => node.textContent?.includes('Atkinson Hyperlegible')
    );
    expect(container?.textContent).toContain('Interface font');
    expect(container?.textContent).not.toContain('Terminal');
    expect(container?.textContent).not.toContain('Choose a font installed on this computer.');
    expect(interfaceFontTrigger).toBeTruthy();
  });

  it('keeps the font menu inside a settings dialog so the list can scroll', async () => {
    await act(async () =>
      root?.render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Appearance</DialogTitle>
            <DialogDescription>Electron appearance settings</DialogDescription>
            <AppearanceHarness isElectron />
          </DialogContent>
        </Dialog>
      )
    );

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    const fontTrigger = Array.from(dialog?.querySelectorAll('button') ?? []).find((node) =>
      node.textContent?.includes('Atkinson Hyperlegible')
    );
    expect(dialog).toBeTruthy();
    expect(fontTrigger).toBeTruthy();

    await act(async () => {
      fontTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const searchInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Search system fonts..."]'
    );
    expect(searchInput).toBeTruthy();
    expect(dialog?.contains(searchInput ?? null)).toBe(true);
  });
});
