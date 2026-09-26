import type { AssistantMessage, Context, Model, Api } from '@earendil-works/pi-ai';
import {
  buildProjectedContext,
  buildSystemPrompt,
  parseReviewDecision,
  type ReviewDecision,
  type ReviewSubject,
} from '../vendor/pi-auto-approval/review';

export const AUTO_REVIEW_CLASSIFIER_TIMEOUT_MS = 60_000;

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
  const message = await input.runtime.completeSimple(
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
      signal: AbortSignal.any([
        input.signal,
        AbortSignal.timeout(AUTO_REVIEW_CLASSIFIER_TIMEOUT_MS),
      ]),
      temperature: 0,
    }
  );
  if (message.stopReason === 'error' || message.stopReason === 'aborted')
    throw new Error('harness_auto_review_classifier_failed');
  return parseReviewDecision(
    message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim() || undefined
  );
}
