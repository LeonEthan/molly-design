import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { BashOperations } from '@earendil-works/pi-coding-agent';
import { createApprovedTools, type ToolApprovalResult } from '../src/approved-tools';
import { createAutoReviewApproval, createNetworkReview } from '../src/auto-review';
import { AutoReviewFailure, classifyEscalation } from '../src/auto-review-classifier';
import { decideAutoReview, type AutoReviewBoundary } from '../src/auto-review-policy';
import { RunJournal, type ApprovalRecord } from '../src/run-journal';
import { createSandboxConfig, PRE_ALLOWED_DOMAINS } from '../src/sandbox';
import { defineMcpTools } from '../src/mcp-bridge';
import type { ReviewDecision } from '../vendor/pi-auto-approval/review';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((owned) => rm(owned, { recursive: true, force: true })));
});
async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'molly-auto-review-'));
  roots.push(directory);
  return directory;
}

async function boundary(): Promise<AutoReviewBoundary & { home: string }> {
  const home = await root();
  const cwd = join(home, 'private-data', 'chats', 'session');
  await mkdir(cwd, { recursive: true });
  await mkdir(join(home, '.ssh'), { recursive: true });
  return {
    home,
    cwd,
    writableRoots: [cwd],
    deniedReadRoots: [join(home, '.ssh'), join(home, 'private-data')],
    sandboxAvailable: true,
  };
}

describe('auto-review policy', () => {
  it('runs shell in the sandbox and reviews only requests to leave it', async () => {
    const b = await boundary();
    expect(decideAutoReview({ name: 'bash', arguments: { command: 'npm install' } }, b)).toEqual({
      kind: 'allow',
      source: 'sandbox',
    });
    expect(
      decideAutoReview({ name: 'bash', arguments: { command: 'ls', outside_sandbox: true } }, b)
    ).toMatchObject({ kind: 'review', subject: { toolName: 'bash', input: { command: 'ls' } } });
    expect(
      decideAutoReview(
        { name: 'bash', arguments: { command: 'ls' } },
        { ...b, sandboxAvailable: false }
      )
    ).toEqual({ kind: 'ask' });
  });

  it('keeps file tools inside the workspace boundary and reviews protected paths', async () => {
    const b = await boundary();
    const decide = (name: string, path: string) =>
      decideAutoReview({ name, arguments: { path } }, b).kind;
    expect(decide('write', 'media/layer.png')).toBe('allow');
    expect(decide('read', 'design.yaml')).toBe('allow');
    expect(decide('read', '/usr/share/dict/words')).toBe('allow');
    expect(decide('read', join(b.home, '.ssh', 'id_ed25519'))).toBe('review');
    expect(decide('read', join(b.home, 'private-data', 'settings.json'))).toBe('review');
    expect(decide('write', join(b.home, 'elsewhere.txt'))).toBe('review');
    expect(decide('write', '../escape.txt')).toBe('review');
    expect(decide('read', '~/.ssh/id_ed25519')).toBe('review');
  });

  it('resolves symlinks before judging the boundary', async () => {
    const b = await boundary();
    const { symlink } = await import('node:fs/promises');
    await symlink(join(b.home, '.ssh'), join(b.cwd, 'keys'));
    await writeFile(join(b.home, '.ssh', 'id_ed25519'), 'synthetic');
    expect(decideAutoReview({ name: 'write', arguments: { path: 'keys/new' } }, b).kind).toBe(
      'review'
    );
  });

  it('approves Molly design tools and leaves other tools to the ordinary prompt', async () => {
    const b = await boundary();
    expect(decideAutoReview({ name: 'molly/molly_generate_image', arguments: {} }, b)).toEqual({
      kind: 'allow',
      source: 'design_tool',
    });
    expect(decideAutoReview({ name: 'molly/recover_images', arguments: {} }, b)).toEqual({
      kind: 'allow',
      source: 'design_tool',
    });
    expect(decideAutoReview({ name: 'molly/molly_browser', arguments: {} }, b).kind).toBe('ask');
    expect(decideAutoReview({ name: 'external/delete_everything', arguments: {} }, b).kind).toBe(
      'ask'
    );
  });

  it('denies credential and private reads, re-allows the workspace and pre-allows design domains', async () => {
    const config = createSandboxConfig({
      cwd: '/work',
      temporaryDirectory: '/tmp/molly-sandbox-x',
      deniedReadRoots: ['/home/u/.ssh', '/home/u/molly'],
    });
    expect(config.filesystem).toMatchObject({
      denyRead: ['/home/u/.ssh', '/home/u/molly'],
      allowRead: ['/work', '/tmp/molly-sandbox-x'],
      allowWrite: ['/work', '/tmp/molly-sandbox-x'],
    });
    expect(config.network.allowedDomains).toEqual([...PRE_ALLOWED_DOMAINS]);
    expect(PRE_ALLOWED_DOMAINS).toEqual(
      expect.arrayContaining(['registry.npmjs.org', 'github.com', 'fonts.gstatic.com'])
    );
  });
});

function harness(options: {
  mode?: 'ask' | 'auto-review';
  decision?: ReturnType<typeof decideAutoReview>;
  verdict?: ReviewDecision | Error;
  userAllows?: boolean;
  recordSucceeds?: boolean;
}) {
  const records: Array<Pick<ApprovalRecord, 'source' | 'decision'>> = [];
  const asked: string[] = [];
  const reviewed: string[] = [];
  const approve = createAutoReviewApproval({
    mode: () => options.mode ?? 'auto-review',
    decide: () => options.decision ?? { kind: 'ask' },
    review: async (subject) => {
      reviewed.push(subject.toolName);
      if (options.verdict instanceof Error) throw options.verdict;
      return options.verdict ?? { outcome: 'deny' };
    },
    record: async (_request, source, decision) => {
      records.push({ source, decision });
      return options.recordSucceeds ?? true;
    },
    askUser: async (request) => {
      asked.push(request.name);
      return options.userAllows ?? false;
    },
  });
  const call = (name = 'bash'): Promise<ToolApprovalResult> =>
    approve({ toolCallId: 'call', name, arguments: {} });
  return { call, records, asked, reviewed };
}

const reviewDecision: ReturnType<typeof decideAutoReview> = {
  kind: 'review',
  subject: { toolName: 'bash', input: {}, cwd: '/work', actionSummary: 'synthetic' },
};

describe('auto-review approval', () => {
  it.each(['timeout', 'invalid_response', 'failed', 'cancelled'] as const)(
    'records a bounded %s outcome without retaining classifier text',
    async (kind) => {
      const records: ApprovalRecord[] = [];
      const prompts: string[] = [];
      const approve = createAutoReviewApproval({
        mode: () => 'auto-review',
        decide: () => reviewDecision,
        review: async () => {
          throw new AutoReviewFailure(kind);
        },
        record: async (request, source, decision, reviewOutcome) => {
          records.push({
            toolCallId: request.toolCallId,
            tool: request.name,
            source,
            decision,
            reviewOutcome,
          });
          return true;
        },
        askUser: async (request) => {
          prompts.push(request.name);
          return true;
        },
      });
      expect(await approve({ toolCallId: 'call', name: 'bash', arguments: {} })).toBe(
        kind !== 'cancelled'
      );
      expect(records).toEqual([
        {
          toolCallId: 'call',
          tool: 'bash',
          source: 'classifier',
          decision: 'deny',
          reviewOutcome: kind,
        },
      ]);
      expect(prompts).toEqual(kind === 'cancelled' ? [] : ['bash']);
    }
  );
  it.each(['molly_upload_images', 'molly_upload_files'])(
    'shares local attachments through %s automatically only in auto-review mode',
    async (name) => {
      const b = await boundary();
      let mode: 'ask' | 'auto-review' = 'auto-review';
      const asked: string[] = [];
      const records: ApprovalRecord[] = [];
      const delivered: unknown[] = [];
      const tools = await defineMcpTools({
        serverName: 'molly',
        client: {
          listTools: async () => ({ tools: [{ name, inputSchema: { type: 'object' as const } }] }),
          callTool: async (request) => {
            delivered.push(request.arguments);
            return { content: [{ type: 'text' as const, text: 'Uploaded 1 local attachment' }] };
          },
          close: async () => {},
          getServerCapabilities: () => ({}),
          readResource: async () => ({ contents: [] }),
        },
        isAvailable: () => true,
        dispatch: async (_server, _id, _name, _args, invoke) => invoke(),
        approve: createAutoReviewApproval({
          mode: () => mode,
          decide: (request) => decideAutoReview(request, b),
          review: async () => {
            throw new Error('local sharing does not need a classifier');
          },
          record: async (request, source, decision) => {
            records.push({ toolCallId: request.toolCallId, tool: request.name, source, decision });
            return true;
          },
          askUser: async (request) => {
            asked.push(request.name);
            return false;
          },
        }),
      });
      const tool = tools[0];
      if (!tool) throw new Error('missing upload tool');
      const args = { paths: ['media/result.png'] };
      await expect(tool.execute('auto-upload', args, undefined)).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Uploaded 1 local attachment' }],
      });
      expect(asked).toEqual([]);
      expect(records).toEqual([
        {
          toolCallId: 'auto-upload',
          tool: `molly/${name}`,
          source: 'design_tool',
          decision: 'allow',
        },
      ]);
      mode = 'ask';
      await expect(tool.execute('ask-upload', args, undefined)).rejects.toThrow();
      expect(asked).toEqual([`molly/${name}`]);
      expect(delivered).toEqual([args]);
    }
  );

  it('runs sandboxed shell without a prompt and records the source', async () => {
    const h = harness({ decision: { kind: 'allow', source: 'sandbox' } });
    expect(await h.call()).toEqual({ kind: 'sandboxed' });
    expect(h.asked).toEqual([]);
    expect(h.records).toEqual([{ source: 'sandbox', decision: 'allow' }]);
  });

  it('lets a classifier allow an escalation without a prompt', async () => {
    const h = harness({ decision: reviewDecision, verdict: { outcome: 'allow' } });
    expect(await h.call()).toBe(true);
    expect(h.asked).toEqual([]);
    expect(h.records).toEqual([{ source: 'classifier', decision: 'allow' }]);
  });

  it.each([
    ['deny', { outcome: 'deny' as const }],
    ['failure', new Error('synthetic classifier failure')],
  ])('asks the user after a classifier %s', async (_label, verdict) => {
    const h = harness({ decision: reviewDecision, verdict, userAllows: true });
    expect(await h.call()).toBe(true);
    expect(h.reviewed).toEqual(['bash']);
    expect(h.asked).toEqual(['bash']);
  });

  it('keeps every prompt in ask mode and for tools outside the boundary', async () => {
    const ask = harness({ mode: 'ask', decision: { kind: 'allow', source: 'sandbox' } });
    expect(await ask.call()).toBe(false);
    expect(ask.asked).toEqual(['bash']);
    expect(ask.records).toEqual([]);
    const other = harness({ decision: { kind: 'ask' } });
    await other.call('external/tool');
    expect(other.asked).toEqual(['external/tool']);
    expect(other.reviewed).toEqual([]);
  });

  it('fails closed when provenance cannot be recorded', async () => {
    const h = harness({ decision: { kind: 'allow', source: 'workspace' }, recordSucceeds: false });
    expect(await h.call('write')).toBe(false);
  });
});

describe('sandbox network review', () => {
  it('reviews an unknown domain once per run and asks after a deny', async () => {
    const asked: unknown[] = [];
    let verdict: ReviewDecision = { outcome: 'allow' };
    let runId = 'run-1';
    const review = createNetworkReview({
      run: () => ({ runId, permissionMode: 'auto-review' }),
      cwd: '/work',
      review: async () => verdict,
      record: async () => true,
      askUser: async (request) => {
        asked.push(request.arguments);
        return false;
      },
    });
    expect(await review({ host: 'example.com', port: 443 })).toBe(true);
    verdict = { outcome: 'deny' };
    expect(await review({ host: 'example.com', port: 443 })).toBe(true);
    expect(await review({ host: 'tracker.example', port: undefined })).toBe(false);
    expect(asked).toEqual([{ host: 'tracker.example' }]);
    runId = 'run-2';
    expect(await review({ host: 'example.com', port: 443 })).toBe(false);
  });

  it('never opens the network outside an auto-review run', async () => {
    const review = createNetworkReview({
      run: () => ({ runId: 'run', permissionMode: 'ask' }),
      cwd: '/work',
      review: async () => ({ outcome: 'allow' }),
      record: async () => true,
      askUser: async () => true,
    });
    expect(await review({ host: 'example.com', port: 443 })).toBe(false);
  });
});

describe('approved bash tool', () => {
  const execute = async (approval: ToolApprovalResult, args: Record<string, unknown>) => {
    const cwd = await root();
    const executed: Array<{ backend: string; command: string }> = [];
    const operations = (backend: string): BashOperations => ({
      exec: async (command, _cwd, options) => {
        executed.push({ backend, command });
        options.onData(Buffer.from(`${backend} ok\n`));
        return { exitCode: 0 };
      },
    });
    const tools = createApprovedTools({
      cwd,
      shellPath: '/bin/sh',
      approve: async () => approval,
      sandboxOperations: operations('sandbox'),
    });
    const bash = tools.find((tool) => tool.name === 'bash')!;
    const result = await bash.execute(
      'call',
      args as never,
      undefined,
      undefined,
      undefined as never
    );
    return { executed, text: JSON.stringify(result.content) };
  };

  it('runs a sandboxed approval through the sandbox backend without the escalation flag', async () => {
    const { executed, text } = await execute(
      { kind: 'sandboxed' },
      { command: 'echo hi', outside_sandbox: false }
    );
    expect(executed).toEqual([{ backend: 'sandbox', command: 'echo hi' }]);
    expect(text).toContain('sandbox ok');
  });

  it('advertises the optional escalation argument and refuses a denied call', async () => {
    const tools = createApprovedTools({
      cwd: await root(),
      shellPath: '/bin/sh',
      approve: async () => false,
    });
    const bash = tools.find((tool) => tool.name === 'bash')!;
    expect(JSON.stringify(bash.parameters)).toContain('outside_sandbox');
    await expect(
      bash.execute('call', { command: 'true' } as never, undefined, undefined, undefined as never)
    ).rejects.toThrow('harness_permission_denied');
  });
});

describe('escalation classifier', () => {
  const message = (text: string, stopReason: AssistantMessage['stopReason'] = 'stop') =>
    ({
      role: 'assistant',
      content: [{ type: 'text', text }],
      stopReason,
    }) as AssistantMessage;
  const run = (reply: AssistantMessage) => {
    const contexts: unknown[] = [];
    return {
      contexts,
      result: classifyEscalation({
        runtime: {
          completeSimple: async (_model, context) => {
            contexts.push(context);
            return reply;
          },
        },
        model: {} as never,
        entries: [
          { type: 'message', message: { role: 'user', content: 'make a poster about tea' } },
        ],
        subject: {
          toolName: 'network',
          input: { host: 'example.com' },
          cwd: '/work',
          actionSummary: 'Connect to example.com',
        },
        signal: new AbortController().signal,
      }),
    };
  };

  it('asks the session model with the user request and the pending action', async () => {
    const { result, contexts } = run(message('{"outcome":"allow"}'));
    await expect(result).resolves.toEqual({ outcome: 'allow' });
    expect(JSON.stringify(contexts)).toContain('make a poster about tea');
    expect(JSON.stringify(contexts)).toContain('example.com');
  });

  it('treats a provider error or unparseable answer as a failure', async () => {
    await expect(run(message('', 'error')).result).rejects.toMatchObject({ kind: 'failed' });
    await expect(run(message('maybe')).result).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

describe('approval provenance', () => {
  it('appends approvals to the active run without tool arguments', async () => {
    const directory = await root();
    const journal = new RunJournal(directory);
    const snapshot = {
      schemaVersion: 1 as const,
      runId: 'run-provenance',
      runtimeEpoch: 'epoch',
      sessionId: 'session',
      turnId: 'turn',
      connection: {
        schemaVersion: 1 as const,
        id: 'connection',
        revision: 1,
        providerPresetId: 'openai' as const,
        displayName: 'Synthetic',
        baseUrl: 'https://example.invalid/v1',
        credentialRef: 'synthetic-ref',
        enabled: true,
      },
      selection: { connectionId: 'connection', modelId: 'gpt-4o', thinking: 'off' as const },
      harness: {
        id: 'molly' as const,
        engine: 'pi' as const,
        engineVersion: '0.85.1' as const,
        protocolVersion: 1 as const,
        buildId: 'test-build',
      },
      pluginSetHash: 'a'.repeat(64),
      toolsetHash: 'b'.repeat(64),
      permissionProfileId: 'browse-task-v1',
      permissionMode: 'auto-review' as const,
    };
    await journal.begin(snapshot);
    await journal.approval('run-provenance', 'epoch', {
      toolCallId: 'call',
      tool: 'bash',
      source: 'sandbox',
      decision: 'allow',
    });
    await journal.approval('run-provenance', 'epoch', {
      toolCallId: 'reviewed',
      tool: 'bash',
      source: 'classifier',
      decision: 'deny',
      reviewOutcome: 'timeout',
    });
    await expect(
      journal.approval('run-provenance', 'other-epoch', {
        toolCallId: 'late',
        tool: 'bash',
        source: 'user',
        decision: 'allow',
      })
    ).rejects.toThrow('harness_stale_request');
    expect((await journal.read('run-provenance')).approvals).toEqual([
      { toolCallId: 'call', tool: 'bash', source: 'sandbox', decision: 'allow' },
      {
        toolCallId: 'reviewed',
        tool: 'bash',
        source: 'classifier',
        decision: 'deny',
        reviewOutcome: 'timeout',
      },
    ]);
  });
});
