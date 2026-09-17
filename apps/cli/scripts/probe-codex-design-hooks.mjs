// Native Codex hook audit. Uses a synthetic localhost Responses stream, not a paid model.
// Requires macOS/Linux, Node 22+, Python 3 and codex-cli 0.153.4 on PATH.
// Runtime transcripts stay in an isolated temporary directory and are never printed.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
const codex = process.env.CODEX_PATH || 'codex';
assert.equal(execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim(), 'codex-cli 0.153.4');
const root = mkdtempSync(join(tmpdir(), 'molly-t18-native-'));
const log = join(root, 'hooks.ndjson');
writeFileSync(join(root, 'fixture.txt'), 'complete native read\n');
writeFileSync(
  join(root, 'hook.mjs'),
  `import{appendFileSync}from'node:fs';let s='';for await(const b of process.stdin)s+=b;appendFileSync(${JSON.stringify(log)},s+'\\n');`
);
const shellQuote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const hooks = {};
for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'])
  hooks[event] = [
    {
      hooks: [
        {
          type: 'command',
          command: `${shellQuote(process.execPath)} ${shellQuote(join(root, 'hook.mjs'))}`,
        },
      ],
    },
  ];
writeFileSync(join(root, 'hooks.json'), JSON.stringify({ hooks }));
let n = 0;
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const b of req) raw += b;
  const body = JSON.parse(raw);
  n++;
  assert.ok(n <= 6, 'unexpected additional model request');
  const call = (name, args, id) => ({
    type: 'function_call',
    name,
    arguments: JSON.stringify(args),
    call_id: id,
    id,
  });
  const items =
    n === 1
      ? [
          call(
            'exec_command',
            { cmd: 'cat fixture.txt', login: false, max_output_tokens: 100 },
            'read1'
          ),
          call(
            'exec_command',
            { cmd: 'printf modified > written.txt', login: false, max_output_tokens: 100 },
            'write1'
          ),
        ]
      : n === 2
        ? [
            {
              type: 'custom_tool_call',
              name: 'apply_patch',
              input: '*** Begin Patch\n*** Add File: patched.txt\n+patch native\n*** End Patch',
              call_id: 'patch1',
              id: 'patch1',
            },
          ]
        : n === 3
          ? [
              call(
                'exec_command',
                {
                  cmd: 'python3 -c \'import sys; open("interactive.txt","w").write(sys.stdin.readline())\'',
                  tty: true,
                  login: false,
                  yield_time_ms: 1000,
                  max_output_tokens: 100,
                },
                'interactive1'
              ),
            ]
          : n === 4
            ? [
                call(
                  'write_stdin',
                  {
                    session_id: Number(JSON.stringify(body).match(/session ID (\d+)/)?.[1]),
                    chars: 'native stdin\n',
                    yield_time_ms: 1000,
                    max_output_tokens: 100,
                  },
                  'stdin1'
                ),
              ]
            : n === 5
              ? [
                  call(
                    'exec_command',
                    { cmd: 'cat fixture.txt; exit 7', login: false, max_output_tokens: 100 },
                    'failed1'
                  ),
                ]
              : [
                  {
                    type: 'message',
                    role: 'assistant',
                    id: 'msg1',
                    content: [{ type: 'output_text', text: 'done' }],
                  },
                ];
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('response.created', { response: { id: `resp${n}` } });
  for (const [output_index, item] of items.entries()) {
    event('response.output_item.added', { output_index, item });
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', {
    response: {
      id: `resp${n}`,
      status: 'completed',
      output: items,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
writeFileSync(
  join(root, 'config.toml'),
  `model = "gpt-6-astra"\nmodel_provider="probe"\n[features]\nhooks=true\nplugins=false\nrecommended_plugins=false\n[model_providers.probe]\nname="probe"\nbase_url="http://127.0.0.1:${server.address().port}"\nwire_api="responses"\nrequires_openai_auth=false\n`
);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  SHELL: process.env.SHELL,
  CODEX_HOME: root,
};
for (const key of Object.keys(env))
  if (key.startsWith('ANTHROPIC_') || key.startsWith('CLAUDE_CODE_USE_')) delete env[key];
const child = spawn(
  codex,
  [
    'exec',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    '--json',
    'probe',
  ],
  { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }
);
let out = '',
  err = '';
child.stdout.on('data', (x) => (out += x));
child.stderr.on('data', (x) => (err += x));
const timeout = setTimeout(() => child.kill(), 45000);
await new Promise((r) => child.on('exit', r));
clearTimeout(timeout);
server.close();
writeFileSync(join(root, 'runtime-stderr.log'), err);
assert.ok(out.includes('turn.completed'), `native turn did not complete; evidence: ${root}`);
const events = readFileSync(log, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const post = (id) =>
  events.find((e) => e.hook_event_name === 'PostToolUse' && e.tool_use_id === id);
assert.equal(post('read1')?.tool_response, 'complete native read\n');
assert.equal(post('failed1')?.tool_response, post('read1').tool_response);
assert.ok(out.split('\n').some((line) => line && JSON.parse(line).item?.exit_code === 7));
assert.equal(post('failed1').exit_code, undefined);
assert.ok(post('patch1')?.tool_response.includes('Success. Updated'));
assert.equal(readFileSync(join(root, 'written.txt'), 'utf8'), 'modified');
assert.equal(readFileSync(join(root, 'patched.txt'), 'utf8'), 'patch native\n');
assert.equal(readFileSync(join(root, 'interactive.txt'), 'utf8'), 'native stdin\n');
assert.ok(
  events.some((e) => e.hook_event_name === 'PreToolUse' && e.tool_use_id === 'interactive1')
);
assert.ok(post('interactive1'));
assert.ok(
  !events.some((e) => e.tool_use_id === 'stdin1'),
  'write_stdin unexpectedly acquired its own hook'
);
assert.equal(new Set(events.map((e) => e.turn_id)).size, 1);
console.log(
  JSON.stringify(
    {
      runtime: 'codex-cli 0.153.4',
      requests: n,
      evidenceDirectory: root,
      hookSequence: events.map((e) => ({
        event: e.hook_event_name,
        tool: e.tool_name,
        call: e.tool_use_id,
      })),
      verified: [
        'native complete Bash read',
        'native apply_patch',
        'interactive stdin changes file without own prehook',
        'Bash exit 7 returns same hook text as successful read',
        'all requests share hook turn identity',
      ],
      boundary: 'CLI native hook audit only; no ACP/desktop/shared baseline acceptance',
    },
    null,
    2
  )
);
