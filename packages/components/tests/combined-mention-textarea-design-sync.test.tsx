// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignElementReference } from '@molly/shared/design-element-reference';

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
    skillState: { status: 'idle' as const },
    skillItems: [],
    knownSkillTokens: new Set<string>(),
  }),
}));

vi.mock('../src/components/mentions/mention-session-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionMentionItems: () => [],
}));

vi.mock('../src/components/mentions/mention-agent-role-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgentRoleMentionItems: () => [],
}));

import {
  CombinedMentionTextarea,
  type CombinedMentionTextareaHandle,
} from '../src/components/mentions/combined-mention-textarea';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const REVISION = 'a'.repeat(64);
const badge: DesignElementReference = {
  artworkId: 'art-1',
  baselineRevisionId: REVISION,
  elementIds: ['badge'],
};
const headline: DesignElementReference = {
  artworkId: 'art-1',
  baselineRevisionId: REVISION,
  elementIds: ['headline'],
};

describe('CombinedMentionTextarea design-element mirror sync', () => {
  let root: Root;
  let container: HTMLDivElement;
  let handle: React.MutableRefObject<CombinedMentionTextareaHandle | null>;

  beforeEach(async () => {
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    handle = { current: null };
    function ControlledComposer() {
      const [value, setValue] = React.useState('');
      return (
        <CombinedMentionTextarea
          value={value}
          onValueChange={setValue}
          mentionActionsRef={handle}
          resetOnEmpty={false}
        />
      );
    }
    await act(async () => {
      root.render(<ControlledComposer />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function text() {
    const input = container.querySelector('textarea');
    if (!input) throw new Error('composer textarea missing');
    return input.value;
  }

  function occurrences(label: string) {
    return text().split(label).length - 1;
  }

  async function sync(reference: DesignElementReference | null, label: string) {
    let result = false;
    await act(async () => {
      result = handle.current?.syncDesignElementMention(reference, label) ?? false;
    });
    return result;
  }

  async function insert(reference: DesignElementReference, label: string) {
    let result = false;
    await act(async () => {
      result = handle.current?.insertDesignElementMention(reference, label) ?? false;
    });
    return result;
  }

  /** Replaces the composer text the way the mention primitive observes it. */
  async function replaceText(value: string) {
    const input = container.querySelector('textarea');
    if (!input) throw new Error('composer textarea missing');
    await act(async () => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(input, value);
      input.selectionStart = value.length;
      input.selectionEnd = value.length;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('mirrors a live selection and retires the chip on an empty selection', async () => {
    expect(await sync(badge, 'Chip A')).toBe(true);
    expect(text()).toContain('@Chip A');
    expect(await sync(null, '')).toBe(true);
    expect(text()).not.toContain('@Chip A');
  });

  it('replaces the mirrored chip when the selection identity changes at the same count', async () => {
    await sync(badge, 'Chip X');
    await sync(headline, 'Chip Y');
    expect(text()).toContain('@Chip Y');
    expect(text()).not.toContain('@Chip X');
    expect(occurrences('@Chip Y')).toBe(1);
  });

  it('keeps an explicitly inserted chip when the mirror retires', async () => {
    expect(await insert(badge, 'Chip E')).toBe(true);
    expect(text()).toContain('@Chip E');
    expect(await sync(null, '')).toBe(true);
    expect(text()).toContain('@Chip E');
  });

  it('never adopts a payload-equal explicit chip, so a later passive sync cannot retire it', async () => {
    await insert(badge, 'Chip E');
    expect(await sync(badge, 'Chip E')).toBe(true);
    expect(occurrences('@Chip E')).toBe(1);
    expect(await sync(null, '')).toBe(true);
    expect(text()).toContain('@Chip E');
  });

  it('treats a payload-equal re-sync of its own mirrored chip as a no-op and still retires it', async () => {
    await sync(badge, 'Chip M');
    await sync(badge, 'Chip M');
    expect(occurrences('@Chip M')).toBe(1);
    await sync(null, '');
    expect(text()).not.toContain('@Chip M');
  });

  it('recovers cleanly when the user deleted the mirrored chip by hand before the next sync', async () => {
    await sync(badge, 'Chip S');
    expect(text()).toContain('@Chip S');
    await replaceText('');
    await sync(headline, 'Chip T');
    expect(text()).toContain('@Chip T');
    expect(text()).not.toContain('@Chip S');
    expect(occurrences('@Chip T')).toBe(1);
    await sync(null, '');
    expect(text()).not.toContain('@Chip T');
  });
});
