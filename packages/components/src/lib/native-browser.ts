import { isElectronRenderer } from './electron';
import { getIpcServices } from './electron-ipc-client';

export async function openExternalUrl(url: string): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  const isElectron = isElectronRenderer();
  if (isElectron && getIpcServices()) {
    try {
      const result = await getIpcServices()!.app.openExternalUrl(url);
      if (result.opened) {
        return true;
      }
      console.error('Failed to open URL with Electron shell', result.error ?? 'unknown error');
      return false;
    } catch (error) {
      console.error('Failed to open URL with Electron shell', error);
      return false;
    }
  }

  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (openedWindow) {
    openedWindow.opener = null;
  }

  return openedWindow !== null || isElectron;
}
