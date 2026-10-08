// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({ list: [] as unknown[] }));
const reports = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('../src/atoms/doc-meta', async () => {
  const { atom } = await import('jotai');
  return { sessionListAtom: atom(() => sessions.list) };
});
vi.mock('../src/atoms', async () => {
  const { atom } = await import('jotai');
  return { userAtom: atom({ id: 'user-1' }) };
});
vi.mock('../src/hooks/use-resolved-workspace-scope', () => ({
  useResolvedWorkspaceScope: () => ({ workspaceId: 'workspace-1', enabled: true }),
}));
vi.mock('../src/lib/electron', () => ({ isElectronRenderer: () => true }));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    app: { setWindowBadge: async (badge: unknown) => void reports.calls.push(badge) },
  }),
}));

import { useWorkspaceBadge } from '../src/hooks/use-workspace-badge';
import { mollyPresenceNowMsAtom, mollyPresenceStatesAtom } from '../src/atoms/presence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useWorkspaceBadge();
  return null;
}

const NOW = 1_000_000;
const presence = (sessionId: string, type: 'running' | 'requestPermission', ageMs = 0) => ({
  kind: 'session' as const,
  sessionId,
  machineId: 'machine-1',
  instanceId: `${sessionId}-instance`,
  status: { type },
  updatedAt: NOW - ageMs,
});

describe('useWorkspaceBadge working count', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    reports.calls = [];
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
  });

  async function mount(states: Record<string, unknown>) {
    const store = createStore();
    store.set(mollyPresenceNowMsAtom, NOW);
    store.set(mollyPresenceStatesAtom, states as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(Provider, { store }, createElement(Probe))));
    await act(async () => vi.advanceTimersByTime(200));
    return reports.calls.filter((call) => (call as { unread: number }).unread !== undefined) as {
      unread: number;
      waiting: number;
      working: number;
    }[];
  }

  it('counts sessions that are running or waiting as working, and not idle ones', async () => {
    sessions.list = [
      { id: 'running-a', userId: 'user-1' },
      { id: 'waiting-b', userId: 'user-1' },
      { id: 'idle-c', userId: 'user-1' },
      { id: 'other-owner-d', userId: 'user-2' },
    ];
    const calls = await mount({
      a: presence('running-a', 'running'),
      b: presence('waiting-b', 'requestPermission'),
      d: presence('other-owner-d', 'running'),
    });
    expect(calls.at(-1)).toMatchObject({ waiting: 1, working: 2 });
  });

  it('does not count a run whose heartbeat has gone stale', async () => {
    sessions.list = [{ id: 'stale-e', userId: 'user-1' }];
    const calls = await mount({ e: presence('stale-e', 'running', 10 * 60_000) });
    expect(calls.at(-1)).toMatchObject({ working: 0 });
  });
});
