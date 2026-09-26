import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureMollyDataDir,
  MollyDataDirUnavailableError,
  getInstallationProfile,
  getMollyDataDir,
} from '../src/node/installation-profile';
import { getE2eHostPipe, getLocalCliHostEndpoint } from '../src/node/local-cli-host-lease';
import {
  getLocalControlSocketPath,
  getLocalDaemonRunDir,
  getLocalLoroDataPlaneSocketPath,
} from '../src/node/local-ipc';
import { getLocalWorkspaceCatalogPath } from '../src/node/local-workspace-catalog';

const require = createRequire(import.meta.url);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('installation profile', () => {
  it('keeps cloud defaults backward compatible and gives local a disjoint namespace', () => {
    expect(getInstallationProfile('cloud')).toMatchObject({
      namespace: 'lody',
      dataDirectoryName: '.lody',
      desktopProtocol: 'lody',
      localCliHostPort: 17_788,
    });
    expect(getInstallationProfile('local')).toMatchObject({
      namespace: 'molly',
      dataDirectoryName: '.molly',
      desktopProtocol: 'molly-design',
      localCliHostPort: 17_790,
    });
    expect(getMollyDataDir('cloud', '/home/alice')).toBe(path.join('/home/alice', '.lody'));
    expect(getMollyDataDir('local', '/home/alice')).toBe(path.join('/home/alice', '.molly'));
  });

  it('creates the data directory a session workspace hangs off', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lody-data-dir-'));
    try {
      const dataDir = path.join(root, 'nested', '.lody');
      vi.stubEnv('MOLLY_DATA_DIR', dataDir);

      expect(ensureMollyDataDir()).toBe(dataDir);
      expect(fs.statSync(dataDir).isDirectory()).toBe(true);
      // Idempotent: the daemon calls this on every worktree and chat session.
      expect(ensureMollyDataDir()).toBe(dataDir);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('names its own directory when that directory cannot be created', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lody-data-dir-'));
    try {
      // A regular file where the data root belongs: `mkdir` fails with ENOTDIR, which
      // is what an unusable data root looks like to every caller downstream.
      const blocker = path.join(root, 'blocker');
      fs.writeFileSync(blocker, '');
      const dataDir = path.join(blocker, '.lody');
      vi.stubEnv('MOLLY_DATA_DIR', dataDir);

      let caught: unknown;
      try {
        ensureMollyDataDir();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MollyDataDirUnavailableError);
      const error = caught as MollyDataDirUnavailableError;
      expect(error.dataDir).toBe(dataDir);
      expect(error.code).toBe('molly_data_dir_unavailable');
      // The raw cause stays reachable; the message is the part a user can act on.
      expect(error.message).toContain(dataDir);
      expect(error.message).toContain('MOLLY_DATA_DIR');
      expect(error.cause).toBeDefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses disjoint local host lease endpoints', () => {
    const cloud = getLocalCliHostEndpoint('cloud');
    const local = getLocalCliHostEndpoint('local');
    expect(local).not.toEqual(cloud);
    if (process.platform === 'win32') {
      expect(cloud).toMatchObject({ kind: 'pipe' });
      expect(local).toMatchObject({ kind: 'pipe' });
    } else {
      expect(cloud).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 17_788 });
      expect(local).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 17_790 });
    }
  });

  it.runIf(process.platform !== 'win32')(
    'uses an isolated host port only for an explicit E2E process',
    () => {
      vi.stubEnv('MOLLY_E2E', '1');
      vi.stubEnv('MOLLY_E2E_LOCAL_CLI_HOST_PORT', '29471');

      expect(getLocalCliHostEndpoint('local')).toEqual({
        kind: 'tcp',
        host: '127.0.0.1',
        port: 29_471,
      });

      vi.stubEnv('MOLLY_E2E', '0');
      expect(getLocalCliHostEndpoint('local')).toEqual({
        kind: 'tcp',
        host: '127.0.0.1',
        port: 17_790,
      });
    }
  );

  it.runIf(process.platform !== 'win32')('rejects an invalid E2E host port', () => {
    vi.stubEnv('MOLLY_E2E', '1');
    vi.stubEnv('MOLLY_E2E_LOCAL_CLI_HOST_PORT', '17790junk');

    expect(() => getLocalCliHostEndpoint('local')).toThrow(
      'MOLLY_E2E_LOCAL_CLI_HOST_PORT must be an integer between 1024 and 65535'
    );
  });

  it('accepts only an explicit E2E-scoped Windows pipe', () => {
    vi.stubEnv('MOLLY_E2E', '1');
    vi.stubEnv('MOLLY_E2E_LOCAL_CLI_HOST_PIPE', '\\\\.\\pipe\\lody-e2e-round-123');
    expect(getE2eHostPipe('win32')).toBe('\\\\.\\pipe\\lody-e2e-round-123');
    expect(getE2eHostPipe('darwin')).toBeNull();

    vi.stubEnv('MOLLY_E2E_LOCAL_CLI_HOST_PIPE', '\\\\.\\pipe\\lody-agent-host-user');
    expect(() => getE2eHostPipe('win32')).toThrow(
      'MOLLY_E2E_LOCAL_CLI_HOST_PIPE must use the \\\\.\\pipe\\lody-e2e-<id> namespace'
    );
  });

  it('keeps Electron main-process paths isolated without ambient MOLLY_PLATFORM', () => {
    const previousPlatform = process.env.MOLLY_PLATFORM;
    const previousDataDir = process.env.MOLLY_DATA_DIR;
    delete process.env.MOLLY_PLATFORM;
    delete process.env.MOLLY_DATA_DIR;
    try {
      const cloudRunDir = getLocalDaemonRunDir('cloud');
      const localRunDir = getLocalDaemonRunDir('local');
      expect(localRunDir).not.toBe(cloudRunDir);
      expect(localRunDir).toContain('.molly');
      expect(getLocalWorkspaceCatalogPath('local')).toContain('.molly');
      expect(getLocalControlSocketPath('local')).toContain('molly-control');
      expect(getLocalLoroDataPlaneSocketPath('local')).toContain('molly-loro-data-plane');
    } finally {
      if (previousPlatform === undefined) delete process.env.MOLLY_PLATFORM;
      else process.env.MOLLY_PLATFORM = previousPlatform;
      if (previousDataDir === undefined) delete process.env.MOLLY_DATA_DIR;
      else process.env.MOLLY_DATA_DIR = previousDataDir;
    }
  });

  it('keeps the CommonJS installation profile in parity', () => {
    const commonJs =
      require('../src/node/installation-profile.cjs') as typeof import('../src/node/installation-profile');
    expect(commonJs.getInstallationProfile('local')).toEqual(getInstallationProfile('local'));
    expect(commonJs.getMollyDataDir('local', '/home/alice')).toBe(
      getMollyDataDir('local', '/home/alice')
    );
  });

  it('keeps the CommonJS E2E pipe parser in parity', () => {
    vi.stubEnv('MOLLY_E2E', '1');
    vi.stubEnv('MOLLY_E2E_LOCAL_CLI_HOST_PIPE', '\\\\.\\pipe\\lody-e2e-parity');
    const commonJs = require('../src/node/local-cli-host-lease.cjs') as {
      getE2eHostPipe(nodePlatform?: NodeJS.Platform): string | null;
    };
    expect(commonJs.getE2eHostPipe('win32')).toBe(getE2eHostPipe('win32'));
  });
});

it('reads legacy environment overrides, gives new names priority and rejects an invalid new platform', () => {
  vi.stubEnv('MOLLY_DATA_DIR', undefined);
  vi.stubEnv('LODY_DATA_DIR', '/legacy-molly-data');
  expect(getMollyDataDir('local')).toBe(path.resolve('/legacy-molly-data'));
  vi.stubEnv('MOLLY_DATA_DIR', '/current-molly-data');
  expect(getMollyDataDir('local')).toBe(path.resolve('/current-molly-data'));
  vi.stubEnv('LODY_PLATFORM', 'local');
  vi.stubEnv('MOLLY_PLATFORM', 'invalid');
  expect(() => getInstallationProfile()).toThrow('MOLLY_PLATFORM');
  const commonJs = require('../src/node/installation-profile.cjs');
  expect(() => commonJs.getInstallationProfile()).toThrow('MOLLY_PLATFORM');
  expect(commonJs.getMollyDataDir('local')).toBe(getMollyDataDir('local'));
});
