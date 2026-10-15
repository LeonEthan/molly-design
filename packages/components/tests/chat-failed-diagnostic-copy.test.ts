import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ModelRequestFailureCode } from '@molly/shared';
import {
  getChatFailedDiagnosticCopy,
  isModelRequestFailureCode,
} from '../src/components/ai-gui/chat-failed-diagnostic-copy';

const loadLocale = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../locales/${name}`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;

const en = loadLocale('en.json');
const zhCN = loadLocale('zh_CN.json');

const MODEL_CODES: ModelRequestFailureCode[] = [
  'model_temporarily_unavailable',
  'model_auth_rejected',
  'model_quota_exceeded',
  'model_context_overflow',
  'model_content_blocked',
  'model_request_rejected',
  'model_request_failed',
];

describe('getChatFailedDiagnosticCopy', () => {
  it('covers every model request failure code with translated copy', () => {
    for (const code of MODEL_CODES) {
      const copy = getChatFailedDiagnosticCopy(code);
      expect(copy, code).not.toBeNull();
      if (!copy) continue;
      expect(en[copy.titleKey], copy.titleKey).toBe(copy.title);
      expect(zhCN[copy.titleKey], copy.titleKey).toBeTruthy();
      if (copy.actionKey !== undefined) {
        expect(en[copy.actionKey], copy.actionKey).toBe(copy.action);
        expect(zhCN[copy.actionKey], copy.actionKey).toBeTruthy();
      }
    }
  });

  it('gives the transient codes a title only, so the notice stays one line', () => {
    for (const code of ['model_temporarily_unavailable', 'model_request_failed'] as const) {
      const copy = getChatFailedDiagnosticCopy(code);
      expect(copy?.title).toBeTruthy();
      expect(copy?.actionKey).toBeUndefined();
      expect(copy?.action).toBeUndefined();
    }
  });

  it('maps the permanent codes to their action hints', () => {
    expect(getChatFailedDiagnosticCopy('model_auth_rejected')?.action).toBe(
      'Check the connection in Settings.'
    );
    expect(getChatFailedDiagnosticCopy('model_quota_exceeded')?.action).toBe(
      'Check your provider account or choose another model.'
    );
    expect(getChatFailedDiagnosticCopy('model_context_overflow')?.action).toBe(
      'Start a new conversation or choose a model with a larger context.'
    );
    expect(getChatFailedDiagnosticCopy('model_content_blocked')?.action).toBe(
      'Rephrase the request and send it again.'
    );
    expect(getChatFailedDiagnosticCopy('model_request_rejected')?.action).toBe(
      'Check the model and connection settings.'
    );
  });

  it('keeps the git diagnostic copy and rejects unknown codes', () => {
    expect(getChatFailedDiagnosticCopy('git_executable_not_found')?.titleKey).toBe(
      'sessions.systemNotices.chatFailed.gitExecutableNotFound'
    );
    expect(getChatFailedDiagnosticCopy(undefined)).toBeNull();
  });
});

describe('isModelRequestFailureCode', () => {
  it('recognizes exactly the model codes', () => {
    for (const code of MODEL_CODES) {
      expect(isModelRequestFailureCode(code), code).toBe(true);
    }
    expect(isModelRequestFailureCode('git_executable_not_found')).toBe(false);
    expect(isModelRequestFailureCode(undefined)).toBe(false);
  });
});
