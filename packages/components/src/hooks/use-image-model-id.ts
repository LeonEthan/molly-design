import { useEffect, useState } from 'react';
import { getIpcServices } from '@/lib/electron-ipc-client';

/** The enabled desktop image connection's model id, or null when none is configured. */
export function useImageModelId(enabled: boolean): string | null {
  const [imageModelId, setImageModelId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const ipc = getIpcServices();
    if (!ipc) return undefined;
    let live = true;
    void ipc.modelConnections
      .getImageSnapshot()
      .then((snapshot) => {
        if (!live) return;
        const model = snapshot.connection?.enabled ? snapshot.connection.model.trim() : '';
        setImageModelId(model.length > 0 ? model : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);
  return imageModelId;
}
