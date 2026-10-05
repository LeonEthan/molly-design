import type { Platform, Runtime } from './types';

let cachedPlatform: Platform | null = null;
let cachedRuntime: Runtime | null = null;

export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;
  if (typeof window === 'undefined') return 'unknown';

  const electronOs = (window as { __MOLLY_PLATFORM__?: { os?: string } }).__MOLLY_PLATFORM__?.os;
  if (electronOs === 'darwin') return (cachedPlatform = 'mac');
  if (electronOs === 'win32') return (cachedPlatform = 'win');
  if (electronOs === 'linux') return (cachedPlatform = 'linux');

  const platform = (navigator.platform || '').toLowerCase();
  if (platform.includes('mac')) return (cachedPlatform = 'mac');
  if (platform.includes('win')) return (cachedPlatform = 'win');
  if (platform.includes('linux')) return (cachedPlatform = 'linux');
  return (cachedPlatform = 'unknown');
}

export function getRuntime(): Runtime {
  if (cachedRuntime) return cachedRuntime;
  if (typeof window === 'undefined') return 'web';
  if (window.__MOLLY_ELECTRON__) return (cachedRuntime = 'electron');
  return (cachedRuntime = 'web');
}

export function isMac(): boolean {
  return getPlatform() === 'mac';
}

// Test-only: reset module-cached platform/runtime for tests that mock window globals.
export function __resetPlatformCacheForTests(): void {
  cachedPlatform = null;
  cachedRuntime = null;
}
