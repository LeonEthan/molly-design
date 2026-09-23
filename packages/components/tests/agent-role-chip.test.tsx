// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import {
  AGENT_ROLE_VERSION,
  DEFAULT_AGENT_ROLE_EMOJI,
  type AgentConfigId,
  type AgentRole,
  type AgentRoleId,
  type MachineId,
} from '@molly/shared';

let agentRoleItems: Array<{ slug: string; role: AgentRole }> = [];

vi.mock('../src/components/mentions/mention-project-file-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMentionProjectFiles: () => ({
    fileData: { entry: null, status: 'ready' as const },
    initializeLazyDirectory: async () => undefined,
    getKnownFileTokens: () => new Set<string>(),
  }),
}));

vi.mock('../src/components/mentions/mention-skill-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMentionProjectSkills: () => ({
    skillState: { status: 'ready' as const },
    skillItems: [],
    knownSkillTokens: new Set<string>(),
  }),
}));

vi.mock('../src/components/mentions/mention-session-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionMentionItems: () => [],
}));

// A stale catalog can still contain Roles, but the retired composer source must
// not use it to decorate or reactivate a saved draft token.
vi.mock('../src/components/mentions/mention-agent-role-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgentRoleMentionItems: () => agentRoleItems,
}));

import { CombinedMentionTextarea } from '../src/components/mentions/combined-mention-textarea';
import { getComposerMentionChip } from '../src/components/mentions/mention-chips';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const role = (emoji?: string): AgentRole => ({
  v: AGENT_ROLE_VERSION,
  id: 'role-1' as AgentRoleId,
  ownerUserId: 'user-1',
  visibility: 'private',
  name: 'Code Reviewer',
  ...(emoji ? { emoji } : {}),
  machineId: 'machine-1' as MachineId,
  agentConfigId: 'config-1' as AgentConfigId,
  runConfig: {},
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
});

describe('retired Role ranges in the composer', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    agentRoleItems = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = undefined;
    }
    container?.remove();
    container = undefined;
  });

  const renderComposer = async (): Promise<HTMLDivElement> => {
    await act(async () => {
      root?.render(
        createElement(CombinedMentionTextarea, {
          value: 'ping @Code-Reviewer now',
          onValueChange: () => undefined,
          getMentionChip: getComposerMentionChip,
          persistedMentions: [{ start: 5, end: 19, value: 'role-1', kind: 'agent_role' as const }],
        })
      );
    });
    return container as HTMLDivElement;
  };

  it('preserves the saved token without resolving the catalog emoji', async () => {
    agentRoleItems = [{ slug: 'Code-Reviewer', role: role('🔍') }];
    const view = await renderComposer();
    expect(view.querySelector('textarea')?.value).toBe('ping @Code-Reviewer now');
    expect(view.textContent).not.toContain('🔍');
  });

  it('does not restore the default Role glyph from a stale catalog row', async () => {
    agentRoleItems = [{ slug: 'Code-Reviewer', role: role() }];
    const view = await renderComposer();
    expect(view.querySelector('textarea')?.value).toBe('ping @Code-Reviewer now');
    expect(view.textContent).not.toContain(DEFAULT_AGENT_ROLE_EMOJI);
  });

  it('paints nothing role-specific for a role the composer no longer offers', async () => {
    const view = await renderComposer();
    expect(view.querySelector('textarea')?.value).toBe('ping @Code-Reviewer now');
    expect(view.textContent).not.toContain(DEFAULT_AGENT_ROLE_EMOJI);
  });
});
