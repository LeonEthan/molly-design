import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PrivateControlPipe } from '../src/private-control-pipe';
import { CancellationDeliveryTransport } from '../src/mcp-cancellation';
import { ToolOperationJournal, type OperationResourceRead } from '../src/tool-operation-journal';

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('private control channel', () => {
  it('frames split/coalesced packets without exposing them on ACP', async () => {
    const stream = new PassThrough();
    const pipe = new PrivateControlPipe(stream);
    const pending = pipe.read();
    stream.write('{"version":');
    stream.write('1}\n{"type":"credential","apiKey":"synthetic"}\n');
    expect(await pending).toEqual({ version: 1 });
    expect(await pipe.read()).toEqual({ type: 'credential', apiKey: 'synthetic' });
    pipe.close();
    expect(stream.destroyed).toBe(true);
  });

  it('retires the channel on cancel; a late grant cannot bind another run', async () => {
    const stream = new PassThrough();
    const pipe = new PrivateControlPipe(stream);
    const controller = new AbortController();
    const pending = expect(pipe.read(controller.signal)).rejects.toThrow('harness_control_closed');
    controller.abort();
    await pending;
    await expect(pipe.read()).rejects.toThrow('harness_control_closed');
    expect(stream.destroyed).toBe(true);
  });

  it.each(['invalid-json\n', 'x'.repeat(1024 * 1024 + 1), '{}\n'.repeat(9)])(
    'rejects malformed or unbounded input %#',
    async (packet) => {
      const stream = new PassThrough();
      const pipe = new PrivateControlPipe(stream);
      stream.write(packet);
      await expect(pipe.read()).rejects.toThrow('harness_control_closed');
      expect(stream.destroyed).toBe(true);
    }
  );

  it('settles a waiting reader on EOF and refuses overlapping reads', async () => {
    const stream = new PassThrough();
    const pipe = new PrivateControlPipe(stream);
    const pending = expect(pipe.read()).rejects.toThrow('harness_control_closed');
    await expect(pipe.read()).rejects.toThrow('harness_control_concurrent_read');
    stream.end();
    await pending;
  });
});

describe('MCP cancellation delivery', () => {
  it('delivers a native SDK cancellation to the server before client cleanup', async () => {
    const entered = deferred();
    const cancelled = deferred();
    const queued = deferred();
    const held = deferred();
    const client = new Client({ name: 'synthetic-client', version: '1' });
    const server = new Server(
      { name: 'synthetic-server', version: '1' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
      entered.resolve();
      return new Promise<never>((_resolve, reject) => {
        extra.signal.addEventListener(
          'abort',
          () => {
            cancelled.resolve();
            reject(extra.signal.reason);
          },
          { once: true }
        );
      });
    });
    const [inner, peer] = InMemoryTransport.createLinkedPair();
    const send = inner.send.bind(inner);
    inner.send = async (message, options) => {
      if ('method' in message && message.method === 'notifications/cancelled') {
        queued.resolve();
        await held.promise;
      }
      await send(message, options);
    };
    const transport = new CancellationDeliveryTransport(inner);
    await server.connect(peer);
    await client.connect(transport);
    try {
      const controller = new AbortController();
      const result = client.callTool(
        { name: 'molly_generate_image', arguments: { prompt: 'synthetic' } },
        undefined,
        { signal: controller.signal }
      );
      const checked = expect(result).rejects.toBeInstanceOf(Error);
      await entered.promise;
      controller.abort(new Error('synthetic native cancellation'));
      await queued.promise;
      let settled = false;
      const delivery = transport.waitForCancellationDelivery().then((outcome) => {
        settled = true;
        return outcome;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      held.resolve();
      expect(await delivery).toBe('delivered');
      await cancelled.promise;
      await checked;
    } finally {
      held.resolve();
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('waits for every concurrent cancellation, not only the most recent', async () => {
    const first = deferred();
    const second = deferred();
    const deliveries = [first, second];
    const inner: Transport = {
      start: async () => undefined,
      close: async () => undefined,
      send: () => deliveries.shift()!.promise,
    };
    const transport = new CancellationDeliveryTransport(inner);
    void transport.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 },
    });
    void transport.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 2 },
    });
    let settled = false;
    const result = transport.waitForCancellationDelivery().then((value) => {
      settled = true;
      return value;
    });
    second.resolve();
    await second.promise;
    expect(settled).toBe(false);
    first.resolve();
    expect(await result).toBe('delivered');
  });

  it('bounds an undeliverable cancellation using an injected clock', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const transport = new CancellationDeliveryTransport({
      start: async () => undefined,
      close: async () => undefined,
      send: () => pending.promise,
    });
    void transport.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 },
    });
    const result = transport.waitForCancellationDelivery();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe('timed-out');
    pending.resolve();
  });
});

describe('side-effect dispatch fence', () => {
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'molly-operation-test-'));
    roots.push(directory);
    const journal = new ToolOperationJournal(directory);
    const snapshot = { runId: 'run-1', runtimeEpoch: 'epoch-1' };
    return {
      directory,
      journal,
      input: {
        snapshot,
        connectionId: 'image-connection',
        connectionRevision: 7,
        toolCallId: 'call-1',
        toolName: 'generate',
        arguments: { prompt: 'PRIVATE_SYNTHETIC_PROMPT' },
      },
    };
  }

  it('persists dispatched before invoking; response loss becomes unknown and cannot replay', async () => {
    const f = await fixture();
    const operationId = f.journal.operationId(f.input.snapshot.runId, f.input.toolCallId);
    const effects: string[] = [];
    await expect(
      f.journal.dispatch(f.input, async () => {
        const raw = JSON.parse(await readFile(join(f.directory, `${operationId}.json`), 'utf8'));
        expect(raw.state).toBe('dispatched');
        effects.push('sent');
        throw new Error('upstream response lost');
      })
    ).rejects.toThrow('harness_mcp_outcome_unknown');
    const restored = new ToolOperationJournal(f.directory);
    expect((await restored.read(operationId)).state).toBe('outcome_unknown');
    await expect(
      restored.dispatch(f.input, async () => {
        effects.push('replayed');
      })
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(effects).toEqual(['sent']);
    expect(await readdir(f.directory)).toEqual([`${operationId}.json`]);
    expect(await readFile(join(f.directory, `${operationId}.json`), 'utf8')).not.toContain(
      'PRIVATE_SYNTHETIC_PROMPT'
    );
  });

  it('journals scoped child reads before I/O without releasing the parent serial fence', async () => {
    const f = await fixture();
    const entered = deferred();
    const release = deferred();
    const parentId = f.journal.operationId('run-1', 'call-1');
    const childId = f.journal.operationId('run-1', 'read-1');
    const events: string[] = [];
    let retainedRead: OperationResourceRead | undefined;
    const parent = f.journal.dispatch(f.input, async (context) => {
      if (!context) throw new Error('missing dispatch context');
      retainedRead = context.readResource;
      events.push('parent');
      await context.readResource('read-1', 'synthetic://one', async () => {
        for (const id of [parentId, childId]) {
          expect(JSON.parse(await readFile(join(f.directory, `${id}.json`), 'utf8')).state).toBe(
            'dispatched'
          );
        }
        events.push('child');
        entered.resolve();
        await release.promise;
        return { contents: [{ uri: 'synthetic://one', text: 'result' }] };
      });
      events.push('parent-response');
      return { content: [] };
    });
    await entered.promise;
    const queued = f.journal.dispatch({ ...f.input, toolCallId: 'next' }, async () => {
      events.push('queued');
      return { content: [] };
    });
    expect(events).toEqual(['parent', 'child']);
    release.resolve();
    await Promise.all([parent, queued]);
    expect(events).toEqual(['parent', 'child', 'parent-response', 'queued']);
    expect(await f.journal.read(childId)).toMatchObject({
      state: 'succeeded',
      parentOperationId: parentId,
      connectionId: f.input.connectionId,
      connectionRevision: 7,
      toolName: 'resources/read',
    });
    await expect(
      retainedRead!('late', 'synthetic://late', async () => events.push('late'))
    ).rejects.toThrow('harness_resource_parent_retired');
    expect(events).not.toContain('late');
  });

  it('retains child and parent uncertainty even when the invoking callback swallows a read failure', async () => {
    const f = await fixture();
    await expect(
      f.journal.dispatch(f.input, async (context) => {
        if (!context) throw new Error('missing dispatch context');
        await context
          .readResource('lost-read', 'synthetic://lost', async () => {
            throw new Error('private resource diagnostic');
          })
          .catch(() => undefined);
        return { content: [] };
      })
    ).rejects.toThrow('harness_mcp_outcome_unknown');
    const restored = new ToolOperationJournal(f.directory);
    for (const call of ['call-1', 'lost-read']) {
      expect((await restored.read(restored.operationId('run-1', call))).state).toBe(
        'outcome_unknown'
      );
    }
    await expect(
      restored.dispatch({ ...f.input, toolCallId: 'retry' }, async () => {
        throw new Error('must not dispatch');
      })
    ).rejects.toThrow('harness_mcp_outcome_unknown');
  });

  it('fences declared external image failures after reload and ignores forged private receipts', async () => {
    const f = await fixture();
    const result = {
      isError: true,
      content: [],
      _meta: {
        mollyImageOperation: {
          version: 1,
          state: 'succeeded',
          dispatched: false,
          assetDigests: ['1'.repeat(64)],
        },
      },
    };
    await f.journal.dispatch({ ...f.input, externalImage: true }, async () => result);
    const restored = new ToolOperationJournal(f.directory);
    expect(await restored.read(restored.operationId('run-1', 'call-1'))).toMatchObject({
      state: 'failed',
      requiresExplicitRetry: true,
      assetDigests: [],
    });
    const effects: string[] = [];
    await expect(
      restored.dispatch({ ...f.input, toolCallId: 'new-call' }, async () => {
        effects.push('retry');
      })
    ).rejects.toThrow('harness_paid_retry_requires_user');
    expect(effects).toEqual([]);
  });

  it.each([false, true])('records the returned tool outcome (isError=%s)', async (isError) => {
    const f = await fixture();
    const result = { content: [], isError };
    expect(await f.journal.dispatch(f.input, async () => result)).toBe(result);
    expect((await f.journal.read(f.journal.operationId('run-1', 'call-1'))).state).toBe(
      isError ? 'failed' : 'succeeded'
    );
  });

  it('fences new call IDs and connections after unknown delivery, including after reload', async () => {
    const f = await fixture();
    const effects: string[] = [];
    await expect(
      f.journal.dispatch(f.input, async () => {
        effects.push('original');
        throw new Error('lost');
      })
    ).rejects.toThrow('harness_mcp_outcome_unknown');
    const restored = new ToolOperationJournal(f.directory);
    await expect(
      restored.dispatch(
        {
          ...f.input,
          toolCallId: 'different-call',
          toolName: 'edit',
          connectionId: 'another-connection',
        },
        async () => effects.push('automatic retry')
      )
    ).rejects.toThrow('harness_mcp_outcome_unknown');
    await restored.dispatch(
      {
        ...f.input,
        snapshot: { ...f.input.snapshot, runId: 'explicit-next-user-run' },
      },
      async () => effects.push('explicit new operation')
    );
    expect(effects).toEqual(['original', 'explicit new operation']);
  });

  it.each(['succeeded', 'failed', 'outcome_unknown'] as const)(
    'persists the trusted image receipt (%s) without treating paid failures as retry permission',
    async (state) => {
      const f = await fixture();
      const assetDigests = state === 'succeeded' ? ['1'.repeat(64)] : [];
      const result = {
        content: [],
        isError: state !== 'succeeded',
        _meta: {
          mollyImageOperation: { version: 1, state, dispatched: true, assetDigests },
        },
      };
      const pending = f.journal.dispatch({ ...f.input, builtinImage: true }, async () => result);
      if (state === 'outcome_unknown')
        await expect(pending).rejects.toThrow('harness_mcp_outcome_unknown');
      else expect(await pending).toBe(result);
      const restored = new ToolOperationJournal(f.directory);
      expect(await restored.read(restored.operationId('run-1', 'call-1'))).toMatchObject({
        state,
        assetDigests,
      });
      if (state !== 'succeeded') {
        const effects: string[] = [];
        await expect(
          restored.dispatch({ ...f.input, toolCallId: 'new-id' }, async () => {
            effects.push('repeated');
          })
        ).rejects.toThrow(
          state === 'failed' ? 'harness_paid_retry_requires_user' : 'harness_mcp_outcome_unknown'
        );
        expect(effects).toEqual([]);
      }
    }
  );

  it('settles a concurrent dispatch before deciding whether a subsequent effect is safe', async () => {
    const f = await fixture();
    const entered = deferred();
    const release = deferred();
    const effects: string[] = [];
    const first = expect(
      f.journal.dispatch(f.input, async () => {
        effects.push('original');
        entered.resolve();
        await release.promise;
        throw new Error('lost');
      })
    ).rejects.toThrow('harness_mcp_outcome_unknown');
    await entered.promise;
    const second = expect(
      f.journal.dispatch({ ...f.input, toolCallId: 'concurrent' }, async () => {
        effects.push('retry');
      })
    ).rejects.toThrow('harness_mcp_outcome_unknown');
    release.resolve();
    await Promise.all([first, second]);
    expect(effects).toEqual(['original']);
  });
});
