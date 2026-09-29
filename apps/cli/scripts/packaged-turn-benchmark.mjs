import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

// Local benchmark peer only. No production hooks, user credentials or external service.
const key = 'SYNTHETIC_BENCHMARK_KEY';
const holdText = 'SYNTHETIC_ACTIVE_STREAM';

export async function createSyntheticTurnBenchmark(count, exerciseMcp = false) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 50);
  const requests = [];
  const failures = [];
  let visible;
  let heldClosed;
  const sockets = new Set();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, `Bearer ${key}`);
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        assert.ok(body.length <= 512_000, 'synthetic request exceeded bound');
      }
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, 'synthetic/custom');
      assert.equal(parsed.stream, true);
      const marker = JSON.stringify(parsed.messages.at(-1));
      const hold = marker.includes('SYNTHETIC_CANCEL');
      const callMcp = exerciseMcp && !hold && parsed.messages.at(-1)?.role === 'user';
      if (exerciseMcp && parsed.messages.at(-1)?.role === 'tool')
        assert.ok(
          marker.includes('credential-isolation-ok'),
          'MCP execution did not return the protected server result'
        );
      requests.push({ marker, hold });
      assert.ok(requests.length <= (count + 2) * 2, 'unexpected model dispatch');
      if (callMcp) {
        const script = requests.length === 1;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `synthetic-mcp-${requests.length}`, type: 'function', function: { name: script ? 'mcpScript' : 'mcp', arguments: JSON.stringify(script ? { code: 'emit(await tools.call("synthetic_protected_inspect", {}));' } : { tool: 'synthetic_protected_inspect', args: {} }) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: hold ? holdText : 'Synthetic completion' }, finish_reason: null }] })}\n\n`
      );
      if (hold) {
        response.once('close', () => heldClosed?.resolve(performance.now()));
      } else {
        response.end(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`
        );
      }
    } catch {
      failures.push('synthetic_provider_contract_failed');
      response.destroy();
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    update({ update }) {
      if (
        update.sessionUpdate === 'agent_message_chunk' &&
        update.content?.type === 'text' &&
        update.content.text.includes(holdText)
      )
        visible?.resolve();
    },
    async exercise({ peer, child, config, session, initialBinding, readResources }) {
      const turns = [];
      // Follow cancellation with an explicit new run: retirement must not poison reuse.
      const kinds = [
        ...Array.from({ length: count }, () => 'completed'),
        'cancelled',
        'after-cancel',
      ];
      for (const [index, kind] of kinds.entries()) {
        const runId = index === 0 ? 'synthetic-run' : `synthetic-run-${index}`;
        const turnId = index === 0 ? 'synthetic-turn' : `synthetic-turn-${index}`;
        const runtime = initialBinding;
        const snapshot = {
          schemaVersion: 1,
          runId,
          runtimeEpoch: config.runtimeEpoch,
          sessionId: config.productSessionId,
          turnId,
          connection: config.connection,
          selection: config.selection,
          harness: config.harness,
          toolsetHash: runtime.toolsetHash,
          pluginSetHash: runtime.pluginSetHash,
          permissionProfileId: config.permissionProfileId,
          ...(runtime.mcpConnections ? { mcpConnections: runtime.mcpConnections } : {}),
        };
        await new Promise((resolve, reject) =>
          child.stdio[3].write(
            `${JSON.stringify({ type: 'credential', runtimeEpoch: config.runtimeEpoch, runId, apiKey: key })}\n`,
            (error) => (error ? reject(error) : resolve())
          )
        );
        visible = Promise.withResolvers();
        heldClosed = Promise.withResolvers();
        const promptStartedAt = performance.now();
        const pending = peer.prompt({
          sessionId: session.sessionId,
          prompt: [
            {
              type: 'text',
              text: kind === 'cancelled' ? 'SYNTHETIC_CANCEL' : `SYNTHETIC_COMPLETE_${index}`,
            },
          ],
          _meta: { mollyRunSnapshot: snapshot },
        });
        let cancelStartedAt;
        if (kind === 'cancelled') {
          await Promise.race([
            visible.promise,
            pending.then(() => {
              throw new Error('stream ended before cancellation');
            }),
          ]);
          cancelStartedAt = performance.now();
          await peer.cancel({ sessionId: session.sessionId });
        }
        const result = await pending;
        const settledAt = performance.now();
        assert.equal(result.stopReason, kind === 'cancelled' ? 'cancelled' : 'end_turn');
        assert.equal(result._meta.mollyRunId, runId);
        assert.equal(
          result._meta.mollyNativeOutcome.status,
          kind === 'cancelled' ? 'cancelled' : 'completed'
        );
        const closedAt = kind === 'cancelled' ? await heldClosed.promise : undefined;
        const journalFile = path.join(
          config.privateRoot,
          'runs',
          `${createHash('sha256').update(runId).digest('hex')}.json`
        );
        const journalText = await readFile(journalFile, 'utf8');
        const journal = JSON.parse(journalText);
        assert.equal(journal.state, 'settled');
        assert.deepEqual(
          journal.modelRequests.map((entry) => entry.state),
          kind === 'cancelled' ? ['outcome_unknown'] : Array(exerciseMcp ? 2 : 1).fill('succeeded')
        );
        assert.equal(journal.outcome.status, result._meta.mollyNativeOutcome.status);
        assert.ok(!journalText.includes(key));
        assert.equal(
          requests.length,
          exerciseMcp ? (index + 1) * 2 - (index >= count ? 1 : 0) : index + 1,
          'additional automatic HTTP dispatch'
        );
        assert.deepEqual(failures, []);
        const nativeHistory = await readFile(initialBinding.nativeSessionFile);
        turns.push({
          index,
          kind,
          phase: index === 0 ? 'first' : kind === 'completed' ? 'warm' : kind,
          nativeHistoryBytes: nativeHistory.byteLength,
          promptMs: settledAt - promptStartedAt,
          ...(cancelStartedAt === undefined
            ? {}
            : {
                cancelToSettledMs: settledAt - cancelStartedAt,
                cancelToSocketCloseMs: closedAt - cancelStartedAt,
              }),
          ...(await readResources({ index, kind })),
        });
      }
      const history = await readFile(initialBinding.nativeSessionFile, 'utf8');
      assert.ok(!history.includes(key));
      assert.ok(history.includes('Synthetic completion'));
      if (exerciseMcp) assert.ok(history.includes('credential-isolation-ok'));
      visible = undefined;
      heldClosed = undefined;
      return turns;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
