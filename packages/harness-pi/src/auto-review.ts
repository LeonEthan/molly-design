import { randomUUID } from 'node:crypto';
import type { MollyPermissionMode } from '@molly/shared/embedded-harness';
import type { ReviewDecision, ReviewSubject } from '../vendor/pi-auto-approval/review';
import type { ToolApproval, ToolApprovalResult } from './approved-tools';
import type { AutoReviewDecision } from './auto-review-policy';
import type { ApprovalRecord } from './run-journal';
import { AutoReviewFailure } from './auto-review-classifier';

export type RecordApproval = (
  request: { toolCallId: string; name: string },
  source: ApprovalRecord['source'],
  decision: ApprovalRecord['decision'],
  reviewOutcome?: ApprovalRecord['reviewOutcome']
) => Promise<boolean>;

type Review = (subject: ReviewSubject, signal?: AbortSignal) => Promise<ReviewDecision>;

export async function reviewApproval(input: {
  request: Parameters<ToolApproval>[0];
  subject: ReviewSubject;
  review: Review;
  record: RecordApproval;
}): Promise<'allow' | 'ask' | 'deny'> {
  let outcome: NonNullable<ApprovalRecord['reviewOutcome']>;
  try {
    outcome = (await input.review(input.subject, input.request.signal)).outcome;
  } catch (error) {
    outcome = error instanceof AutoReviewFailure ? error.kind : 'failed';
  }
  if (input.request.signal?.aborted) outcome = 'cancelled';
  if (
    !(await input.record(
      input.request,
      'classifier',
      outcome === 'allow' ? 'allow' : 'deny',
      outcome
    ))
  )
    return 'deny';
  return outcome === 'cancelled' ? 'deny' : outcome === 'allow' ? 'allow' : 'ask';
}

/**
 * Auto-review wraps the ordinary prompt: in-boundary actions run, escalations go to the
 * classifier, and a classifier deny, failure or timeout falls back to asking the user.
 */
export function createAutoReviewApproval(input: {
  mode: () => MollyPermissionMode | undefined;
  decide: (request: { name: string; arguments: unknown }) => AutoReviewDecision;
  review: Review;
  record: RecordApproval;
  askUser: ToolApproval;
}): ToolApproval {
  return async (request): Promise<ToolApprovalResult> => {
    if (input.mode() === 'auto-review' && !request.signal?.aborted) {
      const decision = input.decide(request);
      if (decision.kind === 'allow') {
        if (!(await input.record(request, decision.source, 'allow'))) return false;
        return decision.source === 'sandbox' ? { kind: 'sandboxed' } : true;
      }
      if (decision.kind === 'review') {
        const verdict = await reviewApproval({
          request,
          subject: decision.subject,
          review: input.review,
          record: input.record,
        });
        if (request.signal?.aborted || verdict === 'deny') return false;
        if (verdict === 'allow') return true;
      }
    }
    return await input.askUser(request);
  };
}

/**
 * Sandbox connections to domains outside the pre-allowed list. Decisions last for one run,
 * so repeated connections of a build do not ask again.
 */
export function createNetworkReview(input: {
  run: () => { runId: string; permissionMode?: MollyPermissionMode } | undefined;
  cwd: string;
  review: Review;
  record: RecordApproval;
  askUser: ToolApproval;
}): (target: { host: string; port: number | undefined }) => Promise<boolean> {
  let decisions: { runId: string; hosts: Map<string, boolean> } | undefined;
  return async ({ host, port }) => {
    const run = input.run();
    if (run?.permissionMode !== 'auto-review') return false;
    if (decisions?.runId !== run.runId) decisions = { runId: run.runId, hosts: new Map() };
    const target = port === undefined ? host : `${host}:${port}`;
    const known = decisions.hosts.get(target);
    if (known !== undefined) return known;
    const request = {
      toolCallId: `network-${randomUUID()}`,
      name: 'network',
      arguments: { host, ...(port === undefined ? {} : { port }) },
    };
    const verdict = await reviewApproval({
      request,
      review: input.review,
      record: input.record,
      subject: {
        toolName: 'network',
        input: request.arguments,
        cwd: input.cwd,
        actionSummary: `Connect to ${target}, which is not pre-approved, from a sandboxed command`,
      },
    });
    if (input.run()?.runId !== run.runId || verdict === 'deny') return false;
    const allowed = verdict === 'allow' ? true : Boolean(await input.askUser(request));
    if (input.run()?.runId !== run.runId) return false;
    decisions.hosts.set(target, allowed);
    return allowed;
  };
}
