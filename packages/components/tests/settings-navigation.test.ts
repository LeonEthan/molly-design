import { describe, expect, it } from 'vitest';
import { resolveSettingsCloseTo } from '../src/lib/settings-navigation';

describe('settings navigation', () => {
  it('accepts only absolute in-app source paths', () => {
    expect(resolveSettingsCloseTo('/acme/chat?context=local')).toBe('/acme/chat?context=local');
    expect(resolveSettingsCloseTo('https://example.com')).toBeNull();
    expect(resolveSettingsCloseTo('//example.com')).toBeNull();
  });
});
