import { describe, expect, it } from 'vitest';
import {
  SETTINGS_TAB_CONFIGS,
  getActiveSettingsTabId,
} from '../src/components/settings/settings-tabs';

describe('designer settings navigation', () => {
  it('lists the everyday tabs first, then Advanced and About', () => {
    const rows = SETTINGS_TAB_CONFIGS.filter((tab) => !tab.parent && !tab.multiMemberOnly);
    expect(rows.map((tab) => [tab.section, tab.id])).toEqual([
      ['main', 'preferences'],
      ['main', 'appearance'],
      ['main', 'agents'],
      ['main', 'browser-accounts'],
      ['main', 'keyboard-shortcuts'],
      ['other', 'advanced'],
      ['other', 'about'],
    ]);
  });

  it('keeps MCP and Projects reachable as Advanced sub-tabs', () => {
    const nested = SETTINGS_TAB_CONFIGS.filter((tab) => tab.parent === 'advanced');
    expect(nested.map((tab) => tab.id)).toEqual(['mcp', 'projects']);
    expect(getActiveSettingsTabId('/local/settings/mcp')).toBe('mcp');
    expect(getActiveSettingsTabId('/local/settings/projects')).toBe('projects');
    expect(getActiveSettingsTabId('/local/settings/advanced')).toBe('advanced');
  });

  it('resolves the retired Image Connection path to AI models', () => {
    expect(SETTINGS_TAB_CONFIGS.map((tab) => tab.id)).not.toContain('image-connection');
    expect(getActiveSettingsTabId('/local/settings/image-connection')).toBe('agents');
  });
});
