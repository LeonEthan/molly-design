// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useMentionCategories } from '../src/components/mentions/mention-registry';
import { useMentionPromptExpansion } from '../src/components/mentions/mention-expansion';
import {
  SETTINGS_TAB_CONFIGS,
  getActiveSettingsTabId,
} from '../src/components/settings/settings-tabs';
import { initI18n } from '../src/i18n';

vi.mock('../src/components/mentions/mention-skill-source', async (original) => ({
  ...(await original<object>()),
  useSkillMentionRewrites: () => () => [],
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Role retirement', () => {
  it('removes the settings tab and resolves a saved Role settings path to Preferences', () => {
    expect(SETTINGS_TAB_CONFIGS.map((tab) => tab.id)).not.toContain('agent-roles');
    expect(getActiveSettingsTabId('/local/settings/agent-roles')).toBe('preferences');
  });

  it('ignores the retired mention source and sends restored Role ranges as plain text', async () => {
    await initI18n('en');
    const text = 'Review with @Reviewer';
    let observed: unknown;
    function Probe() {
      const categories = useMentionCategories({
        agentRole: { enabled: true, items: [] },
        file: { enabled: true, index: null },
      });
      const expand = useMentionPromptExpansion({
        source: undefined,
        skillAgent: undefined,
        promptValue: text,
      });
      observed = {
        categories: categories.map((category) => category.id),
        expanded: expand({
          text,
          mentions: [{ kind: 'agent_role', value: 'historical-role', start: 12, end: text.length }],
        }),
      };
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Probe)));
      expect(observed).toEqual({
        categories: ['file'],
        expanded: { text, spans: undefined },
      });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
