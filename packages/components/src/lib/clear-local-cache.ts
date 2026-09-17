import { getIpcServices } from './electron-ipc-client';

/** Reload the local desktop renderer without touching any saved data. */
export function reloadApp(): void {
  if (typeof window === 'undefined') return;
  if (window.__MOLLY_ELECTRON__ === true && getIpcServices()) {
    void getIpcServices()!.app.requestRendererReload();
    return;
  }
  window.location.reload();
}
