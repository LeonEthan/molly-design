import net from 'node:net';
import { once } from 'node:events';
import {
  createJsonLineSplitter,
  LocalLoroDataPlaneServerMessageSchema,
  LOCAL_LORO_DATA_PLANE_MAX_FRAME_BYTES,
  type LocalLoroDataPlaneServerMessage,
} from '@molly/shared';
import { getLocalLoroDataPlaneSocketPath } from '@molly/shared/node/local-ipc';
import type { LocalLoroDataPlaneConnection } from '@molly/shared/local-loro-transport';

/** A one-shot MCP workspace manager joins the daemon's existing local Loro plane. */
export async function connectLocalLoroDataPlane(): Promise<{
  connection: LocalLoroDataPlaneConnection;
  close: () => void;
}> {
  const socket = net.createConnection(getLocalLoroDataPlaneSocketPath('local'));
  try {
    await once(socket, 'connect');
  } catch (error) {
    socket.destroy();
    throw new Error('The local Molly daemon data plane is unavailable.', { cause: error });
  }

  let connected = true;
  const messageListeners = new Set<(message: LocalLoroDataPlaneServerMessage) => void>();
  const statusListeners = new Set<(connected: boolean) => void>();
  const setDisconnected = () => {
    if (!connected) return;
    connected = false;
    for (const listener of statusListeners) listener(false);
  };
  const splitLines = createJsonLineSplitter({
    maxBufferBytes: LOCAL_LORO_DATA_PLANE_MAX_FRAME_BYTES,
    onOverflow: () => socket.destroy(),
    onLine: (line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      const parsed = LocalLoroDataPlaneServerMessageSchema.safeParse(value);
      if (!parsed.success) {
        socket.destroy();
        return;
      }
      for (const listener of messageListeners) listener(parsed.data);
    },
  });
  socket.on('data', (chunk: Buffer) => splitLines(chunk));
  socket.on('close', setDisconnected);
  socket.on('error', () => socket.destroy());

  return {
    connection: {
      send(message) {
        if (!connected) throw new Error('The local data plane disconnected.');
        socket.write(`${JSON.stringify(message)}\n`);
      },
      onMessage(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      onStatusChange(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
      isConnected: () => connected,
    },
    close: () => socket.destroy(),
  };
}
