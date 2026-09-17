/** Manual native ACP probe, with synthetic localhost model responses and isolated config. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { codexDesignReminderConfig } from '../src/design/codex-reminder';
import { DESIGN_READ_BEFORE_EDIT_REMINDER } from '../src/design/read-before-edit-reminder';
import manifest from '../src/agent/codex-runtime-manifest.json';

const bundle = path.resolve((process.env.MOLLY_PROBE_BUNDLE_DIR ?? process.env.LODY_PROBE_BUNDLE_DIR) || 'apps/cli/dist-dev');
const executable = (process.env.MOLLY_PROBE_CODEX ?? process.env.LODY_PROBE_CODEX);
if (!executable) throw Error('Set MOLLY_PROBE_CODEX to the managed Codex executable');
assert.equal(
  execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(),
  `codex-cli ${manifest.version}`
);
const root = await mkdtemp(path.join(tmpdir(), 'molly-codex-reminder-'));
const home = path.join(root, 'home');
await mkdir(home);
await writeFile(path.join(root, 'existing.txt'), 'saved human content\n');
const requests: {
  reminder: boolean;
  userHook: boolean;
  unknownHook: boolean;
  reminderCopies: number;
}[] = [];
let nativeInput = '';
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  nativeInput = JSON.stringify(body.input);
  requests.push({
    reminder: nativeInput.includes(DESIGN_READ_BEFORE_EDIT_REMINDER),
    reminderCopies: nativeInput.split(DESIGN_READ_BEFORE_EDIT_REMINDER).length - 1,
    userHook: nativeInput.includes('USER_HOOK_CONTEXT'),
    unknownHook: nativeInput.includes('UNTRUSTED_HOOK_CONTEXT'),
  });
  const call = (name: string, args: object, id: string) => ({
    type: 'function_call',
    name,
    arguments: JSON.stringify(args),
    call_id: id,
    id,
  });
  const patch = (text: string, id: string) => ({
    type: 'custom_tool_call',
    name: 'apply_patch',
    input: text,
    call_id: id,
    id,
  });
  const count = requests.length;
  const output =
    count === 1
      ? [
          call(
            'exec_command',
            { cmd: 'cat existing.txt', login: false, max_output_tokens: 100 },
            'read-existing'
          ),
          patch(
            '*** Begin Patch\n*** Add File: new.txt\n+new file without prior read\n*** End Patch',
            'create-new'
          ),
        ]
      : count === 2
        ? [
            patch(
              '*** Begin Patch\n*** Update File: existing.txt\n@@\n-saved human content\n+agent adjusted content\n*** End Patch',
              'edit-existing'
            ),
          ]
        : count === 4
          ? [
              call(
                'exec_command',
                { cmd: 'cat existing.txt', login: false, max_output_tokens: 100 },
                'resume-read'
              ),
            ]
          : [
              {
                type: 'message',
                role: 'assistant',
                id: `message-${count}`,
                content: [{ type: 'output_text', text: 'done' }],
              },
            ];
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type: string, value: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  event('response.created', { response: { id: `response-${count}` } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item });
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', {
    response: {
      id: `response-${count}`,
      status: 'completed',
      output,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
});
await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
const address = provider.address();
assert(address && typeof address === 'object');
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
const userScript = path.join(root, 'user-hook.cjs');
const unknownScript = path.join(root, 'unknown-hook.cjs');
await writeFile(
  userScript,
  `console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'USER_HOOK_CONTEXT'}}));`
);
await writeFile(
  unknownScript,
  `console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'UNTRUSTED_HOOK_CONTEXT'}}));`
);
const userConfig = codexDesignReminderConfig(
  `${node} ${quote(userScript)}`,
  JSON.stringify({
    model: 'gpt-6-astra',
    model_provider: 'probe',
    approval_policy: 'never',
    sandbox_mode: 'danger-full-access',
    features: { plugins: false, recommended_plugins: false },
    model_providers: {
      probe: {
        name: 'probe',
        base_url: `http://127.0.0.1:${address.port}`,
        wire_api: 'responses',
        requires_openai_auth: false,
      },
    },
  })
);
userConfig.hooks.UserPromptSubmit.push({
  hooks: [{ type: 'command', command: `${node} ${quote(unknownScript)}`, timeout: 5 }],
});
const config = codexDesignReminderConfig(
  `${node} ${quote(path.join(bundle, 'codex-design-reminder.js'))}`,
  JSON.stringify(userConfig)
);
const profile = `# Synthetic profile must remain unchanged\nmodel_provider="probe"\n[features]\nplugins=false\nrecommended_plugins=false\n[model_providers.probe]\nname="probe"\nbase_url="http://127.0.0.1:${address.port}"\nwire_api="responses"\nrequires_openai_auth=false\n`;
await writeFile(path.join(home, 'config.toml'), profile);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  MODEL_PROVIDER: 'probe',
  CODEX_HOME: home,
  CODEX_PATH: executable,
  CODEX_CONFIG: JSON.stringify(config),
};
const launch = () => {
  const child = spawn(process.execPath, [path.join(bundle, 'codex-acp.js')], {
    cwd: root,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let id = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'session/request_permission') {
      const option = message.params.options.find(
        (option: { kind: string }) => option.kind === 'allow_once'
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { outcome: { outcome: 'selected', optionId: option.optionId } },
        }) + '\n'
      );
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  child.on('exit', () => {
    for (const waiter of pending.values())
      waiter.reject(Error(`ACP exited; isolated evidence ${root}`));
  });
  const call = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(Error(`${method} timed out; ${root}`)), 45000);
      pending.set(requestId, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  return {
    call,
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      await exited;
      clearTimeout(timer);
      await writeFile(path.join(root, `runtime-${Date.now()}.log`), stderr);
    },
  };
};
let runtime = launch();
try {
  await runtime.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  const session = (await runtime.call('session/new', { cwd: root, mcpServers: [] })) as {
    sessionId: string;
  };
  const result = (await runtime.call('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: 'Continue the design using existing.txt as the current file.' }],
  })) as { stopReason: string };
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(await readFile(path.join(root, 'new.txt'), 'utf8'), 'new file without prior read\n');
  assert.equal(await readFile(path.join(root, 'existing.txt'), 'utf8'), 'agent adjusted content\n');
  await runtime.close();
  runtime = launch();
  await runtime.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  await runtime.call('session/load', { sessionId: session.sessionId, cwd: root, mcpServers: [] });
  const resumed = (await runtime.call('session/prompt', {
    sessionId: session.sessionId,
    prompt: [
      { type: 'text', text: 'Continue this existing design and read the current file again.' },
    ],
  })) as { stopReason: string };
  assert.equal(resumed.stopReason, 'end_turn');
  assert(requests.length >= 5);
  assert(
    requests[3].reminderCopies > requests[0].reminderCopies,
    'resume must deliver a fresh reminder, not merely recover old context'
  );
  assert(
    requests.every((request) => request.reminder && request.userHook && !request.unknownHook),
    JSON.stringify({ root, requests })
  );
  assert(nativeInput.includes('agent adjusted content'));
  assert.equal(await readFile(path.join(home, 'config.toml'), 'utf8'), profile);
  console.log(
    JSON.stringify(
      {
        runtime: manifest.version,
        root,
        requests,
        verified: [
          'hook context before initial model request',
          'new file without prior read',
          'existing file read and native patch',
          'new ACP process resumes with reminder',
          'existing trusted hook preserved',
          'unknown hook stays untrusted',
          'profile unchanged',
        ],
        limits:
          'Synthetic model responses; no semantic read enforcement, Electron or paid-model acceptance',
      },
      null,
      2
    )
  );
} finally {
  await runtime.close();
  provider.close();
}
