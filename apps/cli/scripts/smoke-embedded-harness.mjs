import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { verifyEmbeddedHarness } from './verify-embedded-harness.mjs';

const SECRET = 'SYNTHETIC_PACKAGE_SMOKE_KEY';

/** Loopback Chat Completions peer for one synthetic turn; never a model vendor. */
async function syntheticModel() {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finish) =>
        `data: ${JSON.stringify({
          id: 'synthetic',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'synthetic/custom',
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      response.end(
        chunk({ role: 'assistant', content: 'Synthetic packaged answer.' }, null) +
          chunk({}, 'stop') +
          'data: [DONE]\n\n'
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Offline package smoke: verifies the sealed manifest, starts the bundled worker in an owned
 * temporary root, checks every Pi package loads natively and runs one synthetic turn.
 */
export async function runPackagedSmoke({ output, executable }) {
  const manifest = verifyEmbeddedHarness(path.join(output, 'harness'));
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'molly-harness-smoke-')));
  const model = await syntheticModel();
  let child;
  try {
    const cwd = path.join(root, 'workspace');
    await mkdir(cwd, { recursive: true });
    child = spawn(executable, [path.join(output, 'molly-pi-agent.js')], {
      cwd,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: root,
        LANG: 'en_US.UTF-8',
        ELECTRON_RUN_AS_NODE: '1',
        PI_CODING_AGENT_DIR: '/does-not-exist/pi',
        OPENAI_API_KEY: 'SYNTHETIC_POLLUTION_CANARY',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    child.stdio[3].on('error', () => undefined);
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    await once(child, 'spawn');
    const config = {
      schemaVersion: 1,
      runtimeEpoch: randomUUID(),
      productSessionId: 'synthetic-package-smoke',
      workspaceId: 'synthetic-workspace',
      harness: {
        id: 'molly',
        engine: 'pi',
        engineVersion: manifest.engineVersion,
        buildId: manifest.buildId,
        protocolVersion: 1,
      },
      cwd,
      privateRoot: path.join(root, 'private'),
      shellPath: '/bin/sh',
      connection: {
        schemaVersion: 1,
        id: 'synthetic-connection',
        revision: 1,
        providerPresetId: 'openai-compatible',
        displayName: 'Synthetic',
        baseUrl: model.baseUrl,
        credentialRef: 'unavailable-synthetic-ref',
        enabled: true,
        customModels: [
          {
            modelId: 'synthetic/custom',
            name: 'Synthetic custom model',
            input: ['text'],
            contextWindow: 32768,
            maxTokens: 4096,
            thinking: ['off'],
            toolCalls: true,
            usageInStreaming: false,
            maxTokensField: 'max_tokens',
          },
        ],
      },
      selection: {
        connectionId: 'synthetic-connection',
        modelId: 'synthetic/custom',
        thinking: 'off',
      },
      systemPrompt: 'Synthetic offline package smoke',
      permissionProfileId: 'synthetic-profile',
    };
    const write = (value) =>
      new Promise((resolve, reject) =>
        child.stdio[3].write(`${JSON.stringify(value)}\n`, (error) =>
          error ? reject(error) : resolve()
        )
      );
    await write(config);
    const commands = [];
    const peer = new ClientSideConnection(
      () => ({
        requestPermission: async () => {
          throw new Error('smoke_must_not_request_permission');
        },
        sessionUpdate: async ({ update }) => {
          if (update.sessionUpdate === 'available_commands_update')
            commands.push(...update.availableCommands.map((command) => command.name));
        },
      }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
    );
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
    try {
      const initialized = await peer.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { elicitation: { form: {} }, _meta: { mollyQuestionUI: { version: 1 } } },
      });
      assert.equal(initialized.agentInfo.version, manifest.engineVersion);
      const session = await peer.newSession({ cwd, mcpServers: [] });
      const binding = session._meta.mollyRuntime;
      assert.equal(binding.runtimeEpoch, config.runtimeEpoch);
      for (const command of ['subagents', 'skillful', 'fff-health', 'cc-safety-net'])
        assert.ok(commands.includes(command), `Pi package command missing: ${command}`);
      const runId = 'synthetic-package-run';
      await write({ type: 'credential', runtimeEpoch: config.runtimeEpoch, runId, apiKey: SECRET });
      const response = await peer.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Synthetic packaged turn' }],
        _meta: {
          mollyRunSnapshot: {
            schemaVersion: 1,
            runId,
            runtimeEpoch: config.runtimeEpoch,
            sessionId: config.productSessionId,
            turnId: 'synthetic-turn',
            connection: config.connection,
            selection: config.selection,
            harness: config.harness,
            toolsetHash: binding.toolsetHash,
            pluginSetHash: binding.pluginSetHash,
            permissionProfileId: config.permissionProfileId,
          },
        },
      });
      assert.equal(response._meta.mollyNativeOutcome.status, 'completed');
      assert.equal(model.requests.length, 1);
      assert.equal(model.requests[0].authorization, `Bearer ${SECRET}`);
      const tools = model.requests[0].body.tools.map((tool) => tool.function.name);
      for (const tool of ['ask_user_question', 'ffgrep', 'fffind'])
        assert.ok(tools.includes(tool), `Pi package tool missing: ${tool}`);
      assert.ok(!JSON.stringify(model.requests).includes('SYNTHETIC_POLLUTION_CANARY'));
      const auth = JSON.parse(
        await readFile(
          path.join(
            config.privateRoot,
            'config',
            'workers',
            createHash('sha256').update(config.runtimeEpoch).digest('hex'),
            'auth.json'
          ),
          'utf8'
        )
      );
      assert.equal(auth['molly-compatible'].key, SECRET);
      await writeFile(path.join(root, 'smoke-ok'), '');
    } finally {
      clearTimeout(timeout);
      child.stdin.end();
      child.stdio[3].end();
    }
    const code = await new Promise((resolve) => {
      if (child.exitCode !== null) resolve(child.exitCode);
      else child.once('exit', resolve);
    });
    assert.equal(code, 0, `Worker exit ${code}: ${stderr}`);
    return { engineVersion: manifest.engineVersion, commands: commands.length, tools: true };
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    await model.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runPackagedSmoke({
    output: path.resolve(process.argv[2] ?? 'apps/cli/dist'),
    executable: path.resolve(process.argv[3] ?? process.execPath),
  });
  console.log(JSON.stringify(result));
}
