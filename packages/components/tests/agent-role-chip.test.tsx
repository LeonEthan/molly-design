// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_AGENT_ROLE_EMOJI } from '@molly/shared';

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

import { CombinedMentionTextarea } from '../src/components/mentions/combined-mention-textarea';
import { getComposerMentionChip } from '../src/components/mentions/mention-chips';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('retired Role ranges in the composer', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
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

  // The composer no longer offers or hydrates Roles: a saved draft token stays
  // the user's literal text and no Role mark is resolved onto it.
  it('restores a saved Role range as plain text without a Role glyph', async () => {
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
    const view = container as HTMLDivElement;
    expect(view.querySelector('textarea')?.value).toBe('ping @Code-Reviewer now');
    expect(view.textContent).not.toContain(DEFAULT_AGENT_ROLE_EMOJI);
  });
});
