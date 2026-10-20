import { describe, expect, it } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { classifyModelError, modelErrorDiagnostic } from '../src/model-error';

describe('static model failure categories', () => {
  it.each([
    ['maximum context length exceeded', 'context_overflow'],
    ['Provider returned error: 400 maximum context length exceeded', 'context_overflow'],
    ['401 invalid api key', 'auth'],
    ['403', 'auth'],
    ['403 unauthorized', 'auth'],
    ['403 authentication failed', 'auth'],
    ['403 invalid api key', 'auth'],
    ['Authentication failed', 'auth'],
    ['400 API_KEY_INVALID: API key not valid. Please pass a valid API key.', 'auth'],
    ['{"type":"authentication_error"}', 'auth'],
    ['Provider returned error: 401 invalid api key', 'auth'],
    ['429 insufficient_quota', 'quota'],
    ['{"code":"quota_exceeded"}', 'quota'],
    ['Provider returned error: billing limit reached', 'quota'],
    ['Monthly usage limit reached', 'quota'],
    ['GoUsageLimitError', 'quota'],
    ['402', 'quota'],
    ['Provider returned error: 402', 'quota'],
    ['402 Payment Required', 'quota'],
    ['Payment required', 'quota'],
    ['Credits exhausted', 'quota'],
    ['Provider returned error: insufficient credits', 'quota'],
    ['Provider returned error: 400 content_filter flagged', 'content_policy'],
    ['Content policy safety moderation', 'content_policy'],
    ['403 Request blocked: prompt injection patterns detected', 'content_policy'],
    ['403 blocked', 'content_policy'],
    ['403 Forbidden: request blocked by guardrail', 'content_policy'],
    ['403 guardrail violation', 'content_policy'],
    ['403 prompt injection detected', 'content_policy'],
    ['403 prompt-injection detected', 'content_policy'],
    ['403 content_policy violation', 'content_policy'],
    ['403 moderation rejected the request', 'content_policy'],
    ['403 safety violation', 'content_policy'],
    ['Provider returned error: 403 unauthorized: blocked by safety guardrail', 'content_policy'],
    ['403 Your request violates the provider policy', 'content_policy'],
    ['403 forbidden', 'auth'],
    ['400 invalid_request', 'invalid_request'],
    ['Provider returned error: 404 model not found', 'not_found'],
    ['422 request rejected', 'invalid_request'],
    ['529 overloaded', 'transient'],
    ['500 internal_server_error', 'transient'],
    ['429 too many requests', 'transient'],
    ['Connection error. ECONNRESET', 'unreachable'],
    ['opaque response failure', 'unknown'],
    ['529', 'unknown'],
    ['ECONNRESET', 'unreachable'],
  ])('classifies %s as %s', (errorMessage, category) => {
    const message = fauxAssistantMessage('', { stopReason: 'error', errorMessage });
    expect(classifyModelError(message, 200000)).toBe(category);
  });

  it('uses unknown when the assistant failure is missing', () => {
    expect(classifyModelError(undefined)).toBe('unknown');
  });

  it('never carries provider text or forbidden copy into diagnostics', () => {
    for (const text of [
      'maximum context length exceeded',
      '401 invalid api key',
      'quota exceeded',
      'content_filter',
      '400 invalid_request',
      '503 unavailable',
      'opaque failure',
    ]) {
      const diagnostic = modelErrorDiagnostic(
        fauxAssistantMessage('', { stopReason: 'error', errorMessage: `${text} SYNTHETIC_SECRET` })
      );
      expect(diagnostic.details).not.toMatch(
        /SYNTHETIC_SECRET|not retried automatically|Failed to create session/
      );
    }
  });
});
