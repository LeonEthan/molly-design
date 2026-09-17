/** Run with tsx: actual managed Grok/ACP, public plugin, synthetic loopback model. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
  prepareGrokDesignReminder,
  reloadGrokDesignReminder,
} from '../src/design/grok-reminder.ts';
import { DESIGN_READ_BEFORE_EDIT_REMINDER } from '../src/design/read-before-edit-reminder.ts';

const executable = (process.env.MOLLY_PROBE_GROK ?? process.env.LODY_PROBE_GROK);
assert.ok(executable, 'Set MOLLY_PROBE_GROK to the managed Grok executable');
assert.match(execFileSync(executable, ['--version'], { encoding: 'utf8' }), /^grok 1\.0\.13 /);
const bundle = path.resolve((process.env.MOLLY_PROBE_BUNDLE_DIR ?? process.env.LODY_PROBE_BUNDLE_DIR) || 'apps/cli/dist-dev');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'molly-grok-reminder-probe-')));
const home = path.join(root, 'grok');
const work = path.join(root, 'work');
await mkdir(home);
await mkdir(work);
await writeFile(path.join(work, 'existing.txt'), 'saved human content\n');
let plugin = await prepareGrokDesignReminder(path.join(bundle, 'grok-design-reminder.js'));
const records = [];
let round = 0;
let step = 0;
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (req.url.endsWith('/models')) {
    res.end(JSON.stringify({ object: 'list', data: [] }));
    return;
  }
  assert.equal(req.url, '/v1/chat/completions');
  const messages = JSON.stringify(body.messages);
  const auxiliary =
    body.tools?.[0]?.function?.name === 'session_title' ||
    JSON.stringify(body.messages?.at(-1)).includes('ultra-short dashboard line');
  let delta = { role: 'assistant', content: 'Synthetic probe complete.' };
  let finish = 'stop';
  if (!auxiliary) {
    records.push({
      round,
      step,
      copies: messages.split(DESIGN_READ_BEFORE_EDIT_REMINDER).length - 1,
      userHook: messages.includes('SYNTHETIC_USER_HOOK'),
      userPlugin: messages.includes('SYNTHETIC_USER_PLUGIN'),
      existing: messages.includes('agent adjusted content'),
    });
    await writeFile(path.join(root, `request-${records.length}.json`), JSON.stringify(body));
    const first = [
      ['read_file', { target_file: path.join(work, 'existing.txt') }],
      [
        'search_replace',
        {
          file_path: path.join(work, 'existing.txt'),
          old_string: 'saved human content',
          new_string: 'agent adjusted content',
        },
      ],
      [
        'write',
        { file_path: path.join(work, 'new.txt'), content: 'new file without prior read\n' },
      ],
    ];
    const next =
      round === 0
        ? first[step]
        : step === 0
          ? ['read_file', { target_file: path.join(work, 'existing.txt') }]
          : undefined;
    step++;
    if (next) {
      finish = 'tool_calls';
      delta = {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `round-${round}-tool-${step}`,
            type: 'function',
            function: { name: next[0], arguments: JSON.stringify(next[1]) },
          },
        ],
      };
    }
  }
  res.setHeader('content-type', 'text/event-stream');
  const chunk = (value, reason) =>
    `data: ${JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`;
  res.end(chunk(delta, null) + chunk({}, finish) + 'data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const env = {
  PATH: process.env.PATH,
  GROK_PATH: executable,
  GROK_HOME: home,
  GROK_DISABLE_AUTOUPDATER: '1',
  GROK_TELEMETRY_ENABLED: '0',
  GROK_TELEMETRY_TRACE_UPLOAD: '0',
  GROK_MEMORY: '0',
};
const base = `[cli]\nauto_update=false\n[models]\ndefault="probe"\n[model.probe]\nmodel="probe"\nbase_url="http://127.0.0.1:${provider.address().port}/v1"\napi_key="synthetic-only"\n[features]\ntelemetry=false\n[telemetry]\ntrace_upload=false\n[compat.claude]\nrules=false\nskills=false\nagents=false\nhooks=false\nmcps=false\n[compat.cursor]\nrules=false\nskills=false\nagents=false\nhooks=false\nmcps=false\n[memory]\nenabled=false\n[marketplace]\ndefault_skills_installs_purged=true\n`;
await writeFile(path.join(home, 'config.toml'), base);
const discovered = JSON.parse(
  execFileSync(executable, ['--cwd', work, 'inspect', '--json'], { env, encoding: 'utf8' })
);
const userPlugin = path.join(root, 'user-plugin');
await mkdir(path.join(userPlugin, 'hooks'), { recursive: true });
await writeFile(
  path.join(userPlugin, 'plugin.json'),
  JSON.stringify({ name: 'synthetic-user-plugin', version: '1.0.0' })
);
const config = `${base}\n[plugins]\ndisabled=${JSON.stringify(discovered.plugins.map((entry) => entry.name))}\npaths=${JSON.stringify([userPlugin])}\nenabled=["synthetic-user-plugin"]\n`;
await writeFile(path.join(home, 'config.toml'), config);
await mkdir(path.join(home, 'hooks'));
const userScript = path.join(root, 'user-hook.mjs');
await writeFile(
  userScript,
  `console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:'SYNTHETIC_USER_HOOK'}}));`
);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const userHooks = JSON.stringify({
  hooks: {
    PreToolUse: [
      { hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(userScript)}` }] },
    ],
  },
});
await writeFile(path.join(home, 'hooks', 'user.json'), userHooks);
const userPluginScript = path.join(root, 'user-plugin-hook.mjs');
await writeFile(
  userPluginScript,
  `console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:'SYNTHETIC_USER_PLUGIN'}}));`
);
const pluginHooks = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        hooks: [
          { type: 'command', command: `${quote(process.execPath)} ${quote(userPluginScript)}` },
        ],
      },
    ],
  },
});
await writeFile(path.join(userPlugin, 'hooks', 'hooks.json'), pluginHooks);

const launch = () => {
  const child = spawn(process.execPath, [path.join(bundle, 'grok-acp.js')], {
    cwd: work,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  const pending = new Map();
  let id = 0;
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'session/request_permission') {
      const option = message.params.options.find((entry) => entry.kind === 'allow_once');
      assert.ok(option);
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { outcome: { outcome: 'selected', optionId: option.optionId } },
      });
    } else if (!message.method) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      message.error
        ? waiter.reject(Error(JSON.stringify(message.error)))
        : waiter.resolve(message.result);
    }
  });
  child.on('exit', () => {
    for (const waiter of pending.values()) waiter.reject(Error(`ACP exited; evidence ${root}`));
  });
  return {
    call(method, params) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`${method} timeout; ${root}`)), 45000);
        pending.set(++id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      await exited;
      clearTimeout(timer);
      await writeFile(path.join(root, `runtime-${round}.log`), stderr);
    },
  };
};
let runtime = launch();
try {
  const initialized = await runtime.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await writeFile(path.join(root, 'initialize.json'), JSON.stringify(initialized, null, 2));
  assert.equal(Boolean(initialized.agentCapabilities?.sessionCapabilities?.fork), false);
  assert.equal(initialized.agentCapabilities?._meta?.lody?.forkAtTurn, undefined);
  const meta = { pluginDirs: [plugin.directory] };
  const session = await runtime.call('session/new', { cwd: work, mcpServers: [], _meta: meta });
  const before = await runtime.call('_x.ai/hooks/list', { sessionId: session.sessionId });
  const firstMissing = !before.result.hooks.some(
    (hook) => hook.sourceDir === path.join(plugin.directory, 'hooks')
  );
  await reloadGrokDesignReminder(
    (method, params) => runtime.call(`_${method}`, params),
    session.sessionId,
    plugin.directory
  );
  const pluginsBefore = await runtime.call('_x.ai/plugins/list', { sessionId: session.sessionId });
  assert.equal(
    pluginsBefore.result.plugins.find((entry) => entry.name === 'synthetic-user-plugin').trusted,
    false
  );
  const first = await runtime.call('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: 'Synthetic first design turn.' }],
  });
  assert.equal(first.stopReason, 'end_turn');
  assert.equal(await readFile(path.join(work, 'existing.txt'), 'utf8'), 'agent adjusted content\n');
  assert.equal(await readFile(path.join(work, 'new.txt'), 'utf8'), 'new file without prior read\n');
  await runtime.close();
  await plugin.cleanup();
  plugin = await prepareGrokDesignReminder(path.join(bundle, 'grok-design-reminder.js'));
  meta.pluginDirs = [plugin.directory];
  round = 1;
  step = 0;
  runtime = launch();
  await runtime.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await runtime.call('session/load', {
    sessionId: session.sessionId,
    cwd: work,
    mcpServers: [],
    _meta: meta,
  });
  await reloadGrokDesignReminder(
    (method, params) => runtime.call(`_${method}`, params),
    session.sessionId,
    plugin.directory
  );
  const pluginsAfter = await runtime.call('_x.ai/plugins/list', { sessionId: session.sessionId });
  assert.equal(
    pluginsAfter.result.plugins.find((entry) => entry.name === 'synthetic-user-plugin').trusted,
    false
  );
  const continued = await runtime.call('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: 'Synthetic continued design turn.' }],
  });
  assert.equal(continued.stopReason, 'end_turn');
  const initial = records.filter((record) => record.round === 0);
  const resumed = records.filter((record) => record.round === 1);
  assert.equal(initial[0].copies, 0, 'PreToolUse cannot remind before the first tool');
  assert.ok(
    records.every((record) => !record.userPlugin),
    'reload must not trust an unknown configured user plugin'
  );
  assert.ok(initial[1].copies > 0 && initial[1].userHook);
  assert.ok(resumed[1].copies > resumed[0].copies, 'continued tool must deliver fresh context');
  assert.ok(resumed[1].existing && resumed[1].userHook);
  assert.equal(await readFile(path.join(home, 'config.toml'), 'utf8'), config);
  assert.equal(await readFile(path.join(home, 'hooks', 'user.json'), 'utf8'), userHooks);
  console.log(
    JSON.stringify({
      runtime: '1.0.13',
      root,
      firstMissing,
      records,
      nativeReadsAndEdits: true,
      configPreserved: true,
      unknownPluginRemainedUntrusted: true,
    })
  );
} finally {
  await runtime.close();
  await plugin.cleanup();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
}
