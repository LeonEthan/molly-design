import type { AssistantMessage, Context, Model, Api } from '@earendil-works/pi-ai';
import {
  buildProjectedContext,
  buildSystemPrompt,
  parseReviewDecision,
  type ReviewDecision,
  type ReviewSubject,
} from '../vendor/pi-auto-approval/review';

export const AUTO_REVIEW_CLASSIFIER_TIMEOUT_MS = 60_000;

export class AutoReviewFailure extends Error {
  constructor(readonly kind: 'timeout' | 'invalid_response' | 'failed' | 'cancelled') {
    super(`harness_auto_review_${kind}`);
  }
}

export type ClassifierRuntime = {
  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: { signal?: AbortSignal; temperature?: number }
  ): Promise<AssistantMessage>;
};

/**
 * Judge one escalation with the session model through the harness's journaled provider.
 * A failure, timeout or unparseable answer throws; the caller then asks the user.
 */
export async function classifyEscalation(input: {
  runtime: ClassifierRuntime;
  model: Model<Api>;
  entries: readonly unknown[];
  subject: ReviewSubject;
  signal: AbortSignal;
}): Promise<ReviewDecision> {
  const timeout = AbortSignal.timeout(AUTO_REVIEW_CLASSIFIER_TIMEOUT_MS);
  const signal = AbortSignal.any([input.signal, timeout]);
  const message = await input.runtime
    .completeSimple(
      input.model,
      {
        systemPrompt: buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: buildProjectedContext(input.entries, input.subject),
            timestamp: Date.now(),
          },
        ],
      },
      {
        signal,
        temperature: 0,
      }
    )
    .catch(() => {
      throw new AutoReviewFailure(
        input.signal.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'failed'
      );
    });
  if (signal.aborted) throw new AutoReviewFailure(input.signal.aborted ? 'cancelled' : 'timeout');
  if (message.stopReason === 'error' || message.stopReason === 'aborted')
    throw new AutoReviewFailure('failed');
  try {
    return parseReviewDecision(
      message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim() || undefined
    );
  } catch {
    throw new AutoReviewFailure('invalid_response');
  }
}
