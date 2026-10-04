import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifact = join(root, 'e2e/artifacts/helper-cleanup');
mkdirSync(artifact, { recursive: true });
const owned = mkdtempSync(join(tmpdir(), 'molly-helper-acceptance-'));
const require = createRequire(join(root, 'apps/electron/package.json'));
const { build } = createRequire(join(root, 'apps/cli/package.json'))('esbuild');
const compiled = await build({
  entryPoints: [join(root, 'apps/electron/src/main/services/cli-service.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['*'],
});
const fixture = join(owned, 'server.mjs');
writeFileSync(
  fixture,
  `
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
const [role, port, mode] = process.argv.slice(2);
const socket = connect(Number(port), '127.0.0.1', () => socket.write(JSON.stringify({role, pid:process.pid}) + '\\n'));
if (role === 'server') {
  spawn(process.execPath, [process.argv[1], 'descendant', port, mode], {stdio:'ignore'});
  const input = createInterface({input:process.stdin});
  input.on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'synthetic-cleanup',version:'1'}}}) + '\\n');
    if (message.method === 'tools/list' && mode === 'reply') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'synthetic_tool',description:'Synthetic cleanup metadata',inputSchema:{type:'object'}}]}}) + '\\n');
  });
}
`
);

async function bounded(promise, label, ms = 30_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const cases = [];
try {
  for (const kind of ['cancelled', 'timed_out', 'limit_exceeded', 'exited']) {
    const peers = [];
    const ready = Promise.withResolvers();
    const controller = new AbortController();
    const commands = [];
    const children = [];
    const socketErrors = [];
    const server = createServer((socket) => {
      let buffer = '';
      const closed = new Promise((resolveClosed) => socket.once('close', resolveClosed));
      socket.on('error', (error) => {
        if (error.code !== 'ECONNRESET') {
          socketErrors.push(error);
          ready.reject(error);
        }
      });
      socket.on('data', (bytes) => {
        buffer += bytes.toString('utf8');
        if (!buffer.includes('\n')) return;
        const data = JSON.parse(buffer.split('\n')[0]);
        peers.push({ ...data, socket, closed });
        if (
          peers.some((peer) => peer.role === 'server') &&
          peers.some((peer) => peer.role === 'descendant')
        )
          ready.resolve();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const module = { exports: {} };
    const env = { ...process.env, MOLLY_PLATFORM: 'cloud', MOLLY_DATA_DIR: join(owned, kind) };
    const hostProcess = Object.create(process);
    Object.assign(hostProcess, { env, resourcesPath: owned });
    const originalSpawn = spawn;
    compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
      module,
      module.exports,
      (name) => {
        if (name === '../platform') return { mainPlatformKind: 'local' };
        if (name === './shell-env') return { getUserShellEnvCached: async () => ({}) };
        if (name === './system-proxy-env')
          return { applyProxyEnvFallback() {}, resolveSystemProxyEnv: async () => ({}) };
        if (name === 'electron') return { app: { isPackaged: false, getAppPath: () => root } };
        if (name === '@molly/shared/node/installation-profile')
          return { getMollyDataDir: () => env.MOLLY_DATA_DIR };
        if (name === '@molly/shared/node/local-ipc')
          return { getLocalDaemonRunFilePath: () => join(owned, 'daemon.json') };
        if (name === '@molly/shared/node/local-cli-host-lease')
          return { getLocalCliHostEndpoint: () => ({}) };
        if (name === 'node:child_process')
          return {
            spawn(command, args, options) {
              const child = originalSpawn(command, args, options);
              if (command === 'taskkill') commands.push({ args, finished: once(child, 'close') });
              else children.push({ child, finished: once(child, 'close') });
              return child;
            },
          };
        if (name.startsWith('@molly/') || name === 'effect') return {};
        return require(name);
      },
      hostProcess
    );
    const service = Object.create(module.exports.CliService.prototype);
    service.trackedCliChildren = new Set();
    const request = JSON.stringify({
      destination: {
        transport: 'stdio',
        command: process.execPath,
        args: [
          fixture,
          'server',
          String(port),
          kind === 'cancelled' || kind === 'timed_out' ? 'hold' : 'reply',
        ],
      },
    });
    let outcome;
    let error;
    try {
      const running = service.runPrivateHelper(['__internal', 'mcp-list-tools'], request, {
        timeoutMs: 15_000,
        maxOutputBytes: kind === 'limit_exceeded' ? 32 : 1_048_576,
        signal: controller.signal,
      });
      await bounded(ready.promise, 'MCP descendants did not announce readiness');
      if (kind === 'cancelled') controller.abort();
      outcome = await bounded(running, 'Private helper did not finish');
      assert.equal(outcome.kind, kind);
      await bounded(
        Promise.all(commands.map((command) => command.finished)),
        'taskkill did not finish'
      );
      await bounded(Promise.all(children.map((child) => child.finished)), 'Helper did not exit');
      await bounded(
        Promise.all(peers.map((peer) => peer.closed)),
        'MCP descendants survived helper cleanup',
        5_000
      );
      assert.deepEqual(socketErrors, []);
    } catch (cause) {
      error = String(cause);
    } finally {
      for (const peer of peers.filter((candidate) => !candidate.socket.destroyed)) {
        try {
          if (process.platform === 'win32')
            execFileSync('taskkill', ['/PID', String(peer.pid), '/T', '/F'], { stdio: 'ignore' });
          else process.kill(peer.pid, 'SIGKILL');
        } catch {}
        peer.socket.destroy();
      }
      for (const { child } of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      await new Promise((resolveClose) => server.close(resolveClose));
      cases.push({
        kind,
        outcome: outcome?.kind,
        peers: peers.map(({ role, pid }) => ({ role, pid })),
        taskkill: commands.map((command) => command.args),
        status: error ? 'failed' : 'passed',
        ...(error ? { error } : {}),
      });
      writeFileSync(
        join(artifact, 'result.json'),
        JSON.stringify({ platform: process.platform, node: process.version, cases }, null, 2)
      );
      console.log(JSON.stringify(cases.at(-1)));
    }
  }
} finally {
  rmSync(owned, { recursive: true, force: true });
}
assert.equal(
  cases.filter((result) => result.status === 'failed').length,
  0,
  'Private helper cleanup acceptance failed'
);
