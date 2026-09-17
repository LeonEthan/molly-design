import { atom } from 'jotai';
import type { CurrentUser } from '@/lib/current-user';

export * from './settings';
export * from './machines';
export * from './agents';
export * from './workspace-context';
export * from './repo';
export * from './runtime';
export * from './doc-meta';
export * from './machine-flock';
export * from './control-connection';
export * from './local-storage-cache';
export * from './sidebar-state';
export * from './layout-state';
export * from './settings-machine-tab';
export * from './focus-layer';
export * from './onboarding';
export * from './join-community';

export const userAtom = atom<CurrentUser | null>(null);
