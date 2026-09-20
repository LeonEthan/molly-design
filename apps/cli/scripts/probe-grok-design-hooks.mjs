/** Manual audit of the pinned real Grok runtime; this is not a design adapter. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const runtime = (process.env.MOLLY_PROBE_GROK ?? process.env.LODY_PROBE_GROK);
assert.ok(runtime, 'Set MOLLY_PROBE_GROK to the official Grok 1.0.13 executable');
assert.match(execFileSync(runtime, ['--version'], { encoding: 'utf8' }), /^grok 1\.0\.13 /);
const root = await mkdtemp(path.join(tmpdir(), 'molly-grok-hooks-'));
const work = path.join(root, 'work');
const home = path.join(root, 'grok');
await mkdir(work);
await mkdir(home);
// Deliberate allowlist: no inherited model credentials or provider overrides.
const env = {
  PATH: process.env.PATH,
  GROK_HOME: home,
  GROK_DISABLE_AUTOUPDATER: '1',
  GROK_TELEMETRY_ENABLED: '0',
  GROK_TELEMETRY_TRACE_UPLOAD: '0',
  GROK_MEMORY: '0',
};
const observations = [];
const events = [];
let generation = 0;
let cancelMode = false;
let deliveredRead = false;
let deliveredLargeRead = false;
let child;
let sessionId;
const pending = new Map();
let nextId = 0;
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
const source = path.join(work, 'source.txt');
const large = path.join(work, 'large.txt');
await writeFile(source, 'native delivered text\n');
await writeFile(large, `${'A'.repeat(60000)}\n`);
const actions = [
  // One generated response contains both calls. Arrival order is not generation identity.
  [
    ['read_file', { target_file: source }, 'read'],
    ['write', { file_path: path.join(work, 'normal.txt'), content: 'normal' }, 'write'],
  ],
  [['write', { file_path: path.join(work, 'denied.txt'), content: 'denied' }, 'deny']],
  [['write', { file_path: path.join(work, 'error.txt'), content: 'after-error' }, 'error']],
  [['write', { file_path: path.join(work, 'timeout.txt'), content: 'after-timeout' }, 'timeout']],
  [['read_file', { target_file: large }, 'large']],
  [['read_file', { target_file: path.join(work, 'missing.txt') }, 'missing']],
  [
    [
      'run_terminal_command',
      { command: 'exit 9', description: 'Synthetic nonzero shell result' },
      'shell',
    ],
  ],
];
const server = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};
  if (req.url.endsWith('/models')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ object: 'list', data: [] }));
    return;
  }
  assert.equal(req.url, '/v1/chat/completions');
  const title = body.tools?.[0]?.function?.name === 'session_title';
  for (const message of body.messages ?? []) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue;
    if (message.tool_call_id === 'read' && message.content.includes('native delivered text'))
      deliveredRead = true;
    if (message.tool_call_id === 'large' && message.content.includes('A'.repeat(60000)))
      deliveredLargeRead = true;
  }
  let delta = { role: 'assistant', content: 'Synthetic probe complete.' };
  let finish = 'stop';
  if (!title) {
    generation++;
    observations.push({ type: 'model_request', generation });
    const batch = cancelMode
      ? [['write', { file_path: path.join(work, 'cancelled.txt'), content: 'cancelled' }, 'cancel']]
      : actions[generation - 1];
    if (batch) {
      finish = 'tool_calls';
      delta = {
        role: 'assistant',
        tool_calls: batch.map(([name, args, id], index) => ({
          index,
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        })),
      };
    }
    // Store only in temp: actual native tool results are captured records, not fixtures.
    await writeFile(path.join(root, `model-${generation}.json`), JSON.stringify(body));
  }
  res.setHeader('content-type', 'text/event-stream');
  const chunk = (value, finishReason) =>
    `data: ${JSON.stringify({
      id: 'synthetic',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'probe',
      choices: [{ index: 0, delta: value, finish_reason: finishReason }],
    })}\n\n`;
  res.end(chunk(delta, null) + chunk({}, finish) + 'data: [DONE]\n\n');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseConfig = `[cli]\nauto_update=false\n[models]\ndefault="probe"\n[model.probe]\nmodel="probe"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\napi_key="synthetic-only"\n[features]\ntelemetry=false\n[telemetry]\ntrace_upload=false\n[compat.claude]\nrules=false\nskills=false\nagents=false\nhooks=false\nmcps=false\n[compat.cursor]\nrules=false\nskills=false\nagents=false\nhooks=false\nmcps=false\n[memory]\nenabled=false\n`;
await writeFile(path.join(home, 'config.toml'), baseConfig);
// Discovery is read-only. Disable discovered user plugins only in this temporary home,
// so an unrelated installed plugin cannot start its MCP server during the audit.
const inspection = JSON.parse(
  execFileSync(runtime, ['--cwd', work, 'inspect', '--json'], { env, encoding: 'utf8' })
);
await writeFile(
  path.join(home, 'config.toml'),
  `${baseConfig}\n[plugins]\ndisabled=${JSON.stringify(inspection.plugins.map((p) => p.name))}\n`
);
const adapter = fileURLToPath(
  new URL('../../../vendor/acp-extension-grok/src/index.js', import.meta.url)
);
child = spawn(process.execPath, [adapter], {
  cwd: work,
  env: { ...env, GROK_PATH: runtime },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
child.on('exit', () => {
  for (const waiter of pending.values()) waiter.reject(new Error(stderr || 'Native child exited'));
});
const timer = setTimeout(() => {
  for (const waiter of pending.values())
    waiter.reject(new Error('Native audit exceeded 45 seconds'));
  child.kill();
}, 45000);
createInterface({ input: child.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  const waiter = message.method ? undefined : pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
    return;
  }
  if (message.method?.includes('/hooks/')) {
    events.push(message);
    observations.push({
      type: message.method,
      id: message.params.toolUseId,
      generation,
      request: message.id !== undefined,
    });
    if (message.id !== undefined) {
      const id = message.params.toolUseId;
      if (id === 'cancel') {
        send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
        return;
      }
      if (id === 'timeout') return;
      if (id === 'error')
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: 'Synthetic hook error' },
        });
      else
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: id === 'deny' ? { decision: 'deny', systemMessage: 'Synthetic refusal' } : {},
        });
    }
  } else if (message.id !== undefined) {
    assert.equal(message.method, 'session/request_permission');
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        outcome: {
          outcome: 'selected',
          optionId: message.params.options.find((option) => option.kind === 'allow_once').optionId,
        },
      },
    });
  }
});
try {
  const initialized = await call('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'synthetic-hook-audit', version: '1' },
  });
  const hooks = Object.fromEntries(
    [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'StopCancelled',
      'BeforeModel',
    ].map((event) => [event, [{ hookCallbackIds: ['audit'], timeout: 1 }]])
  );
  const session = await call('session/new', {
    cwd: work,
    mcpServers: [],
    _meta: { 'x.ai/hooks': hooks },
  });
  sessionId = session.sessionId;
  const result = await call('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'Run the synthetic native hook audit.' }],
  });
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(await readFile(path.join(work, 'normal.txt'), 'utf8'), 'normal');
  await assert.rejects(readFile(path.join(work, 'denied.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(work, 'error.txt'), 'utf8'), 'after-error');
  const postRead = events.find(
    (e) => e.params.toolUseId === 'read' && e.params.hookEventName === 'post_tool_use'
  );
  assert.ok(postRead);
  assert.ok(deliveredRead);
  assert.ok(deliveredLargeRead);
  assert.equal(
    postRead.id,
    undefined,
    'Native SDK post hook is a notification, not an awaited request'
  );
  assert.equal(postRead.params.toolResult.FileContent.raw_output, 'native delivered text\n');
  assert.equal(await readFile(path.join(work, 'timeout.txt'), 'utf8'), 'after-timeout');
  const largeEvent = events.find(
    (e) => e.params.toolUseId === 'large' && e.params.hookEventName === 'post_tool_use'
  );
  assert.ok(largeEvent);
  assert.equal(largeEvent.params.toolResultTruncated, true);
  assert.ok(!events.some((e) => /before.?model/i.test(e.params.hookEventName)));
  cancelMode = true;
  const cancelled = await call('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'Synthetic cancellation probe.' }],
  });
  assert.equal(cancelled.stopReason, 'cancelled');
  await assert.rejects(readFile(path.join(work, 'cancelled.txt')), { code: 'ENOENT' });
  const summary = {
    runtime: 'Grok Build 1.0.13',
    adapter: 'acp-extension-grok 0.1.0',
    capability: initialized.agentCapabilities._meta,
    normalWrite: true,
    explicitDeny: true,
    hookErrorFailsOpen: true,
    hookTimeoutFailsOpen: true,
    cancelledWriteAbsent: true,
    sdkPostReadIsNotification: true,
    exactReadTextReachedNextModel: deliveredRead,
    largeReadTextReachedNextModel: deliveredLargeRead,
    largeRead: largeEvent.params,
    events: observations,
    missingRead: events.filter((e) => e.params.toolUseId === 'missing').map((e) => e.params),
    nonzeroShell: events.filter((e) => e.params.toolUseId === 'shell').map((e) => e.params),
  };
  await writeFile(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify({
      evidence: root,
      result: 'Native audit passed; no design-hook support claimed',
      modelRequests: generation,
    })
  );
} finally {
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await writeFile(path.join(root, 'stderr.log'), stderr);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
