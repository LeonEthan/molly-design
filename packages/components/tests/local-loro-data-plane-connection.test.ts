// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { LocalLoroTransportAdapter } from '@molly/shared/local-loro-transport';
import {
  LocalLoroDataPlaneClientMessageSchema,
  type LocalLoroDataPlaneClientMessage,
} from '@molly/shared/local-loro-data-plane';
import { createLocalLoroDataPlaneConnection } from '../src/providers/local-loro-data-plane-connection';

function installBridge(subscribedStatus?: boolean) {
  const snapshot = Promise.withResolvers<boolean>();
  const listeners = new Map<string, (payload: unknown) => void>();
  const sent: LocalLoroDataPlaneClientMessage[] = [];
  window.ipc = {
    invoke: () => snapshot.promise,
    send: (channel, payload) => {
      if (channel === 'loro.subscribe' && subscribedStatus !== undefined) {
        listeners.get('loro.status')?.(subscribedStatus);
      }
      if (channel === 'loro.send') {
        sent.push(LocalLoroDataPlaneClientMessageSchema.parse(payload));
      }
    },
    on: (channel, listener) => {
      listeners.set(channel, listener);
      return () => {
        listeners.delete(channel);
      };
    },
  };
  return {
    sent,
    emitStatus: (connected: boolean) => listeners.get('loro.status')?.(connected),
    emitMessage: (message: unknown) => listeners.get('loro.event')?.(message),
    resolveSnapshot: async (connected: boolean) => {
      snapshot.resolve(connected);
      await snapshot.promise;
    },
  };
}

afterEach(() => {
  delete window.ipc;
  vi.useRealTimers();
});

describe('local data-plane connection bootstrap', () => {
  it('preserves an in-flight room join when a stale disconnected snapshot arrives', async () => {
    vi.useFakeTimers();
    const bridge = installBridge();
    const local = createLocalLoroDataPlaneConnection()!;
    const transport = new LocalLoroTransportAdapter({
      workspaceId: 'workspace-test',
      peerId: 'renderer-test',
      connection: local.connection,
    });
    const room = transport.joinDocRoom('session-test', new LoroDoc());
    try {
      bridge.emitStatus(true);
      const join = bridge.sent.find((message) => message.type === 'join');
      expect(join?.type).toBe('join');
      await bridge.resolveSnapshot(false);
      bridge.emitMessage({ ...join, type: 'joined' });

      expect(room.status).toBe('joined');
      expect(transport.getStatus()).toBe('connected');
    } finally {
      await transport.close();
      local.dispose();
    }
  });

  it('preserves a live disconnect over an older connected snapshot', async () => {
    const bridge = installBridge();
    const local = createLocalLoroDataPlaneConnection()!;
    bridge.emitStatus(false);
    await bridge.resolveSnapshot(true);
    expect(local.connection.isConnected()).toBe(false);
    bridge.emitStatus(true);
    expect(local.connection.isConnected()).toBe(true);
    local.dispose();
  });

  it('uses the snapshot when the existing relay has no new status event', async () => {
    const bridge = installBridge();
    const local = createLocalLoroDataPlaneConnection()!;
    await bridge.resolveSnapshot(true);
    expect(local.connection.isConnected()).toBe(true);
    bridge.emitStatus(false);
    expect(local.connection.isConnected()).toBe(false);
    local.dispose();
  });

  it('observes the initial subscription status before a snapshot resolves', async () => {
    const bridge = installBridge(true);
    const local = createLocalLoroDataPlaneConnection()!;
    expect(local.connection.isConnected()).toBe(true);
    await bridge.resolveSnapshot(false);
    expect(local.connection.isConnected()).toBe(true);
    local.dispose();
  });

  it('ignores an outstanding snapshot after disposal', async () => {
    const bridge = installBridge();
    const local = createLocalLoroDataPlaneConnection()!;
    local.dispose();
    await bridge.resolveSnapshot(true);
    expect(local.connection.isConnected()).toBe(false);
  });
});
