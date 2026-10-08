import { describe, it, expect } from 'vitest';
import { applyTextRewrites } from '@molly/shared';
import {
  readDesignElementReferences,
  validateDesignElementReferences,
} from '@molly/shared/design-element-reference';
import {
  appendDesignSelectionMention,
  buildDesignElementMentionRewrites,
} from '../src/components/mentions/design-element-mention';
import {
  sanitizeMentionRanges,
  toPersistedMentionRanges,
} from '../src/components/mentions/mention-persistence';

describe('canonical element mentions', () => {
  it('appends a chip selection after the typed text and expands it at send', () => {
    const reference = {
      artworkId: 'art',
      baselineRevisionId: 'a'.repeat(64),
      elementIds: ['image-1', 'image-2'],
    };
    const appended = appendDesignSelectionMention(
      'Edit each image. Changes: warm colors',
      reference,
      'Selected images'
    );
    expect(appended.text).toBe('Edit each image. Changes: warm colors @Selected images');
    const expanded = applyTextRewrites(
      appended.text,
      buildDesignElementMentionRewrites(appended.text, [appended.mention])
    );
    expect(readDesignElementReferences(expanded.text)).toEqual([reference]);
    expect(expanded.text.startsWith('Edit each image. Changes: warm colors ')).toBe(true);
    expect(expanded.spans?.[0]?.label).toBe('@Selected images');
    expect(appendDesignSelectionMention('', reference, 'Selected').text).toBe('@Selected');
    expect(appendDesignSelectionMention('ends with space ', reference, 'Selected').text).toBe(
      'ends with space @Selected'
    );
  });
  it('restores the original identity and expands only its range alongside other content', () => {
    const reference = {
      artworkId: 'art',
      baselineRevisionId: 'a'.repeat(64),
      elementIds: ['title', 'subtitle'],
    };
    const appended = appendDesignSelectionMention('', reference, 'Selected');
    const text = appended.text + ' brighten, keep my attachment';
    const mentions = sanitizeMentionRanges(text, toPersistedMentionRanges([appended.mention]));
    const expanded = applyTextRewrites(text, buildDesignElementMentionRewrites(text, mentions));
    expect(readDesignElementReferences(expanded.text)).toEqual([reference]);
    expect(expanded.text.endsWith(' brighten, keep my attachment')).toBe(true);
    expect(expanded.spans?.[0]?.kind).toBe('design_element');
    expect(buildDesignElementMentionRewrites(text, [])).toEqual([]);
    const baseline = {
      revisionId: reference.baselineRevisionId,
      doc: { elements: [{ id: 'title' }, { id: 'subtitle' }, { id: 'other' }] },
    };
    expect(() => validateDesignElementReferences([reference], 'art', baseline)).not.toThrow();
    expect(() => validateDesignElementReferences([reference], 'other-art', baseline)).toThrow(
      'another artwork'
    );
    expect(() =>
      validateDesignElementReferences([reference], 'art', {
        ...baseline,
        revisionId: 'b'.repeat(64),
      })
    ).toThrow('stale');
    expect(() =>
      validateDesignElementReferences([reference], 'art', {
        ...baseline,
        doc: { elements: [{ id: 'other' }] },
      })
    ).toThrow('deleted');
  });
});
