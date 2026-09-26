import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import type { ReviewSubject } from '../vendor/pi-auto-approval/review';
import type { ApprovalRecord } from './run-journal';

/** Molly-owned design tools that auto-review approves without a prompt. */
export const AUTO_REVIEW_DESIGN_TOOLS: ReadonlySet<string> = new Set([
  'molly/molly_generate_image',
  'molly/molly_edit_image',
  'molly/molly_render_preview',
  'molly/molly_resubmit_draft',
  'molly/resources/read',
]);

/** The optional bash argument an Agent sets to ask for execution outside the OS sandbox. */
export const OUTSIDE_SANDBOX_ARGUMENT = 'outside_sandbox';

export type AutoReviewBoundary = {
  cwd: string;
  /** Roots native file writes may reach without review: workspace and sandbox temp. */
  writableRoots: readonly string[];
  /** Credentials and Molly private data; reads there need review unless writable. */
  deniedReadRoots: readonly string[];
  /** False when the OS sandbox cannot run here; shell then keeps its ordinary prompt. */
  sandboxAvailable: boolean;
};

export type AutoReviewDecision =
  | { kind: 'allow'; source: ApprovalRecord['source'] }
  | { kind: 'review'; subject: ReviewSubject }
  | { kind: 'ask' };

/**
 * Judge risk by effect, not command form
 * ([Spec](../../../specs/generative-layered-design-workflow.md)): sandboxed shell and
 * in-boundary file access run; leaving the boundary is reviewed; everything else asks.
 */
export function decideAutoReview(
  request: { name: string; arguments: unknown },
  boundary: AutoReviewBoundary
): AutoReviewDecision {
  const args =
    request.arguments && typeof request.arguments === 'object' && !Array.isArray(request.arguments)
      ? (request.arguments as Record<string, unknown>)
      : {};
  if (AUTO_REVIEW_DESIGN_TOOLS.has(request.name)) return { kind: 'allow', source: 'design_tool' };
  if (request.name === 'bash') {
    const command = typeof args.command === 'string' ? args.command : '';
    if (args[OUTSIDE_SANDBOX_ARGUMENT] === true)
      return {
        kind: 'review',
        subject: {
          toolName: 'bash',
          input: { command },
          cwd: boundary.cwd,
          actionSummary: `Run this command outside the OS sandbox: ${command}`,
        },
      };
    return boundary.sandboxAvailable ? { kind: 'allow', source: 'sandbox' } : { kind: 'ask' };
  }
  if (['read', 'write', 'edit'].includes(request.name)) {
    const raw = typeof args.path === 'string' ? args.path : undefined;
    const target = raw === undefined ? undefined : resolvePlainPath(raw, boundary.cwd);
    const inBoundary =
      target !== undefined &&
      (request.name === 'read'
        ? boundary.writableRoots.some((root) => isWithinOrEqual(root, target)) ||
          !boundary.deniedReadRoots.some((root) => isWithinOrEqual(root, target))
        : boundary.writableRoots.some((root) => isWithinOrEqual(root, target)));
    if (inBoundary) return { kind: 'allow', source: 'workspace' };
    return {
      kind: 'review',
      subject: {
        toolName: request.name,
        input: { path: raw },
        cwd: boundary.cwd,
        actionSummary:
          request.name === 'read'
            ? `Read a protected path: ${raw ?? '<missing path>'}`
            : `Write outside the workspace: ${raw ?? '<missing path>'}`,
      },
    };
  }
  return { kind: 'ask' };
}

/**
 * Only plain relative or absolute paths are classified. Pi expands `~` and `@` itself;
 * those forms are reviewed rather than guessed.
 */
function resolvePlainPath(path: string, cwd: string): string | undefined {
  if (!path || path.startsWith('~') || path.startsWith('@') || path.includes('\0'))
    return undefined;
  return resolveThroughExistingAncestor(isAbsolute(path) ? path : resolve(cwd, path));
}

function resolveThroughExistingAncestor(path: string): string {
  const tail: string[] = [];
  let current = normalize(path);
  for (;;) {
    if (existsSync(current)) return join(realpathSync(current), ...tail.reverse());
    const parent = dirname(current);
    if (parent === current) return normalize(path);
    tail.push(current.slice(parent.length).replace(/^[/\\]/, ''));
    current = parent;
  }
}

function isWithinOrEqual(root: string, candidate: string): boolean {
  const resolvedRoot = resolveThroughExistingAncestor(root);
  const rel = relative(resolvedRoot, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
