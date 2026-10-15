import type { ChatFailedCode, ModelRequestFailureCode } from '@molly/shared';

export type ChatFailedDiagnosticCopy = {
  titleKey: string;
  title: string;
  actionKey?: string;
  action?: string;
};

const MODEL_REQUEST_FAILURE_COPY = {
  model_temporarily_unavailable: {
    titleKey: 'sessions.systemNotices.chatFailed.modelTemporarilyUnavailable',
    title: 'Model temporarily unavailable',
  },
  model_auth_rejected: {
    titleKey: 'sessions.systemNotices.chatFailed.modelAuthRejected',
    title: "The model connection's key was rejected",
    actionKey: 'sessions.systemNotices.chatFailed.modelAuthRejectedAction',
    action: 'Check the connection in Settings.',
  },
  model_quota_exceeded: {
    titleKey: 'sessions.systemNotices.chatFailed.modelQuotaExceeded',
    title: 'Model quota or billing limit reached',
    actionKey: 'sessions.systemNotices.chatFailed.modelQuotaExceededAction',
    action: 'Check your provider account or choose another model.',
  },
  model_context_overflow: {
    titleKey: 'sessions.systemNotices.chatFailed.modelContextOverflow',
    title: 'This conversation is too long for the selected model',
    actionKey: 'sessions.systemNotices.chatFailed.modelContextOverflowAction',
    action: 'Start a new conversation or choose a model with a larger context.',
  },
  model_content_blocked: {
    titleKey: 'sessions.systemNotices.chatFailed.modelContentBlocked',
    title: 'The model declined this request',
    actionKey: 'sessions.systemNotices.chatFailed.modelContentBlockedAction',
    action: 'Rephrase the request and send it again.',
  },
  model_request_rejected: {
    titleKey: 'sessions.systemNotices.chatFailed.modelRequestRejected',
    title: 'The model rejected the request',
    actionKey: 'sessions.systemNotices.chatFailed.modelRequestRejectedAction',
    action: 'Check the model and connection settings.',
  },
  model_request_failed: {
    titleKey: 'sessions.systemNotices.chatFailed.modelRequestFailed',
    title: 'Model request failed',
  },
} satisfies Record<ModelRequestFailureCode, ChatFailedDiagnosticCopy>;

export const isModelRequestFailureCode = (
  code: ChatFailedCode | undefined
): code is ModelRequestFailureCode => code !== undefined && code in MODEL_REQUEST_FAILURE_COPY;

export function getChatFailedDiagnosticCopy(
  code: ChatFailedCode | undefined
): ChatFailedDiagnosticCopy | null {
  if (isModelRequestFailureCode(code)) {
    return MODEL_REQUEST_FAILURE_COPY[code];
  }

  if (code !== 'git_executable_not_found') {
    return null;
  }

  return {
    titleKey: 'sessions.systemNotices.chatFailed.gitExecutableNotFound',
    title: 'Git executable was not found on the target machine',
    actionKey: 'sessions.systemNotices.chatFailed.gitExecutableNotFoundAction',
    action:
      'Install Git for Windows or add git.exe to PATH, fully restart Molly/runtime, verify “git --version” in a new terminal, then try again.',
  };
}
