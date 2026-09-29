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
  'molly/molly_upload_images',
  'molly/molly_upload_files',
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
    const targets =
      raw === undefined
        ? undefined
        : resolvePlainTargets(raw, boundary.cwd, request.name === 'read');
    const inBoundary =
      targets !== undefined &&
      targets.every((target) =>
        request.name === 'read'
          ? boundary.writableRoots.some((root) => isWithinOrEqual(root, target)) ||
            !boundary.deniedReadRoots.some((root) => isWithinOrEqual(root, target))
          : boundary.writableRoots.some((root) => isWithinOrEqual(root, target))
      );
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

const PI_UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/;
const URL_LIKE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Only plain relative or absolute paths are classified. The pinned SDK's path resolver
 * is not public, so every input its `normalizePath` would rewrite (`file:` URLs, `~`,
 * `@`, Unicode spaces) is reviewed instead of guessed. `read` also probes filename
 * variants (pi-coding-agent 0.85.1 `resolveReadPath`) that may rewrite any path segment,
 * so every variant must stay inside the boundary too.
 */
function resolvePlainTargets(
  path: string,
  cwd: string,
  probesVariants: boolean
): string[] | undefined {
  if (
    !path ||
    path.startsWith('~') ||
    path.startsWith('@') ||
    path.includes('\0') ||
    URL_LIKE_SCHEME.test(path) ||
    PI_UNICODE_SPACES.test(path)
  )
    return undefined;
  const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const candidates = probesVariants ? [resolved, ...readPathVariants(resolved)] : [resolved];
  return candidates.map(resolveThroughExistingAncestor);
}

function readPathVariants(path: string): string[] {
  const screenshot = path.replace(/ (AM|PM)\./gi, '\u202F$1.');
  const decomposed = path.normalize('NFD');
  const curly = (value: string) => value.replace(/'/g, '\u2019');
  return [screenshot, decomposed, curly(path), curly(decomposed)].filter(
    (variant) => variant !== path
  );
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
