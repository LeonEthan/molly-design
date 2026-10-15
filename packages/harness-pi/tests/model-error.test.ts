import { describe, expect, it } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { classifyModelError, modelErrorDiagnostic } from '../src/model-error';

describe('static model failure categories', () => {
  it.each([
    ['maximum context length exceeded', 'context_overflow'],
    ['Provider returned error: 400 maximum context length exceeded', 'context_overflow'],
    ['401 invalid api key', 'auth'],
    ['403 unauthorized', 'auth'],
    ['Authentication failed', 'auth'],
    ['{"type":"authentication_error"}', 'auth'],
    ['Provider returned error: 401 invalid api key', 'auth'],
    ['429 insufficient_quota', 'quota'],
    ['{"code":"quota_exceeded"}', 'quota'],
    ['Provider returned error: billing limit reached', 'quota'],
    ['Monthly usage limit reached', 'quota'],
    ['GoUsageLimitError', 'quota'],
    ['Provider returned error: 400 content_filter flagged', 'content_policy'],
    ['Content policy safety moderation', 'content_policy'],
    ['400 invalid_request', 'invalid_request'],
    ['Provider returned error: 404 model not found', 'invalid_request'],
    ['422 request rejected', 'invalid_request'],
    ['529 overloaded', 'transient'],
    ['500 internal_server_error', 'transient'],
    ['429 too many requests', 'transient'],
    ['Connection error. ECONNRESET', 'transient'],
    ['opaque response failure', 'unknown'],
    ['529', 'unknown'],
    ['ECONNRESET', 'unknown'],
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
