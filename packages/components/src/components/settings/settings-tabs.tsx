import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  FolderOpen,
  Globe2,
  Info,
  Keyboard,
  Monitor,
  Palette,
  Plug,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import { isElectronRenderer } from '@/lib/electron';

export type SettingsSectionId = 'main' | 'other';

export type SettingsTabId =
  | 'account'
  | 'preferences'
  | 'appearance'
  | 'browser-accounts'
  | 'keyboard-shortcuts'
  | 'workspace'
  | 'people'
  | 'machines'
  | 'agents'
  | 'mcp'
  | 'projects'
  | 'advanced'
  | 'ai-usage'
  | 'billing'
  | 'about';

export type SettingsPath =
  | '/$workspaceName/settings/account'
  | '/$workspaceName/settings/preferences'
  | '/$workspaceName/settings/appearance'
  | '/$workspaceName/settings/browser-accounts'
  | '/$workspaceName/settings/keyboard-shortcuts'
  | '/$workspaceName/settings/workspace'
  | '/$workspaceName/settings/people'
  | '/$workspaceName/settings/machines'
  | '/$workspaceName/settings/agents'
  | '/$workspaceName/settings/mcp'
  | '/$workspaceName/settings/projects'
  | '/$workspaceName/settings/advanced'
  | '/$workspaceName/settings/ai-usage'
  | '/$workspaceName/settings/billing'
  | '/$workspaceName/settings/about';

export type SettingsTabConfig = {
  id: SettingsTabId;
  section: SettingsSectionId;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  /** Rendered as a sub-tab inside this tab instead of its own navigation row. */
  parent?: 'advanced';
  /** The workspace machine inventory has no useful distinction in a solo workspace. */
  multiMemberOnly?: boolean;
  localDesktopOnly?: boolean;
  path: SettingsPath;
};

export const SETTINGS_DEFAULT_TAB: SettingsTabId = 'preferences';

export const SETTINGS_TAB_CONFIGS: SettingsTabConfig[] = [
  {
    id: 'preferences',
    section: 'main',
    labelKey: 'settings.tabs.preferences',
    descriptionKey: 'settings.categories.preferences.description',
    icon: SlidersHorizontal,
    path: '/$workspaceName/settings/preferences',
  },
  {
    id: 'appearance',
    section: 'main',
    labelKey: 'settings.tabs.appearance',
    descriptionKey: 'settings.categories.appearance.description',
    icon: Palette,
    path: '/$workspaceName/settings/appearance',
  },
  {
    id: 'agents',
    section: 'main',
    labelKey: 'settings.tabs.agents',
    descriptionKey: 'settings.categories.agents.description',
    icon: Bot,
    path: '/$workspaceName/settings/agents',
  },
  {
    id: 'browser-accounts',
    section: 'main',
    labelKey: 'settings.tabs.browserAccounts',
    descriptionKey: 'settings.categories.browserAccounts.description',
    icon: Globe2,
    localDesktopOnly: true,
    path: '/$workspaceName/settings/browser-accounts',
  },
  {
    id: 'keyboard-shortcuts',
    section: 'main',
    labelKey: 'settings.tabs.keyboardShortcuts',
    descriptionKey: 'settings.categories.keyboardShortcuts.description',
    icon: Keyboard,
    path: '/$workspaceName/settings/keyboard-shortcuts',
  },
  {
    id: 'machines',
    section: 'main',
    labelKey: 'settings.tabs.machines',
    descriptionKey: 'settings.categories.machines.description',
    icon: Monitor,
    multiMemberOnly: true,
    path: '/$workspaceName/settings/machines',
  },
  {
    id: 'advanced',
    section: 'other',
    labelKey: 'settings.tabs.advanced',
    descriptionKey: 'settings.categories.advanced.description',
    icon: Wrench,
    path: '/$workspaceName/settings/advanced',
  },
  {
    id: 'mcp',
    section: 'other',
    parent: 'advanced',
    labelKey: 'settings.tabs.mcp',
    descriptionKey: 'settings.categories.mcp.description',
    icon: Plug,
    path: '/$workspaceName/settings/mcp',
  },
  {
    id: 'projects',
    section: 'other',
    parent: 'advanced',
    labelKey: 'settings.tabs.projects',
    descriptionKey: 'settings.categories.projects.description',
    icon: FolderOpen,
    path: '/$workspaceName/settings/projects',
  },
  {
    id: 'about',
    section: 'other',
    labelKey: 'settings.tabs.about',
    descriptionKey: 'settings.categories.about.description',
    icon: Info,
    path: '/$workspaceName/settings/about',
  },
];

export function useVisibleSettingsTabs(options?: {
  includeMultiMemberOnly?: boolean;
}): SettingsTabConfig[] {
  const includeMultiMemberOnly = options?.includeMultiMemberOnly ?? true;
  return SETTINGS_TAB_CONFIGS.filter(
    (tab) =>
      (!tab.multiMemberOnly || includeMultiMemberOnly) &&
      (!tab.localDesktopOnly || isElectronRenderer())
  );
}

export function getActiveSettingsTabId(pathname: string): SettingsTabId | null {
  const suffixes: Array<[string, SettingsTabId]> = [
    ['/settings/account', 'preferences'],
    ['/settings/preferences', 'preferences'],
    ['/settings/general', 'preferences'],
    ['/settings/appearance', 'appearance'],
    ['/settings/browser-accounts', 'browser-accounts'],
    ['/settings/keyboard-shortcuts', 'keyboard-shortcuts'],
    ['/settings/my-machines', 'machines'],
    ['/settings/workspace', 'preferences'],
    ['/settings/people', 'preferences'],
    ['/settings/machines', 'machines'],
    ['/settings/devices', 'machines'],
    ['/settings/agents', 'agents'],
    ['/settings/agent-config', 'agents'],
    ['/settings/agent-roles', 'preferences'],
    ['/settings/image-connection', 'agents'],
    ['/settings/mcp', 'mcp'],
    ['/settings/projects', 'projects'],
    ['/settings/advanced', 'advanced'],
    ['/settings/ai-usage', 'preferences'],
    ['/settings/stats', 'preferences'],
    ['/settings/billing', 'preferences'],
    ['/settings/about', 'about'],
  ];
  return suffixes.find(([suffix]) => pathname.endsWith(suffix))?.[1] ?? null;
}
