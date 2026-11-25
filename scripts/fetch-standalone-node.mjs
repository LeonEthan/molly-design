#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { describeUnsupportedNodeRuntime } from './check-node-runtime.mjs';

const version = 'v22.23.5';
const hashes = {
  'darwin-arm64': 'e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d',
  'darwin-x64': 'c53383238206b9ae4db23c5d8a63645e2e753bec8ab51a49cc81939aa64e9422',
  'linux-x64': 'c54118104acc524633b5abe106bbf44a53126ec8b4e5fa105cb92b5d7de8a1a1',
  'win-x64': '4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3',
};
const cache = fileURLToPath(new URL('../.cache/standalone-node/', import.meta.url));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

export function verifyNodeRuntimeVersion(binary) {
  const nodeVersion = run(binary, ['-v']);
  const nodeApiVersion = run(binary, ['-p', 'process.versions.napi']);
  const problem = describeUnsupportedNodeRuntime({ nodeVersion, nodeApiVersion });
  if (problem) throw new Error(problem);
  return nodeVersion.slice(1);
}

export function inspectDarwinExternalDylibs(binaryPath) {
  if (process.platform !== 'darwin') return [];
  const output = run('/usr/bin/otool', ['-L', binaryPath]);
  const external = [];
  for (const line of output.split('\n').slice(1)) {
    const trimmed = line.trim().split(' ')[0];
    if (!trimmed) continue;
    if (!trimmed.startsWith('/usr/lib/') && !trimmed.startsWith('/System/Library/')) {
      external.push(trimmed);
    }
  }
  return external;
}

export function verifyDarwinBinaryArch(binaryPath, targetArch) {
  if (process.platform !== 'darwin') return;
  const expected = targetArch === 'arm64' ? 'arm64' : 'x86_64';
  const archs = run('/usr/bin/lipo', ['-archs', binaryPath]).split(/\s+/u).filter(Boolean);
  if (!archs.includes(expected)) {
    throw new Error(
      `Binary ${binaryPath} architectures [${archs.join(', ')}] do not include target ${expected}`
    );
  }
}

function target(platform, arch) {
  const key = `${platform === 'win32' ? 'win' : platform}-${arch}`;
  if (!Object.hasOwn(hashes, key)) throw new Error(`Unsupported runtime: ${key}`);
  const stem = `node-${version}-${key}`;
  const windows = key.startsWith('win-');
  return {
    dir: path.join(cache, `${version}-${key}`),
    archive: stem + (windows ? '.zip' : '.tar.gz'),
    member: stem + (windows ? '/node.exe' : '/bin/node'),
    binary: windows ? 'node.exe' : 'node',
    hash: hashes[key],
  };
}

function archiveBinary(dir, spec) {
  const archive = path.join(dir, spec.archive);
  const input = fs.readFileSync(archive);
  if (createHash('sha256').update(input).digest('hex') !== spec.hash)
    throw new Error('Node archive SHA-256 mismatch');
  const list = (args) =>
    execFileSync('tar', args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const entries = list(['-tf', '-']).trimEnd().split(/\r?\n/u);
  if (
    entries.some(
      (name) =>
        path.win32.isAbsolute(name) || /^[a-z]:/iu.test(name) || name.split(/[\\/]/u).includes('..')
    )
  )
    throw new Error('Unsafe archive path');
  if (
    entries.filter((name) => name === spec.member).length !== 1 ||
    !list(['-tvf', '-', spec.member]).startsWith('-')
  )
    throw new Error('Expected one regular Node executable');
  return execFileSync('tar', ['-xOf', '-', spec.member], { input, maxBuffer: 256 * 1024 * 1024 });
}

function verify(dir, spec, arch) {
  const bin = path.join(dir, spec.binary);
  if (!fs.lstatSync(bin).isFile() || !fs.readFileSync(bin).equals(archiveBinary(dir, spec)))
    throw new Error('Cached Node differs from pinned release');
  verifyDarwinBinaryArch(bin, arch);
  if (inspectDarwinExternalDylibs(bin).length || 'v' + verifyNodeRuntimeVersion(bin) !== version)
    throw new Error('Unexpected Node dependencies or version');
  return bin;
}

export function verifyStandaloneCache(platform = process.platform, arch = process.arch) {
  const spec = target(platform, arch);
  return verify(spec.dir, spec, arch);
}

async function fetchRuntime(verifyOnly) {
  const spec = target(process.platform, process.arch);
  if (verifyOnly || fs.existsSync(spec.dir)) return verifyStandaloneCache();
  fs.mkdirSync(cache, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(cache, '.download-'));
  try {
    const response = await fetch(`https://nodejs.org/dist/${version}/${spec.archive}`);
    if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
    fs.writeFileSync(path.join(tmp, spec.archive), Buffer.from(await response.arrayBuffer()));
    fs.writeFileSync(path.join(tmp, spec.binary), archiveBinary(tmp, spec), {
      mode: 0o755,
      flag: 'wx',
    });
    verify(tmp, spec, process.arch);
    try {
      fs.renameSync(tmp, spec.dir);
    } catch (error) {
      if (!fs.existsSync(spec.dir)) throw error;
      return verifyStandaloneCache();
    }
    return path.join(spec.dir, spec.binary);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { 'verify-only': { type: 'boolean' }, 'print-path': { type: 'boolean' } },
  });
  const binary = await fetchRuntime(values['verify-only']);
  console.log(values['print-path'] ? binary : JSON.stringify({ version, binary }));
}
