import {
  DesignElementReferenceSchema,
  formatDesignElementReference,
  type DesignElementReference,
} from '@molly/shared/design-element-reference';
import type { TextRewrite } from '@molly/shared';
import type { Mention } from '@/ui/mention/index';

export function appendDesignSelectionMention(
  text: string,
  reference: DesignElementReference,
  label: string
): { text: string; mention: Mention } {
  const separator = text.length === 0 || /\s$/.test(text) ? '' : ' ';
  const mentionText = '@' + label;
  const start = text.length + separator.length;
  return {
    text: text + separator + mentionText,
    mention: {
      start,
      end: start + mentionText.length,
      value: JSON.stringify(DesignElementReferenceSchema.parse(reference)),
      kind: 'design_element',
    },
  };
}

export function buildDesignElementMentionRewrites(
  text: string,
  mentions: readonly { start: number; end: number; value: string; kind?: string }[]
): TextRewrite[] {
  return mentions
    .filter((mention) => mention.kind === 'design_element')
    .map((mention) => ({
      start: mention.start,
      end: mention.end,
      replacement: formatDesignElementReference(
        DesignElementReferenceSchema.parse(JSON.parse(mention.value))
      ),
      span: {
        kind: 'design_element',
        label: text.slice(mention.start, mention.end),
        target: mention.value,
      },
    }));
}
