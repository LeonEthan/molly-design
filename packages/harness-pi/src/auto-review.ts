import { randomUUID } from 'node:crypto';
import type { MollyPermissionMode } from '@molly/shared/embedded-harness';
import type { ReviewDecision, ReviewSubject } from '../vendor/pi-auto-approval/review';
import type { ToolApproval, ToolApprovalResult } from './approved-tools';
import type { AutoReviewDecision } from './auto-review-policy';
import type { ApprovalRecord } from './run-journal';

export type RecordApproval = (
  request: { toolCallId: string; name: string },
  source: ApprovalRecord['source'],
  decision: ApprovalRecord['decision']
) => Promise<boolean>;

type Review = (subject: ReviewSubject, signal?: AbortSignal) => Promise<ReviewDecision>;

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
        const verdict = await input.review(decision.subject, request.signal).catch(() => undefined);
        if (verdict?.outcome === 'allow' && !request.signal?.aborted)
          return await input.record(request, 'classifier', 'allow');
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
    const verdict = await input
      .review({
        toolName: 'network',
        input: request.arguments,
        cwd: input.cwd,
        actionSummary: `Connect to ${target}, which is not pre-approved, from a sandboxed command`,
      })
      .catch(() => undefined);
    const allowed =
      verdict?.outcome === 'allow'
        ? await input.record(request, 'classifier', 'allow')
        : Boolean(await input.askUser(request));
    decisions.hosts.set(target, allowed);
    return allowed;
  };
}
