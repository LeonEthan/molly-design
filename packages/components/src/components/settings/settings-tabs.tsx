import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  FolderOpen,
  ImageIcon,
  Info,
  Keyboard,
  Monitor,
  Palette,
  Plug,
  SlidersHorizontal,
  UserRoundCog,
} from 'lucide-react';

export type SettingsSectionId = 'account' | 'personal' | 'workspace' | 'other';

export type SettingsTabId =
  | 'account'
  | 'preferences'
  | 'appearance'
  | 'keyboard-shortcuts'
  | 'workspace'
  | 'people'
  | 'machines'
  | 'agents'
  | 'agent-roles'
  | 'image-connection'
  | 'mcp'
  | 'projects'
  | 'ai-usage'
  | 'billing'
  | 'about';

export type SettingsPath =
  | '/$workspaceName/settings/account'
  | '/$workspaceName/settings/preferences'
  | '/$workspaceName/settings/appearance'
  | '/$workspaceName/settings/keyboard-shortcuts'
  | '/$workspaceName/settings/workspace'
  | '/$workspaceName/settings/people'
  | '/$workspaceName/settings/machines'
  | '/$workspaceName/settings/agents'
  | '/$workspaceName/settings/agent-roles'
  | '/$workspaceName/settings/image-connection'
  | '/$workspaceName/settings/mcp'
  | '/$workspaceName/settings/projects'
  | '/$workspaceName/settings/ai-usage'
  | '/$workspaceName/settings/billing'
  | '/$workspaceName/settings/about';

export type SettingsTabConfig = {
  id: SettingsTabId;
  section: SettingsSectionId;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  /** The workspace machine inventory has no useful distinction in a solo workspace. */
  multiMemberOnly?: boolean;
  path: SettingsPath;
};

export const SETTINGS_DEFAULT_TAB: SettingsTabId = 'preferences';

export const SETTINGS_TAB_CONFIGS: SettingsTabConfig[] = [
  {
    id: 'preferences',
    section: 'personal',
    labelKey: 'settings.tabs.preferences',
    descriptionKey: 'settings.categories.preferences.description',
    icon: SlidersHorizontal,
    path: '/$workspaceName/settings/preferences',
  },
  {
    id: 'appearance',
    section: 'personal',
    labelKey: 'settings.tabs.appearance',
    descriptionKey: 'settings.categories.appearance.description',
    icon: Palette,
    path: '/$workspaceName/settings/appearance',
  },
  {
    id: 'keyboard-shortcuts',
    section: 'personal',
    labelKey: 'settings.tabs.keyboardShortcuts',
    descriptionKey: 'settings.categories.keyboardShortcuts.description',
    icon: Keyboard,
    path: '/$workspaceName/settings/keyboard-shortcuts',
  },
  {
    id: 'machines',
    section: 'workspace',
    labelKey: 'settings.tabs.machines',
    descriptionKey: 'settings.categories.machines.description',
    icon: Monitor,
    multiMemberOnly: true,
    path: '/$workspaceName/settings/machines',
  },
  {
    id: 'agents',
    section: 'workspace',
    labelKey: 'settings.tabs.agents',
    descriptionKey: 'settings.categories.agents.description',
    icon: Bot,
    path: '/$workspaceName/settings/agents',
  },
  {
    // Beside Agents on purpose: a provider says how an agent starts, a Role
    // says how one is used, and the two must not read as one editor.
    id: 'agent-roles',
    section: 'workspace',
    labelKey: 'settings.tabs.agentRoles',
    descriptionKey: 'settings.categories.agentRoles.description',
    icon: UserRoundCog,
    path: '/$workspaceName/settings/agent-roles',
  },
  {
    // Beside the agent catalog on purpose: the image connection is the other
    // per-machine, user-typed credential the design surfaces read, and it shares
    // that boundary (this machine's Flock doc) rather than the workspace catalog.
    id: 'image-connection',
    section: 'workspace',
    labelKey: 'settings.tabs.imageConnection',
    descriptionKey: 'settings.categories.imageConnection.description',
    icon: ImageIcon,
    path: '/$workspaceName/settings/image-connection',
  },
  {
    id: 'mcp',
    section: 'workspace',
    labelKey: 'settings.tabs.mcp',
    descriptionKey: 'settings.categories.mcp.description',
    icon: Plug,
    path: '/$workspaceName/settings/mcp',
  },
  {
    id: 'projects',
    section: 'workspace',
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
  return SETTINGS_TAB_CONFIGS.filter((tab) => !tab.multiMemberOnly || includeMultiMemberOnly);
}

export function getActiveSettingsTabId(pathname: string): SettingsTabId | null {
  const suffixes: Array<[string, SettingsTabId]> = [
    ['/settings/account', 'preferences'],
    ['/settings/preferences', 'preferences'],
    ['/settings/general', 'preferences'],
    ['/settings/appearance', 'appearance'],
    ['/settings/keyboard-shortcuts', 'keyboard-shortcuts'],
    ['/settings/my-machines', 'machines'],
    ['/settings/workspace', 'preferences'],
    ['/settings/people', 'preferences'],
    ['/settings/machines', 'machines'],
    ['/settings/devices', 'machines'],
    ['/settings/agents', 'agents'],
    ['/settings/agent-config', 'agents'],
    ['/settings/agent-roles', 'agent-roles'],
    ['/settings/image-connection', 'image-connection'],
    ['/settings/mcp', 'mcp'],
    ['/settings/projects', 'projects'],
    ['/settings/ai-usage', 'preferences'],
    ['/settings/stats', 'preferences'],
    ['/settings/billing', 'preferences'],
    ['/settings/about', 'about'],
  ];
  return suffixes.find(([suffix]) => pathname.endsWith(suffix))?.[1] ?? null;
}
