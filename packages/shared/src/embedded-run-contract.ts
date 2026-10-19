export const MODEL_ERROR_CATEGORIES = [
  'context_overflow',
  'auth',
  'quota',
  'content_policy',
  'invalid_request',
  'transient',
  'unknown',
] as const;
export type ModelErrorCategory = (typeof MODEL_ERROR_CATEGORIES)[number];

const FAILURE_CODE_BY_CATEGORY = {
  context_overflow: 'model_context_overflow',
  auth: 'model_auth_rejected',
  quota: 'model_quota_exceeded',
  content_policy: 'model_content_blocked',
  invalid_request: 'model_request_rejected',
  transient: 'model_temporarily_unavailable',
  unknown: 'model_request_failed',
} as const satisfies Record<ModelErrorCategory, import('./ai').ModelRequestFailureCode>;

export function failureCodeForCategory(category: unknown): import('./ai').ModelRequestFailureCode {
  return typeof category === 'string' && Object.hasOwn(FAILURE_CODE_BY_CATEGORY, category)
    ? FAILURE_CODE_BY_CATEGORY[category as ModelErrorCategory]
    : 'model_request_failed';
}
