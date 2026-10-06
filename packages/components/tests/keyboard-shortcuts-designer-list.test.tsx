// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeyboardShortcutsSetting } from '../src/components/settings/keyboard-shortcuts-setting';
import { registerBuiltInCommands, unregisterBuiltInCommands } from '../src/lib/commands';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await initI18n('en');
  registerBuiltInCommands();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  unregisterBuiltInCommands();
  vi.unstubAllGlobals();
});

it('lists design shortcuts and leaves code-workflow commands out of the designer list', async () => {
  await act(async () => root.render(<KeyboardShortcutsSetting />));
  const text = host.textContent ?? '';
  expect(text).toContain(en['commands.nav.back']);
  expect(text).toContain(en['commands.session.new']);
  for (const key of [
    'commands.session.copyCurrentBranch',
    'commands.session.saveCurrentFile',
    'commands.session.toggleExplorerSidebar',
    'commands.session.cycleMode',
    'commands.session.cycleProvider',
    'commands.mention.toggleSessionProjectScope',
  ] as const) {
    expect(text).not.toContain(en[key]);
  }
});

it('shows fixed canvas guidance before editable app commands with no rebinding controls', async () => {
  await act(async () => root.render(<KeyboardShortcutsSetting />));
  const sections = host.querySelectorAll('section');
  expect(sections[0].textContent).toContain(en['settings.keyboardShortcuts.canvas']);
  expect(sections[0].textContent).toContain(en['settings.keyboardShortcuts.canvasScope']);
  expect(sections[0].querySelector('button')).toBeNull();
  expect(sections[0].querySelectorAll('kbd').length).toBeGreaterThan(0);
  expect(host.textContent).toContain(en['commands.session.archiveCurrent']);
});
