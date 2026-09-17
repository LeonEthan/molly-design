import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import { mollyStorage } from './product-storage';

const unavailableStorage = {
  getItem: (_key: string): null => null,
  setItem: (_key: string, _value: string): void => {},
  removeItem: (_key: string): void => {},
};

export function atomWithProductStorage<Value>(
  key: string,
  initialValue: Value,
  storage = createJSONStorage<Value>(() => {
    // Match Jotai's default: server-side atoms remain in memory.
    try {
      return typeof localStorage === 'undefined' ? unavailableStorage : mollyStorage;
    } catch {
      return unavailableStorage;
    }
  }),
  options?: { getOnInit?: boolean }
) {
  return atomWithStorage(key, initialValue, storage, options);
}
