// Exercise the CLI's real PTY lifecycle in both supported Windows Node hosts.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.platform !== 'win32') process.exit(0);
const electronRequire = createRequire(new URL('../../apps/electron/package.json', import.meta.url));
const suiteRequire = createRequire(new URL('../package.json', import.meta.url));
if (process.argv.includes('--child')) {
  const { makeTerminalPtyService } = await import('../../apps/cli/src/lib/terminal-pty-service.ts');
  const logger = {
    info() {}, warn() {}, error() {}, success() {}, debug() {},
    setLevel() {}, setDebug() {}, child: () => logger, close: async () => {},
  };
  const service = makeTerminalPtyService({ logger, resolveSessionWorkdir: async () => process.cwd() });
  let sent = false;
  let closing = false;
  let output = '';
  service.onEvent((event) => {
    if (event.type === 'data') {
      output += event.data;
      if (!sent) {
        sent = true;
        service.input(event.terminalId, 'cmd.exe /d /c echo molly-pty-probe-rea^dy\r');
      }
      if (!closing && output.includes('molly-pty-probe-ready')) {
        closing = true;
        process.send({ phase: 'close-session', hostPid: process.pid });
        service.closeSession('native-probe');
        service.closeSession('native-probe');
        service.closeAll();
      }
    }
    if (event.type === 'exit') {
      assert.ok(closing, 'Terminal exited before the lifecycle cleanup');
      assert.deepEqual(service.list('native-probe'), []);
      process.send({ phase: 'terminal-exit', event });
      process.disconnect();
    }
  });
  await service.open({ sessionId: 'native-probe', cols: 80, rows: 24 });
} else {
  for (const [name, executable] of [['node', process.execPath], ['electron', electronRequire('electron')]]) {
    const events = [];
    const child = fork(fileURLToPath(import.meta.url), ['--child'], {
      execPath: executable,
      execArgv: ['--import', pathToFileURL(suiteRequire.resolve('tsx')).href],
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: '1',
        TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../apps/cli/tsconfig.json', import.meta.url)),
        // Pin PowerShell so the output expression has one shell interpretation.
        ComSpec: 'powershell.exe',
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.on('message', (event) => { events.push(event); console.log(JSON.stringify({ name, ...event })); });
    const timeout = setTimeout(() => child.kill(), 20_000);
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timeout);
    console.log(JSON.stringify({ name, ...result }));
    assert.equal(result.code, 0);
    assert.ok(events.some((event) => event.phase === 'terminal-exit'));
  }
}
