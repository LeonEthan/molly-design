import { atomWithProductStorage } from '@/lib/atom-with-product-storage';
import { mollyStorage } from '@/lib/product-storage';
import { atom } from 'jotai';

import type { MachineId, SupportedLanguage } from '@molly/shared';
import { isSymbolFontFamily } from '@/lib/local-fonts';
import {
  SETTINGS_DEFAULT_TAB,
  type SettingsTabId,
} from '@/components/settings/settings-tabs';

export const languageAtom = atomWithProductStorage<SupportedLanguage>('molly-language', 'en');

export const DEFAULT_CONVERSATION_FONT_SIZE = 14;
export const CONVERSATION_FONT_SIZE_MIN = 9;
export const CONVERSATION_FONT_SIZE_MAX = 32;
export type ConversationFontSize = number;

const LEGACY_CONVERSATION_FONT_SIZES: Record<string, ConversationFontSize> = {
  small: 12,
  default: DEFAULT_CONVERSATION_FONT_SIZE,
  large: 16,
};

export function normalizeConversationFontSize(value: unknown): ConversationFontSize {
  const migratedValue = typeof value === 'string' ? LEGACY_CONVERSATION_FONT_SIZES[value] : value;
  if (typeof migratedValue !== 'number' || !Number.isFinite(migratedValue)) {
    return DEFAULT_CONVERSATION_FONT_SIZE;
  }
  return Math.min(
    CONVERSATION_FONT_SIZE_MAX,
    Math.max(CONVERSATION_FONT_SIZE_MIN, Math.round(migratedValue))
  );
}

const conversationFontSizeStorageAtom = atomWithProductStorage<unknown>(
  'molly-conversation-font-size',
  DEFAULT_CONVERSATION_FONT_SIZE
);

export const conversationFontSizeAtom = atom(
  (get) => normalizeConversationFontSize(get(conversationFontSizeStorageAtom)),
  (_get, set, nextValue: ConversationFontSize) => {
    set(conversationFontSizeStorageAtom, normalizeConversationFontSize(nextValue));
  }
);

export const INTERFACE_FONT_FAMILY_MAX_LENGTH = 100;

export function normalizeInterfaceFontFamily(value: unknown): string {
  return typeof value === 'string' && !isSymbolFontFamily(value)
    ? value.trim().slice(0, INTERFACE_FONT_FAMILY_MAX_LENGTH)
    : '';
}

const interfaceFontFamilyStorageAtom = atomWithProductStorage<unknown>('molly-interface-font-family', '');

export const interfaceFontFamilyAtom = atom(
  (get) => normalizeInterfaceFontFamily(get(interfaceFontFamilyStorageAtom)),
  (_get, set, nextValue: string) => {
    set(interfaceFontFamilyStorageAtom, normalizeInterfaceFontFamily(nextValue));
  }
);

export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const TERMINAL_FONT_SIZE_MIN = 9;
export const TERMINAL_FONT_SIZE_MAX = 24;
export const TERMINAL_FONT_FAMILY_MAX_LENGTH = 100;

export function normalizeTerminalFontFamily(value: unknown): string {
  return typeof value === 'string' && !isSymbolFontFamily(value)
    ? value.trim().slice(0, TERMINAL_FONT_FAMILY_MAX_LENGTH)
    : '';
}

export function normalizeTerminalFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)));
}

const terminalFontFamilyStorageAtom = atomWithProductStorage<unknown>('molly-terminal-font-family', '');

export const terminalFontFamilyAtom = atom(
  (get) => normalizeTerminalFontFamily(get(terminalFontFamilyStorageAtom)),
  (_get, set, nextValue: string) => {
    set(terminalFontFamilyStorageAtom, normalizeTerminalFontFamily(nextValue));
  }
);

const terminalFontSizeStorageAtom = atomWithProductStorage<unknown>(
  'molly-terminal-font-size',
  DEFAULT_TERMINAL_FONT_SIZE
);

export const terminalFontSizeAtom = atom(
  (get) => normalizeTerminalFontSize(get(terminalFontSizeStorageAtom)),
  (_get, set, nextValue: number) => {
    set(terminalFontSizeStorageAtom, normalizeTerminalFontSize(nextValue));
  }
);

// Desktop settings modal open state. On desktop (non-mobile) the settings UI is a
// modal overlay driven by this atom instead of a full-page route. Mobile keeps the
// route-based settings page and ignores this atom.
export const settingsDialogOpenAtom = atom<boolean>(false);

// Which tab the desktop settings modal shows. Mirrors the route-based tab on mobile.
export const settingsActiveTabAtom = atom<SettingsTabId>(SETTINGS_DEFAULT_TAB);

// Optional resource targets used by Account shortcuts. Routes keep the same
// values in search params on mobile; the desktop modal keeps them here while
// switching between its Account, Agents, Projects, and machine-detail views.
export const settingsSelectedMachineIdAtom = atom<MachineId | null>(null);
export const settingsSelectedProjectKeyAtom = atom<string | null>(null);

// Notification prompt dismissed state - persisted to localStorage
// When true, the notification permission prompt will not be shown again
export const notificationPromptDismissedAtom = atomWithProductStorage<boolean>(
  'molly-notification-prompt-dismissed',
  false
);

// Desktop app: whether to send a native notification when an AI turn completes.
export const electronSessionCompletionNotificationsEnabledAtom = atomWithProductStorage<boolean>(
  'molly-electron-session-completion-notifications-enabled',
  true
);

// File viewer (Monaco) line-wrap toggle. Defaults on so a long single line
// (e.g. an unwrapped Markdown paragraph) stays readable without horizontal
// scrolling — especially on mobile. Shared by every SessionMonacoTextViewer
// mount via the viewer reading this atom directly.
export const fileViewerWordWrapAtom = atomWithProductStorage<boolean>(
  'molly-file-viewer-word-wrap',
  true
);

// Sidebar session rows: show only source-code line changes when enabled.
export const sessionSidebarCodeChangesOnlyAtom = atomWithProductStorage<boolean>(
  'molly-session-sidebar-code-changes-only',
  false
);

export const QUEUED_MESSAGE_BEHAVIOR_VALUES = ['queue', 'guide'] as const;
export type QueuedMessageBehavior = (typeof QUEUED_MESSAGE_BEHAVIOR_VALUES)[number];

const queuedMessageBehaviorStorageAtom = atomWithProductStorage<string>(
  'molly-queued-message-behavior',
  'queue'
);

export const queuedMessageBehaviorAtom = atom(
  (get): QueuedMessageBehavior =>
    get(queuedMessageBehaviorStorageAtom) === 'guide' ? 'guide' : 'queue',
  (_get, set, nextValue: QueuedMessageBehavior) => {
    set(queuedMessageBehaviorStorageAtom, nextValue);
  }
);

// Auto-archive a session when its linked PR is merged. Per-user, browser-local.
export const autoArchiveOnPrMergedAtom = atomWithProductStorage<boolean>(
  'molly-auto-archive-on-pr-merged',
  false
);

// Auto-archive a session when its linked PR is closed (without merge). Per-user, browser-local.
export const autoArchiveOnPrClosedAtom = atomWithProductStorage<boolean>(
  'molly-auto-archive-on-pr-closed',
  false
);

/** localStorage keys for developer-only beta gates — keep in sync with the atoms below. */
export const DEVELOPER_MODE_STORAGE_KEY = 'molly-developer-mode-enabled';
export const TASKS_BETA_STORAGE_KEY = 'molly-tasks-beta-enabled';
export const INBOX_BETA_STORAGE_KEY = 'molly-inbox-beta-enabled';

/**
 * Synchronous read of the Tasks feature gate from localStorage.
 *
 * `atomWithProductStorage` without a settled store can still report its default on the
 * first paint (and `getOnInit` only samples storage once at module load, so a
 * test or late write is invisible). Route guards that redirect on `false` must
 * use this on that first frame so a bookmarked `/tasks/$taskId` is not bounced
 * to chat before hydration finishes.
 */
export function readTasksFeatureEnabledFromStorage(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const developerMode = JSON.parse(
      mollyStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) ?? 'false'
    );
    const tasksBeta = JSON.parse(mollyStorage.getItem(TASKS_BETA_STORAGE_KEY) ?? 'false');
    return developerMode === true && tasksBeta === true;
  } catch {
    return false;
  }
}

// getOnInit samples storage when the atom module loads so a cold SPA boot
// (the deep-link case) already has the right init value.
export const developerModeEnabledAtom = atomWithProductStorage<boolean>(
  DEVELOPER_MODE_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true }
);

// Opt-in for the Tasks beta. Reachable only from the beta section of Settings,
// which itself only renders while Developer mode is on.
export const tasksBetaEnabledAtom = atomWithProductStorage<boolean>(
  TASKS_BETA_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true }
);

/**
 * The single gate every Tasks surface reads — sidebar entry, routes, commands,
 * quick-add, index sync, status watcher, session task chip, and the agent's task
 * proposal card. When it is false the feature must be indistinguishable from one
 * that was never built.
 *
 * Developer mode is part of the condition, not merely the way to reach the
 * switch: turning Developer mode off has to hide Tasks again, and it does so
 * without discarding the opt-in, so turning it back on restores the choice.
 */
export const tasksFeatureEnabledAtom = atom(
  (get) => get(developerModeEnabledAtom) && get(tasksBetaEnabledAtom)
);

// Opt-in for the unfinished mobile Inbox. Like Tasks, this is reachable only
// from the beta section while Developer mode is on.
export const inboxBetaEnabledAtom = atomWithProductStorage<boolean>(
  INBOX_BETA_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true }
);

/** The single gate for showing the unfinished mobile Inbox entry. */
export const inboxFeatureEnabledAtom = atom(
  (get) => get(developerModeEnabledAtom) && get(inboxBetaEnabledAtom)
);

/** localStorage keys for the experimental features gate. */
export const EXPERIMENTAL_FEATURES_STORAGE_KEY = 'molly-experimental-features-enabled';
export const REVIEW_AGENT_EXPERIMENT_STORAGE_KEY = 'molly-review-agent-enabled';

/**
 * Master switch for user-facing experimental features.
 *
 * Deliberately NOT behind Developer mode. That gate is for internal diagnostics
 * and is reached by a hidden gesture, which is the right shape for a debug
 * surface and the wrong one for a feature people are meant to find and try.
 * Experimental features are opt-in, not hidden.
 */
export const experimentalFeaturesEnabledAtom = atomWithProductStorage<boolean>(
  EXPERIMENTAL_FEATURES_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true }
);

/** Opt-in for the review agent, listed once experimental features are on. */
export const reviewAgentExperimentEnabledAtom = atomWithProductStorage<boolean>(
  REVIEW_AGENT_EXPERIMENT_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true }
);

/**
 * The single gate every review-agent surface reads.
 *
 * Note what this gate does NOT control: a run already authorized on a session
 * keeps going, because the authorization is durable session state that the
 * machine acts on, and this switch is per-device UI visibility. Turning the
 * experiment off hides the controls; it does not silently abandon a branch the
 * user was told would be merged.
 */
export const reviewAgentFeatureEnabledAtom = atom(
  (get) => get(experimentalFeaturesEnabledAtom) && get(reviewAgentExperimentEnabledAtom)
);
