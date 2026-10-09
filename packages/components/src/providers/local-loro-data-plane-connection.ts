import type { LocalLoroDataPlaneConnection } from '@molly/shared/local-loro-transport';
import { getIpcServices, onIpcEvent, sendIpc } from '@/lib/electron-ipc-client';

export function createLocalLoroDataPlaneConnection(): {
  connection: LocalLoroDataPlaneConnection;
  dispose: () => void;
} | null {
  if (!getIpcServices()) return null;

  let connected = false;
  let receivedStatus = false;
  let disposed = false;
  const statusListeners = new Set<(connected: boolean) => void>();
  const setConnected = (next: boolean) => {
    if (disposed || connected === next) return;
    connected = next;
    for (const listener of statusListeners) listener(next);
  };
  const unsubscribeStatus = onIpcEvent('loro.status', (next) => {
    receivedStatus = true;
    setConnected(next);
  });
  sendIpc('loro.subscribe', null);
  void getIpcServices()!
    .loro.isConnected()
    .then((snapshot) => {
      if (!receivedStatus) setConnected(snapshot);
    });

  return {
    connection: {
      send: (message) => sendIpc('loro.send', message),
      onMessage: (listener) => onIpcEvent('loro.event', listener),
      onStatusChange: (listener) => {
        statusListeners.add(listener);
        listener(connected);
        return () => statusListeners.delete(listener);
      },
      isConnected: () => connected,
    },
    dispose: () => {
      disposed = true;
      unsubscribeStatus();
      statusListeners.clear();
    },
  };
}
