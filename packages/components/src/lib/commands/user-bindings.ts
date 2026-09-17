import { mollyStorage } from '@/lib/product-storage';
import { z } from 'zod';

/**
 * Persisted user overrides for command keybindings.
 *
 * Shape: `Record<commandId, string[]>`
 *   - missing entry → use the command's declared defaults
 *   - empty array  → user explicitly unbound the command (no keys fire it)
 *   - one or more strings → fully replaces the command's declared bindings
 *
 * Stored in localStorage (per-device): a keymap is tied to the physical keyboard, not
 * the workspace, so we deliberately don't sync it via Loro.
 */

const STORAGE_KEY = 'molly.commandOverrides.v1';

const userBindingsSchema = z.record(z.string(), z.array(z.string()));
export type UserBindingsMap = z.infer<typeof userBindingsSchema>;

export function loadUserBindings(): UserBindingsMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = mollyStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = userBindingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.warn('[commands] discarding malformed user bindings', parsed.error);
    mollyStorage.removeItem(STORAGE_KEY);
    return {};
  } catch (error) {
    console.warn('[commands] failed to load user bindings; clearing', error);
    try {
      mollyStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return {};
  }
}

export function saveUserBindings(map: UserBindingsMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (Object.keys(map).length === 0) {
      mollyStorage.removeItem(STORAGE_KEY);
    } else {
      mollyStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
  } catch (error) {
    console.warn('[commands] failed to save user bindings', error);
  }
}
