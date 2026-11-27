#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const keys = [
  'HOME',
  'MOLLY_DATA_DIR',
  'MOLLY_ELECTRON_USER_DATA_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'TMPDIR',
];
function inside(root, value) {
  const rel = path.relative(root.toLowerCase(), value.toLowerCase());
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function assertOutsideHome(root) {
  for (const home of [os.userInfo().homedir, os.homedir()]) {
    const realHome = fs.realpathSync(home);
    assert(
      root.toLowerCase() !== realHome.toLowerCase() &&
        !inside(root, realHome) &&
        !inside(realHome, root),
      'Root overlaps home'
    );
  }
}

function socketPaths(root) {
  return ['control', 'probe', 'loro-data-plane'].map((channel) =>
    path.join(root, 'MOLLY_DATA_DIR', 'run', `molly-${channel}.sock`)
  );
}

export function assertSocketPaths(root) {
  for (const socket of socketPaths(root)) {
    assert(Buffer.byteLength(socket) <= 103, 'local_ipc_socket_path_too_long:' + socket);
  }
}

export function benchRootPrefix(tmp) {
  const prefix = path.join(tmp, 'molly-bench-');
  if (process.platform === 'win32') return prefix;
  return socketPaths(prefix + 'XXXXXX').every((socket) => Buffer.byteLength(socket) <= 103)
    ? prefix
    : path.join(fs.realpathSync('/tmp'), 'molly-b-');
}

export function assertIsolation(root, env, userData) {
  root = fs.realpathSync(root);
  assertOutsideHome(root);
  for (const dir of [...keys.map((key) => env[key]), userData]) {
    assert(
      path.isAbsolute(dir) &&
        dir.startsWith(root + path.sep) &&
        fs.realpathSync(dir) === dir &&
        fs.statSync(dir).isDirectory(),
      'Path outside isolated root'
    );
  }
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      assert(
        !entry.isSymbolicLink() && !entry.name.toLowerCase().endsWith('.enc'),
        'Unexpected link or .enc file'
      );
      if (entry.isDirectory()) scan(path.join(dir, entry.name));
    }
  }
  scan(root);
}

export function treeRss(snapshot, pid) {
  const rows = snapshot
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/u).map(Number));
  assert(
    rows.some((row) => row[0] === pid),
    'Main process exited'
  );
  function sum(id) {
    const [, , rss] = rows.find((row) => row[0] === id);
    return (
      rss * 1024 +
      rows.filter((row) => row[1] === id).reduce((total, row) => total + sum(row[0]), 0)
    );
  }
  return sum(pid);
}

const run = (cmd, args, env) => execFileSync(cmd, args, { env, encoding: 'utf8' }).trim();
const windowProbe = `ObjC.import('CoreGraphics');
ObjC.bindFunction('CGWindowListCopyWindowInfo',['id',['uint32','uint32']]);
function run(argv) {
  return ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(17,0)).some(w =>
    w.kCGWindowOwnerPID === Number(argv[0]) && w.kCGWindowLayer === 0 && w.kCGWindowAlpha > 0)
}`;

async function measure(name, app, root, env, userData) {
  assertIsolation(root, env, userData);
  app = fs.realpathSync(app);
  const exe = run(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')],
    env
  );
  assert.equal(exe, path.basename(exe));
  if (name === 'electron') {
    const info = path.join(
      app,
      'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist'
    );
    assert.match(
      run('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', info], env),
      /^44\./u,
      'Expected Electron 44'
    );
  }
  const sizeKiB = Number(run('/usr/bin/du', ['-sk', app], env).split(/\s+/u)[0]);
  const profile = `(version 1)(allow default)
    (deny file-write*)(allow file-write* (subpath (param "ROOT")) (literal "/dev/null"))
    (deny file-read* (subpath (param "REAL_HOME")))
    (allow file-read* (subpath (param "APP")))
    (deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.secd")
      (global-name "com.apple.security.agent") (global-name "com.apple.trustd.agent"))
    (deny file-read* (subpath "/Library/Keychains"))`;
  const args =
    name === 'mygo'
      ? ['--data-dir', env.MOLLY_DATA_DIR]
      : ['--user-data-dir=' + userData, '--use-mock-keychain', '--password-store=basic'];
  const started = performance.now();
  const child = spawn(
    '/usr/bin/sandbox-exec',
    [
      '-D',
      'ROOT=' + root,
      '-D',
      'REAL_HOME=' + fs.realpathSync(os.userInfo().homedir),
      '-D',
      'APP=' + app,
      '-p',
      profile,
      path.join(app, 'Contents/MacOS', exe),
      ...args,
    ],
    { env, cwd: env.HOME, detached: true, stdio: ['ignore', 'ignore', 'inherit'] }
  );
  await new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));
  try {
    while (
      run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', windowProbe, String(child.pid)], env) !==
      'true'
    ) {
      if (child.exitCode !== null || child.signalCode || performance.now() - started > 60000)
        throw new Error(name + ' window did not appear');
      await delay(100);
    }
    const firstWindowMs = performance.now() - started;
    await delay(10000);
    const rssBytes = treeRss(run('/bin/ps', ['-axo', 'pid=,ppid=,rss='], env), child.pid);
    return { name, firstWindowMs, rssBytes, appAllocatedKiB: sizeKiB };
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      mygo: { type: 'string' },
      electron: { type: 'string' },
      'dry-run': { type: 'boolean' },
      format: { type: 'string', default: 'json' },
    },
  });
  assert(['json', 'markdown'].includes(values.format));
  if (!values['dry-run'])
    assert(
      process.platform === 'darwin' && (values.mygo || values.electron),
      'Supply a --mygo or --electron .app path on macOS'
    );
  const tmp = fs.realpathSync(os.tmpdir());
  const results = [];
  for (const name of ['mygo', 'electron'].filter((key) => values['dry-run'] || values[key])) {
    const prefix = benchRootPrefix(tmp);
    assertOutsideHome(path.dirname(prefix));
    const root = fs.mkdtempSync(prefix);
    try {
      if (process.platform !== 'win32') assertSocketPaths(root);
      const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
      for (const key of keys) {
        env[key] = path.join(root, key);
        fs.mkdirSync(env[key]);
      }
      env.CFFIXED_USER_HOME = env.HOME;
      const userData = env.MOLLY_ELECTRON_USER_DATA_DIR;
      assertIsolation(root, env, userData);
      if (values['dry-run']) results.push({ name, isolationVerified: true });
      else {
        const sample = await measure(name, values[name], root, env, userData);
        assertIsolation(root, env, userData);
        results.push(sample);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  if (values.format === 'json') console.log(JSON.stringify(results, null, 2));
  else {
    const fields = Object.keys(results[0]);
    console.log(
      [fields, fields.map(() => '---'), ...results.map(Object.values)]
        .map((row) => '| ' + row.join(' | ') + ' |')
        .join('\n')
    );
  }
}
