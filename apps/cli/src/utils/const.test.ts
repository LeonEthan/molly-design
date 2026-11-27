import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOrCreateStableMachineIdAsync,
  getSystemMachineId,
  getSystemMachineIdAsync,
} from './const';

const temporaryDataDirs: string[] = [];

function useTemporaryDataDir(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lody-machine-id-'));
  temporaryDataDirs.push(dataDir);
  vi.stubEnv('MOLLY_DATA_DIR', dataDir);
  return dataDir;
}

function writeCredentials(dataDir: string, machineId: string): void {
  const credentialsPath = path.join(dataDir, 'credentials.json');
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(
    credentialsPath,
    JSON.stringify({
      version: 3,
      token: 'token',
      user: { id: 'user-1', email: 'user@example.com' },
      machine: { machineName: 'Test Machine', machineId },
    })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dataDir of temporaryDataDirs.splice(0)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

describe('machine ID', () => {
  it('migrates the existing credential machine ID on first use', () => {
    const dataDir = useTemporaryDataDir();
    const credentialMachineId = 'legacy-machine-id';
    writeCredentials(dataDir, credentialMachineId);

    expect(getSystemMachineId()).toBe(credentialMachineId);
    expect(fs.readFileSync(path.join(dataDir, 'machine-id'), 'utf-8')).toBe(credentialMachineId);
  });

  it('repairs a generated machine ID that conflicts with valid cached auth', () => {
    const dataDir = useTemporaryDataDir();
    const machineIdPath = path.join(dataDir, 'machine-id');
    const credentialMachineId = 'legacy-machine-id';
    writeCredentials(dataDir, credentialMachineId);
    fs.writeFileSync(machineIdPath, '4fd0b184-b27e-4df2-b631-90abac018c87');

    expect(getSystemMachineId()).toBe(credentialMachineId);
    expect(fs.readFileSync(machineIdPath, 'utf-8')).toBe(credentialMachineId);
  });

  it('keeps the persisted machine ID aligned after cached auth changes', () => {
    const dataDir = useTemporaryDataDir();
    const machineIdPath = path.join(dataDir, 'machine-id');
    fs.mkdirSync(path.dirname(machineIdPath), { recursive: true });
    fs.writeFileSync(machineIdPath, 'previous-machine-id');
    writeCredentials(dataDir, 'current-auth-machine-id');

    expect(getSystemMachineId()).toBe('current-auth-machine-id');
    expect(fs.readFileSync(machineIdPath, 'utf-8')).toBe('current-auth-machine-id');
  });

  it('falls back to valid credentials when the machine ID file cannot be read', () => {
    const dataDir = useTemporaryDataDir();
    const machineIdPath = path.join(dataDir, 'machine-id');
    const credentialMachineId = 'legacy-machine-id';
    writeCredentials(dataDir, credentialMachineId);
    fs.mkdirSync(machineIdPath);

    expect(getSystemMachineId()).toBe(credentialMachineId);
  });

  it('keeps the persisted machine ID when a credential repair cannot be written', () => {
    const dataDir = useTemporaryDataDir();
    const machineIdPath = path.join(dataDir, 'machine-id');
    const persistedMachineId = 'persisted-machine-id';
    writeCredentials(dataDir, 'legacy-machine-id');
    fs.writeFileSync(machineIdPath, persistedMachineId);
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('write failed');
    });

    expect(getSystemMachineId()).toBe(persistedMachineId);
    expect(fs.readFileSync(machineIdPath, 'utf-8')).toBe(persistedMachineId);
  });

  it('uses the machine ID created by a concurrent first caller', () => {
    const dataDir = useTemporaryDataDir();
    const machineIdPath = path.join(dataDir, 'machine-id');
    const concurrentMachineId = 'concurrent-machine-id';
    vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => {
      fs.writeFileSync(machineIdPath, concurrentMachineId);
      throw Object.assign(Error('already exists'), { code: 'EEXIST' });
    });
    expect(getSystemMachineId()).toBe(concurrentMachineId);
    expect(fs.readFileSync(machineIdPath, 'utf-8')).toBe(concurrentMachineId);
  });

  it('generates and persists a UUID on first use', () => {
    const dataDir = useTemporaryDataDir();

    const machineId = getSystemMachineId();

    expect(machineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(fs.readFileSync(path.join(dataDir, 'machine-id'), 'utf-8')).toBe(machineId);
  });

  it('ignores invalid credentials even when they contain a machine ID', () => {
    const dataDir = useTemporaryDataDir();
    const credentialsPath = path.join(dataDir, 'credentials.json');
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({ machine: { machineName: 'Test Machine', machineId: 'copied-machine-id' } })
    );

    expect(getSystemMachineId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('reuses the persisted UUID across all machine ID entry points', async () => {
    useTemporaryDataDir();

    const first = getSystemMachineId();

    await expect(getSystemMachineIdAsync()).resolves.toBe(first);
    await expect(getOrCreateStableMachineIdAsync()).resolves.toBe(first);
  });
});

it.each(['legacy-prefix', 'legacy-complete'])(
  'recovers pending publication of %s under the init lock',
  (raw) => {
    const root = useTemporaryDataDir();
    const target = path.join(root, 'machine-id');
    fs.writeFileSync(target, raw);
    fs.writeFileSync(target + '.wx-pending', JSON.stringify({ expectedValue: 'legacy-complete' }));
    expect(getSystemMachineId()).toBe('legacy-complete');
    expect(fs.readFileSync(target, 'utf8')).toBe('legacy-complete');
    expect(fs.readdirSync(root)).toEqual(['machine-id']);
  }
);

it('rolls back an exclusive-create short write followed by ENOSPC', () => {
  const root = useTemporaryDataDir();
  const target = path.join(root, 'machine-id');
  vi.spyOn(fs, 'linkSync').mockImplementation(() => {
    throw Object.assign(Error(), { code: 'EXDEV' });
  });
  const open = fs.openSync.bind(fs);
  let targetFd: number | undefined;
  vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
    const fd = open(file, flags, mode);
    if (file === target && flags === 'wx') targetFd = fd;
    return fd;
  });
  const write = fs.writeSync.bind(fs);
  let shortened = false;
  vi.spyOn(fs, 'writeSync').mockImplementation(((
    fd: number,
    bytes: Buffer,
    offset: number,
    length: number
  ) => {
    if (fd !== targetFd) return write(fd, bytes, offset, length);
    if (shortened) throw Object.assign(Error(), { code: 'ENOSPC' });
    shortened = true;
    return write(fd, bytes, offset, 1);
  }) as typeof fs.writeSync);
  expect(getSystemMachineId()).toBeNull();
  expect(shortened).toBe(true);
  expect(fs.readdirSync(root)).toEqual([]);
});
