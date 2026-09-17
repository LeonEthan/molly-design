import { afterEach, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { atomWithProductStorage } from '../src/lib/atom-with-product-storage';
import { mollyStorage, readProductStorage } from '../src/lib/product-storage';

afterEach(() => vi.unstubAllGlobals());

it('reads a legacy preference, writes only the new key, and never resurrects a reset value', () => {
  const values = new Map([
    ['lody-language', '"zh_CN"'],
    ['unrelated', 'preserved'],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  vi.stubGlobal('localStorage', storage);
  const atom = atomWithProductStorage('molly-language', 'en', undefined, { getOnInit: true });
  const store = createStore();
  expect(store.get(atom)).toBe('zh_CN');
  store.set(atom, 'en');
  expect(storage.getItem('molly-language')).toBe('"en"');
  expect(storage.getItem('lody-language')).toBe('"zh_CN"');
  expect(readProductStorage(storage, 'molly-language')).toBe('"en"');
  mollyStorage.removeItem('molly-language');
  expect(readProductStorage(storage, 'molly-language')).toBeNull();
  expect(storage.getItem('unrelated')).toBe('preserved');
});

it('does not replace an explicit new value or rewrite old data when a write fails', () => {
  const values = new Map([
    ['lody-language', '"zh_CN"'],
    ['molly-language', ''],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: () => {
      throw new Error('storage full');
    },
  };
  vi.stubGlobal('localStorage', storage);
  expect(readProductStorage(storage, 'molly-language')).toBe('');
  expect(() => mollyStorage.setItem('molly-language', '"en"')).toThrow('storage full');
  expect(values.get('lody-language')).toBe('"zh_CN"');
  expect(values.get('molly-language')).toBe('');
});
