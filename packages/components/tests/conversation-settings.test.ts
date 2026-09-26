import { describe, expect, it } from 'vitest';

import {
  CONVERSATION_FONT_SIZE_MAX,
  CONVERSATION_FONT_SIZE_MIN,
  DEFAULT_CONVERSATION_FONT_SIZE,
  normalizeConversationFontSize,
} from '../src/atoms/settings';
import {
  conversationMonoFontSizeStyle,
  conversationTextFontSizeStyle,
  terminalTextFontSizeStyle,
  userTextCollapsedHeight,
} from '../src/components/ai-gui/conversation-font-size-classes';

describe('conversation appearance settings', () => {
  it('accepts custom sizes, bounds invalid values, and migrates legacy presets', () => {
    expect(normalizeConversationFontSize(24)).toBe(24);
    expect(normalizeConversationFontSize(14.7)).toBe(15);
    expect(normalizeConversationFontSize(CONVERSATION_FONT_SIZE_MIN - 1)).toBe(
      CONVERSATION_FONT_SIZE_MIN
    );
    expect(normalizeConversationFontSize(CONVERSATION_FONT_SIZE_MAX + 1)).toBe(
      CONVERSATION_FONT_SIZE_MAX
    );
    expect(normalizeConversationFontSize('small')).toBe(12);
    expect(normalizeConversationFontSize('default')).toBe(DEFAULT_CONVERSATION_FONT_SIZE);
    expect(normalizeConversationFontSize('large')).toBe(16);
    expect(normalizeConversationFontSize(undefined)).toBe(DEFAULT_CONVERSATION_FONT_SIZE);
  });

  it('scales every conversation text variant from a custom size', () => {
    expect(conversationTextFontSizeStyle(24)).toEqual({ fontSize: '24px' });
    expect(conversationMonoFontSizeStyle(24)).toEqual({ fontSize: '16px' });
    expect(terminalTextFontSizeStyle(24)).toEqual({ fontSize: '20px' });
    expect(userTextCollapsedHeight(24)).toBe(274);
  });
});
