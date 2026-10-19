import { describe, expect, it } from 'vitest';
import {
  MODEL_ERROR_CATEGORIES,
  failureCodeForCategory,
  type ModelErrorCategory,
} from '../src/embedded-run-contract';
import { ChatFailedCodeSchema } from '../src/message-schemas';
import type { ModelRequestFailureCode } from '../src/ai';

const cases = {
  context_overflow: 'model_context_overflow',
  auth: 'model_auth_rejected',
  quota: 'model_quota_exceeded',
  content_policy: 'model_content_blocked',
  invalid_request: 'model_request_rejected',
  transient: 'model_temporarily_unavailable',
  unknown: 'model_request_failed',
} satisfies Record<ModelErrorCategory, ModelRequestFailureCode>;

describe('embedded model failure categories', () => {
  it.each(MODEL_ERROR_CATEGORIES)('maps category %s to its static failure code', (category) => {
    expect(failureCodeForCategory(category)).toBe(cases[category]);
  });
  it('covers the entire failure code vocabulary', () => {
    expect(Object.keys(cases)).toEqual([...MODEL_ERROR_CATEGORIES]);
    expect(new Set(MODEL_ERROR_CATEGORIES.map(failureCodeForCategory))).toEqual(
      new Set(ChatFailedCodeSchema.options.filter((code) => code !== 'git_executable_not_found'))
    );
  });
  it.each([undefined, null, '', 'future', '__proto__', 'constructor', {}, 1])(
    'uses the unknown fallback for %j',
    (category) => {
      expect(failureCodeForCategory(category)).toBe('model_request_failed');
    }
  );
});
