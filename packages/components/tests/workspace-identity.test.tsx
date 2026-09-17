// @vitest-environment jsdom

import React, { type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import mollyLogo from '../src/assets/molly-icon.png';
import { LoadingPlaceholder } from '../src/components/loading-placeholder';
import { LoroSidebar, type LoroSidebarProps } from '../src/components/loro-sidebar';
import { initI18n } from '../src/i18n';
import { resolveWorkspaceIdentityLogo } from '../src/lib/workspace-identity';

const sidebarProps: LoroSidebarProps = {
  workspaceName: 'Molly',
  userEmail: 'local@lody.invalid',
  workspaces: [{ id: 'local-workspace', name: 'Molly', logo: mollyLogo }],
  currentWorkspaceId: 'local-workspace',
  repoSections: [],
  chats: [],
};

describe('workspace identity capability boundary', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
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
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
    }
    root = undefined;
    container?.remove();
    container = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(node: ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => root?.render(node));
  }

  it('uses the Molly brand logo only for the implicit local workspace', () => {
    expect(resolveWorkspaceIdentityLogo('https://example.com/org.png', false)).toBe(mollyLogo);
    expect(resolveWorkspaceIdentityLogo('https://example.com/org.png', true)).toBe(
      'https://example.com/org.png'
    );
    expect(resolveWorkspaceIdentityLogo(null, true)).toBeNull();
  });

  it('renders the desktop local workspace as a static nameplate', () => {
    render(<LoroSidebar {...sidebarProps} workspaceSwitcherEnabled={false} />);

    const identity = container?.querySelector('[data-workspace-identity]');
    expect(identity?.tagName).toBe('DIV');
    expect(identity?.textContent).toContain('Molly');
    expect(container?.querySelector('[data-workspace-switcher-trigger]')).toBeNull();
  });

  it('keeps the desktop cloud workspace trigger enabled by default', () => {
    render(<LoroSidebar {...sidebarProps} />);

    expect(container?.querySelector('[data-workspace-switcher-trigger]')?.tagName).toBe('BUTTON');
    expect(container?.querySelector('[data-workspace-identity]')).toBeNull();
  });

  it('keeps scoped workspace synchronization visible after the connection is online', () => {
    render(
      <LoroSidebar
        {...sidebarProps}
        connectionUiState="online"
        workspaceSyncing
        labels={{ workspaceSyncing: 'Syncing target workspace…' }}
      />
    );

    const trigger = container?.querySelector('[data-workspace-switcher-trigger]');
    expect(trigger?.getAttribute('aria-busy')).toBe('true');
    expect(trigger?.getAttribute('data-workspace-syncing')).toBe('true');
    const status = container?.querySelector('[data-workspace-status]');
    expect(status?.getAttribute('data-workspace-status')).toBe('syncing');
    expect(status?.textContent).toBe('Syncing target workspace…');
  });

  it('keeps connection failures ahead of workspace synchronization', () => {
    render(
      <LoroSidebar
        {...sidebarProps}
        connectionUiState="offline"
        workspaceSyncing
        labels={{ connectionOffline: 'No connection' }}
      />
    );

    const status = container?.querySelector('[data-workspace-status]');
    expect(status?.getAttribute('data-workspace-status')).toBe('offline');
    expect(status?.textContent).toBe('No connection');
  });

  it('supports a content-scoped loading placeholder without taking over the viewport', () => {
    render(<LoadingPlaceholder variant="content" title="Switching workspace" />);

    const placeholder = container?.querySelector('[data-loading-placeholder-scope]');
    expect(placeholder?.getAttribute('data-loading-placeholder-scope')).toBe('content');
    expect(placeholder?.className).toContain('h-full');
    expect(placeholder?.className).not.toContain('min-h-[100dvh]');
  });
});
