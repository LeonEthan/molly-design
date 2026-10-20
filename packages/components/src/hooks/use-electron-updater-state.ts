import { useEffect, useState } from 'react';
import type { ElectronUpdaterState } from '@molly/shared';
import { getIpcServices, onIpcEvent } from '@/lib/electron-ipc-client';
import { shouldApplyUpdaterSnapshot } from '@/lib/updater-check-presentation';

export function useElectronUpdaterState(): ElectronUpdaterState | null {
  const [state, setState] = useState<ElectronUpdaterState | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.__MOLLY_ELECTRON__) return undefined;

    if (!getIpcServices()) return undefined;

    let active = true;
    let pushesSinceSnapshot = 0;
    const unsubscribe = onIpcEvent('updater.state', (s) => {
      pushesSinceSnapshot += 1;
      if (active) setState(s);
    });
    void getIpcServices()!
      .updater.getState()
      .then((s) => {
        if (active && shouldApplyUpdaterSnapshot(pushesSinceSnapshot)) setState(s);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}
