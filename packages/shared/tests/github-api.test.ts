import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GitHubFileTooLargeError,
  githubFetchFileAtCommit,
  githubFetchIssuesAndPRs,
  githubFetchProjectSkillsAtCommit,
} from '../src/github-api';

describe('githubFetchFileAtCommit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects API file bodies larger than the byte cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('hello', { headers: { 'content-length': '5' } }))
    );

    await expect(
      githubFetchFileAtCommit('token', 'owner/repo', 'src/app.ts', 'commit-sha', {
        maxBytes: 4,
      })
    ).rejects.toBeInstanceOf(GitHubFileTooLargeError);
  });

  it('applies the byte cap to raw fallback responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('too large', { status: 403 }))
      .mockResolvedValueOnce(new Response('hello', { headers: { 'content-length': '5' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      githubFetchFileAtCommit('token', 'owner/repo', 'src/app.ts', 'commit-sha', {
        maxBytes: 4,
      })
    ).rejects.toBeInstanceOf(GitHubFileTooLargeError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('githubFetchProjectSkillsAtCommit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups skills by requested directory while following in-repo symlink directories', async () => {
    const skillMarkdown = `---
name: Review Bot
description: Checks diffs
---
# Review
`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/git/trees/commit-sha?recursive=1')) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: '.agents/skills', type: 'tree', sha: 'tree-agents' },
              { path: '.agents/skills/review', type: 'tree', sha: 'tree-review' },
              {
                path: '.agents/skills/review/SKILL.md',
                type: 'blob',
                sha: 'skill-md',
                mode: '100644',
              },
              { path: '.claude/skills', type: 'blob', sha: 'symlink-1', mode: '120000' },
            ],
          })
        );
      }
      if (url.includes('/git/blobs/symlink-1')) {
        return new Response(
          JSON.stringify({
            content: btoa('../.agents/skills'),
            encoding: 'base64',
            size: '../.agents/skills'.length,
          })
        );
      }
      if (url.includes('/contents/.agents/skills/review/SKILL.md')) {
        return new Response(skillMarkdown);
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await githubFetchProjectSkillsAtCommit('token', 'owner/repo', 'commit-sha', [
      '.agents/skills',
      '.claude/skills',
    ]);

    expect(result.groups).toEqual([
      {
        scope: 'project',
        dir: '.agents/skills',
        skills: [
          {
            id: '.agents/skills/review',
            name: 'Review Bot',
            description: 'Checks diffs',
            relativePath: '.agents/skills/review/SKILL.md',
            isSymlink: false,
            content: '# Review',
          },
        ],
        truncated: false,
      },
      {
        scope: 'project',
        dir: '.claude/skills',
        skills: [
          {
            id: '.claude/skills/review',
            name: 'Review Bot',
            description: 'Checks diffs',
            relativePath: '.claude/skills/review/SKILL.md',
            isSymlink: true,
            symlinkTarget: '.agents/skills/review',
            content: '# Review',
          },
        ],
        truncated: false,
      },
    ]);
    expect(result.contentFingerprint).toBe('commit-sha');
    expect(result.treeTruncated).toBe(false);
  });
});

describe('githubFetchIssuesAndPRs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function issuesPageResponse(numbers: number[]) {
    return new Response(
      JSON.stringify(
        numbers.map((number) => ({
          number,
          html_url: `https://github.com/owner/repo/issues/${number}`,
          title: `Issue ${number}`,
          state: 'open',
          updated_at: `2026-07-${String(number).padStart(2, '0')}T00:00:00.000Z`,
        }))
      )
    );
  }

  it('requests both pages concurrently', async () => {
    const startedPages: number[] = [];
    let bothStarted = () => {};
    // Neither request may settle until both have started, so the call can only
    // finish if the two pages really are in flight together.
    const gate = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      startedPages.push(page);
      if (startedPages.length === 2) bothStarted();
      await gate;
      return issuesPageResponse(page === 1 ? [3, 2] : [1]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const items = await githubFetchIssuesAndPRs('token', 'owner/repo');

    expect([...startedPages].sort()).toEqual([1, 2]);
    expect(items.map((item) => item.number)).toEqual([3, 2, 1]);
  });

  it('dedupes across pages and keeps the most recently updated copy', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      if (page === 1) {
        return new Response(
          JSON.stringify([
            {
              number: 7,
              html_url: 'https://github.com/owner/repo/issues/7',
              title: 'Stale copy',
              state: 'open',
              updated_at: '2026-07-01T00:00:00.000Z',
            },
          ])
        );
      }
      return new Response(
        JSON.stringify([
          {
            number: 7,
            html_url: 'https://github.com/owner/repo/issues/7',
            title: 'Fresh copy',
            state: 'open',
            updated_at: '2026-07-09T00:00:00.000Z',
          },
          {
            number: 8,
            html_url: 'https://github.com/owner/repo/pull/8',
            title: 'A pull request',
            state: 'open',
            updated_at: '2026-07-02T00:00:00.000Z',
            pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/8' },
          },
        ])
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const items = await githubFetchIssuesAndPRs('token', 'owner/repo');

    expect(items).toEqual([
      expect.objectContaining({ number: 7, title: 'Fresh copy', type: 'issue' }),
      expect.objectContaining({ number: 8, type: 'pr' }),
    ]);
  });
});
