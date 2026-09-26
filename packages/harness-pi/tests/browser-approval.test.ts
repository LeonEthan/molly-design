import { describe, expect, it } from 'vitest';
import { createBrowserTaskApproval } from '../src/browser-approval';
import type { ApprovalRecord } from '../src/run-journal';
import type { ReviewSubject } from '../vendor/pi-auto-approval/review';

function setup(mode: 'auto-review' | 'ask' = 'auto-review') {
  let run = { runId: 'one', runtimeEpoch: 'epoch', permissionMode: mode };
  const records: ApprovalRecord[] = [];
  const subjects: ReviewSubject[] = [];
  const prompts: Array<string | undefined> = [];
  const approve = createBrowserTaskApproval({
    cwd: '/work',
    permissionProfileId: 'browse-task-v1',
    run: () => run,
    review: async (subject) => {
      subjects.push(subject);
      return { outcome: 'allow' };
    },
    record: async (request, source, decision) => {
      records.push({ toolCallId: request.toolCallId, tool: request.name, source, decision });
      return true;
    },
    ask: async (_request, site) => {
      prompts.push(site);
      return 'deny';
    },
  });
  const navigate = (host: string) =>
    approve({
      toolCallId: host,
      name: 'molly/molly_browser',
      arguments: { kind: 'navigate', url: `https://${host}/search?q=poster` },
    });
  return {
    approve,
    navigate,
    records,
    subjects,
    prompts,
    changeRun: () => {
      run = { ...run, runId: 'two' };
    },
  };
}

describe('browser task approval', () => {
  it('reviews each new site and leaves destinations beyond the eight-site grant to the user', async () => {
    const h = setup();
    for (let index = 0; index < 8; index++) {
      expect(await h.navigate(`design${index}.example`)).toEqual({
        kind: 'browse_task',
        sites: Array.from({ length: index + 1 }, (_, n) => `design${n}.example`),
      });
    }
    expect(await h.navigate('ninth.example')).toBe(false);
    expect(h.subjects.map((subject) => (subject.input as { site: string }).site)).toEqual(
      Array.from({ length: 8 }, (_, n) => `design${n}.example`)
    );
    expect(h.prompts).toEqual([undefined]);
  });
  it('denies an unrecorded approval and does not reuse it as a site grant', async () => {
    let writable = false;
    const sources: string[] = [];
    const approve = createBrowserTaskApproval({
      cwd: '/work',
      permissionProfileId: 'browse-task-v1',
      run: () => ({ runId: 'one', runtimeEpoch: 'epoch', permissionMode: 'auto-review' }),
      review: async () => ({ outcome: 'allow' }),
      record: async (_request, source) => {
        sources.push(source);
        return writable;
      },
      ask: async () => {
        throw new Error('failed recording must deny');
      },
    });
    const request = {
      toolCallId: 'nav',
      name: 'molly/molly_browser',
      arguments: { kind: 'navigate', url: 'https://pinterest.com' },
    };
    expect(await approve(request)).toBe(false);
    writable = true;
    expect(await approve({ ...request, toolCallId: 'retry' })).toEqual({
      kind: 'browse_task',
      sites: ['pinterest.com'],
    });
    expect(sources).toEqual(['classifier', 'classifier']);
  });
  it('does not grant a site after the run changes during review', async () => {
    let run = { runId: 'one', runtimeEpoch: 'epoch', permissionMode: 'auto-review' as const };
    const approve = createBrowserTaskApproval({
      cwd: '/work',
      permissionProfileId: 'browse-task-v1',
      run: () => run,
      review: async () => {
        run = { ...run, runtimeEpoch: 'replacement' };
        return { outcome: 'allow' };
      },
      record: async () => true,
      ask: async () => {
        throw new Error('stale scope must not prompt');
      },
    });
    expect(
      await approve({
        toolCallId: 'nav',
        name: 'molly/molly_browser',
        arguments: { kind: 'navigate', url: 'https://pinterest.com' },
      })
    ).toBe(false);
  });
  it('asks after a denied review and preserves a one-time choice', async () => {
    const prompts: Array<string | undefined> = [];
    const records: string[] = [];
    const approve = createBrowserTaskApproval({
      cwd: '/work',
      permissionProfileId: 'browse-task-v1',
      run: () => ({ runId: 'one', runtimeEpoch: 'epoch', permissionMode: 'auto-review' }),
      review: async () => ({ outcome: 'deny' }),
      record: async (_request, source) => {
        records.push(source);
        return true;
      },
      ask: async (_request, site) => {
        prompts.push(site);
        return 'allow-once';
      },
    });
    const request = {
      toolCallId: 'nav',
      name: 'molly/molly_browser',
      arguments: { kind: 'navigate', url: 'https://pinterest.com' },
    };
    expect(await approve(request)).toBe(true);
    expect(await approve({ ...request, toolCallId: 'next' })).toBe(true);
    expect(prompts).toEqual(['pinterest.com', 'pinterest.com']);
    expect(records).toEqual(['classifier', 'user', 'classifier', 'user']);
  });
  it('reviews the first research site, reuses it within the run and reviews a new run', async () => {
    const h = setup();
    expect(await h.navigate('www.pinterest.com')).toEqual({
      kind: 'browse_task',
      sites: ['pinterest.com'],
    });
    expect(
      await h.approve({
        toolCallId: 'screenshot',
        name: 'molly/molly_browser',
        arguments: { kind: 'screenshot' },
      })
    ).toEqual({ kind: 'browse_task', sites: ['pinterest.com'] });
    expect(h.prompts).toEqual([]);
    expect(h.subjects.map((s) => s.toolName)).toEqual(['molly/molly_browser']);
    expect(h.records.map((r) => r.source)).toEqual(['classifier', 'browse_task']);
    h.changeRun();
    expect(await h.navigate('pinterest.com')).toEqual({
      kind: 'browse_task',
      sites: ['pinterest.com'],
    });
    expect(h.records.map((r) => r.source)).toEqual(['classifier', 'browse_task', 'classifier']);
  });

  it('keeps ask-mode, private destinations and external tools out of automatic site grants', async () => {
    const manual = setup('ask');
    expect(await manual.navigate('pinterest.com')).toBe(false);
    expect(manual.subjects).toEqual([]);
    const h = setup();
    expect(await h.navigate('127.0.0.1')).toBe(false);
    expect(
      await h.approve({
        toolCallId: 'external',
        name: 'external/molly_browser',
        arguments: { kind: 'navigate', url: 'https://pinterest.com' },
      })
    ).toBe(false);
    expect(h.subjects).toEqual([]);
  });
});
