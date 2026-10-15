import {
  isContextOverflow,
  isRetryableAssistantError,
  type AssistantMessage,
} from '@earendil-works/pi-ai';

export type ModelErrorCategory =
  | 'context_overflow'
  | 'auth'
  | 'quota'
  | 'content_policy'
  | 'invalid_request'
  | 'transient'
  | 'unknown';

const MODEL_ERROR_DETAILS: Record<ModelErrorCategory, string> = {
  context_overflow:
    'The conversation exceeds the model context limit. Your draft files are preserved.',
  auth: 'The model service rejected the credentials. Your conversation and draft files are preserved.',
  quota:
    'The model service usage or billing limit was reached. Your conversation and draft files are preserved.',
  content_policy:
    'The model service blocked the response for safety. Your conversation and draft files are preserved.',
  invalid_request:
    'The model service rejected the request. Your conversation and draft files are preserved.',
  transient:
    'The model service stayed unavailable after automatic retries. Your conversation and draft files are preserved.',
  unknown:
    'The model service could not complete the response. Your conversation and draft files are preserved.',
};

export function classifyModelError(
  message: AssistantMessage | undefined,
  contextWindow?: number
): ModelErrorCategory {
  if (!message) return 'unknown';
  if (isContextOverflow(message, contextWindow)) return 'context_overflow';
  const text = message.errorMessage ?? '';
  if (
    /\b(?:402|quota(?:_exceeded)?|credits?)\b|payment[ _-]required|insufficient[ _-]quota|billing|usage[ _-]?limit|out of budget|available balance/i.test(
      text
    )
  )
    return 'quota';
  if (
    /content[ _-]?(?:policy|filter)|\b(?:safety|moderation|flagged|guardrails?|polic(?:y|ies)|blocked by)\b|prompt[ _-]injection|\b(?:request|prompt|content|input|output|response) (?:was |has been )?blocked\b/i.test(
      text
    )
  )
    return 'content_policy';
  if (
    /\b(?:401|403|unauthori[sz]ed|authentication(?:_error)?)\b|invalid[ _-]api[ _-]key/i.test(text)
  )
    return 'auth';
  if (/\b(?:400|404|405|410|413|415|422)\b|invalid[ _-]request|\bbad request\b/i.test(text))
    return 'invalid_request';
  if (isRetryableAssistantError(message)) return 'transient';
  return 'unknown';
}

export function modelErrorDiagnostic(
  message: AssistantMessage | undefined,
  contextWindow?: number
) {
  const category = classifyModelError(message, contextWindow);
  return { category, details: MODEL_ERROR_DETAILS[category] };
}
