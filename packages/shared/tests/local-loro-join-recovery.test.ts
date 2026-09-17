import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { LocalLoroTransportAdapter } from '../src/local-loro-transport';
import {
  LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION,
  type LocalLoroDataPlaneClientMessage,
  type LocalLoroDataPlaneServerMessage,
} from '../src/local-loro-data-plane';

function createConnection() {
  const sent: LocalLoroDataPlaneClientMessage[] = [];
  const listeners = new Set<(message: LocalLoroDataPlaneServerMessage) => void>();
  const connectionListeners = new Set<(connected: boolean) => void>();
  let connected = true;
  const adapter = new LocalLoroTransportAdapter({
    workspaceId: 'ws',
    peerId: 'peer',
    connection: {
      send: (message) => sent.push(message),
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onStatusChange: (listener) => {
        connectionListeners.add(listener);
        return () => connectionListeners.delete(listener);
      },
      isConnected: () => connected,
    },
  });
  const latestJoin = () => {
    const message = sent.findLast((item) => item.type === 'join');
    if (message?.type !== 'join') throw new Error('expected_join');
    return message;
  };
  const deliverJoin = (join = latestJoin(), withFlockPayload = false) => {
    for (const listener of listeners) {
      listener({
        ...join,
        type: 'joined',
        protocolVersion: LOCAL_LORO_DATA_PLANE_PROTOCOL_VERSION,
        ...(withFlockPayload ? { payload: { kind: 'flock-json' as const, bundle: [] } } : {}),
      });
    }
  };
  return {
    adapter,
    latestJoin,
    deliverJoin,
    setConnected(next: boolean) {
      connected = next;
      for (const listener of connectionListeners) listener(next);
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('local join recovery', () => {
  it('expires a withheld join without allowing health sweeps to renew its deadline', async () => {
    vi.useFakeTimers();
    const transport = createConnection();
    const subscription = transport.adapter.joinDocRoom('doc', new LoroDoc());
    const oldJoin = transport.latestJoin();
    await vi.advanceTimersByTimeAsync(60_000);
    await transport.adapter.reconnect();
    expect(transport.latestJoin().requestId).toBe(oldJoin.requestId);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscription.status).toBe('error');
    await transport.adapter.reconnect();
    expect(transport.latestJoin().requestId).not.toBe(oldJoin.requestId);
    transport.deliverJoin(oldJoin);
    expect(subscription.status).toBe('connecting');
    transport.deliverJoin();
    await subscription.firstSyncedWithRemote;
    expect(subscription.status).toBe('joined');
    await transport.adapter.close();
  });

  it('keeps first sync pending after an import failure and succeeds on retry', async () => {
    vi.useFakeTimers();
    const transport = createConnection();
    let rejectImport = true;
    const subscription = transport.adapter.joinMetaRoom({
      exportJson: () => [],
      importJson: async () => {
        if (rejectImport) throw new Error('import_failed');
      },
      version: () => ({}),
      subscribe: () => () => {},
    });
    let firstSynced = false;
    void subscription.firstSyncedWithRemote.then(() => {
      firstSynced = true;
    });
    transport.deliverJoin(transport.latestJoin(), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(subscription.status).toBe('error');
    expect(firstSynced).toBe(false);
    rejectImport = false;
    await transport.adapter.reconnect();
    transport.deliverJoin(transport.latestJoin(), true);
    await subscription.firstSyncedWithRemote;
    expect(subscription.status).toBe('joined');
    await transport.adapter.close();
  });

  it('does not let an old export failure poison a reconnected room', async () => {
    vi.useFakeTimers();
    const transport = createConnection();
    let onChange: ((batch: { source?: string }) => void) | undefined;
    let rejectExport: (error: Error) => void = () => {
      throw new Error('export_not_started');
    };
    let started: () => void = () => {};
    const exportStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let deferExport = false;
    const subscription = transport.adapter.joinMetaRoom({
      exportJson: () => {
        if (!deferExport) return [];
        deferExport = false;
        return new Promise<never>((_resolve, reject) => {
          rejectExport = reject;
          started();
        });
      },
      importJson: () => {},
      version: () => ({}),
      subscribe: (listener) => {
        onChange = listener;
        return () => {
          onChange = undefined;
        };
      },
    });
    transport.deliverJoin();
    await subscription.firstSyncedWithRemote;
    deferExport = true;
    onChange?.({ source: 'local' });
    await exportStarted;
    transport.setConnected(false);
    transport.setConnected(true);
    transport.deliverJoin();
    await vi.advanceTimersByTimeAsync(0);
    expect(subscription.status).toBe('joined');
    rejectExport(new Error('old_export_failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(subscription.status).toBe('joined');
    await transport.adapter.close();
  });

  it('cannot be revived by a join reply or deadline after close', async () => {
    vi.useFakeTimers();
    const transport = createConnection();
    const subscription = transport.adapter.joinDocRoom('doc', new LoroDoc());
    const join = transport.latestJoin();
    await transport.adapter.close();
    transport.deliverJoin(join);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscription.status).toBe('disconnected');
  });
});
