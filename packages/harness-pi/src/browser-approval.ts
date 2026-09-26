import { AgentBrowserCommandSchema } from '@molly/shared/browser-agent-rpc';
import { classifyBrowserHostname } from '@molly/shared/browser-url';
import type { MollyPermissionMode } from '@molly/shared/embedded-harness';
import type { ToolApproval } from './approved-tools';
import { reviewApproval, type RecordApproval } from './auto-review';
import type { ReviewDecision, ReviewSubject } from '../vendor/pi-auto-approval/review';

type BrowserRun = { runId: string; runtimeEpoch: string; permissionMode?: MollyPermissionMode };
type BrowserChoice = 'allow-once' | 'allow-browse-task' | 'deny' | undefined;

export function createBrowserTaskApproval(input: {
  cwd: string;
  permissionProfileId: string;
  run: () => BrowserRun | undefined;
  review: (subject: ReviewSubject, signal?: AbortSignal) => Promise<ReviewDecision>;
  record: RecordApproval;
  ask: (request: Parameters<ToolApproval>[0], grantSite?: string) => Promise<BrowserChoice>;
}): ToolApproval {
  let scope: BrowserRun | undefined;
  let sites = new Set<string>();
  let activeSite: string | undefined;
  return async (request) => {
    const run = input.run();
    const isCurrent = () => {
      const current = input.run();
      return (
        !request.signal?.aborted &&
        current?.runId === run?.runId &&
        current?.runtimeEpoch === run?.runtimeEpoch
      );
    };
    if (scope?.runId !== run?.runId || scope?.runtimeEpoch !== run?.runtimeEpoch) {
      scope = run;
      sites = new Set();
      activeSite = undefined;
    }
    if (!isCurrent()) return false;
    const browser =
      request.name === 'molly/molly_browser'
        ? AgentBrowserCommandSchema.safeParse(request.arguments)
        : undefined;
    let site: string | undefined;
    if (browser?.success && browser.data.kind === 'navigate') {
      try {
        const url = new URL(browser.data.url);
        if (
          ['http:', 'https:'].includes(url.protocol) &&
          classifyBrowserHostname(url.hostname) === 'public'
        )
          site = url.hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        site = undefined;
      }
    } else if (browser?.success) site = activeSite;
    const grant = () => {
      if (!site || !run || !isCurrent()) return false;
      sites.add(site);
      if (browser?.success && browser.data.kind === 'navigate') activeSite = site;
      return { kind: 'browse_task' as const, sites: [...sites] };
    };
    if (run && site && sites.has(site)) {
      if (!(await input.record(request, 'browse_task', 'allow'))) return false;
      return grant();
    }
    const grantSite =
      input.permissionProfileId === 'browse-task-v1' && run && site && sites.size < 8
        ? site
        : undefined;
    if (grantSite && run?.permissionMode === 'auto-review') {
      const verdict = await reviewApproval({
        request,
        review: input.review,
        record: (...args) => (isCurrent() ? input.record(...args) : Promise.resolve(false)),
        subject: {
          toolName: request.name,
          cwd: input.cwd,
          input: {
            site: grantSite,
            pendingAction: browser?.success ? browser.data : request.arguments,
          },
          actionSummary: `Authorize browsing, navigation, search input, clicks and selected-image saves on ${grantSite} for this design task only. This grant does not authorize purchases, publishing or account changes.`,
        },
      });
      if (!isCurrent() || verdict === 'deny') return false;
      if (verdict === 'allow') return grant();
    }
    const choice = await input.ask(request, grantSite);
    if (!isCurrent() || choice === undefined) return false;
    if (choice === 'allow-browse-task' && grantSite) {
      if (!(await input.record(request, 'user', 'allow'))) return false;
      return grant();
    }
    if (choice === 'allow-once') {
      if (!(await input.record(request, 'user', 'allow')) || !isCurrent()) return false;
      if (browser?.success && browser.data.kind === 'navigate' && run && site) activeSite = site;
      return true;
    }
    await input.record(request, 'user', 'deny');
    return false;
  };
}
