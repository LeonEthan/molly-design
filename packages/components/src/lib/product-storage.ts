/** Per-key compatibility in this renderer's existing Molly storage origin. Never enumerate storage. */
function legacyKey(key: string): string | undefined {
  return /^molly[:._-]/.test(key) ? key.replace(/^molly/, 'lody') : undefined;
}

export function readProductStorage(storage: Pick<Storage, 'getItem'>, key: string): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  const legacy = legacyKey(key);
  return legacy ? storage.getItem(legacy) : null;
}

export const mollyStorage = {
  getItem(key: string): string | null {
    return readProductStorage(localStorage, key);
  },
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    // An explicit reset must not resurrect the old value on the next read.
    const legacy = legacyKey(key);
    if (legacy) localStorage.removeItem(legacy);
    localStorage.removeItem(key);
  },
  subscribe(key: string, callback: (value: string | null) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === key || event.key === legacyKey(key) || event.key === null)
      ) {
        callback(mollyStorage.getItem(key));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  },
};
