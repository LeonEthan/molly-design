import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { DESIGN_PREVIEW_DIRNAME } from '@/design/render-preview';
import { getLogger } from '@/utils/logger';
import { PersonalMemoryService } from '@/agent/personal-memory';
import { callMollyCoreIpc, isMollyCorePreConnectError } from './molly-core-ipc';
import { buildMollyImageMcpServer } from './molly-image-mcp-server';
import { viewImage } from './view-image';
import {
  MollyCoreSupervisor,
  getMollyCoreConfiguredEndpoint,
  getMollyCoreEndpoint,
  onMollyCorePermanentFailure,
  resolveMollyCoreBinaryPath,
  startMollyCoreSupervisor,
  stopMollyCoreSupervisor,
  waitForMollyCoreEndpoint,
} from './molly-core-supervisor';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 25
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      timer.unref();
    });
  }
  throw new Error('Timed out waiting for supervisor condition');
}

describe('resolveMollyCoreBinaryPath', () => {
  it('prefers explicit MOLLY_CORE_BIN when present on disk', () => {
    const resolved = resolveMollyCoreBinaryPath({
      env: { MOLLY_CORE_BIN: '/opt/molly/molly-core' },
      cliEntrypoint: '/app/resources/cli/index.mjs',
      platform: 'darwin',
      exists: (candidate) => candidate === '/opt/molly/molly-core',
    });
    expect(resolved).toBe('/opt/molly/molly-core');
  });

  it('resolves sibling resources/molly-core binary for POSIX and Windows', () => {
    const posixPath = path.resolve('/app/resources/cli', '..', 'molly-core', 'molly-core');
    expect(
      resolveMollyCoreBinaryPath({
        env: {},
        cliEntrypoint: '/app/resources/cli/index.mjs',
        platform: 'darwin',
        exists: (candidate) => candidate === posixPath,
      })
    ).toBe(posixPath);

    const winPath = path.resolve('/app/resources/cli', '..', 'molly-core', 'molly-core.exe');
    expect(
      resolveMollyCoreBinaryPath({
        env: {},
        cliEntrypoint: '/app/resources/cli/index.mjs',
        platform: 'win32',
        exists: (candidate) => candidate === winPath,
      })
    ).toBe(winPath);

    expect(
      resolveMollyCoreBinaryPath({
        env: {},
        cliEntrypoint: '/app/resources/cli/index.mjs',
        platform: 'darwin',
        exists: () => false,
      })
    ).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('MollyCoreSupervisor (M2.1a)', () => {
  let buildDir: string;
  let binaryPath: string;

  beforeAll(async () => {
    buildDir = await mkdtemp(path.join(os.tmpdir(), 'mc-sup-bin-'));
    binaryPath = path.join(buildDir, 'molly-core');
    execFileSync('go', ['build', '-o', binaryPath, './cmd/molly-core'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOFLAGS: '-mod=readonly',
        GOTOOLCHAIN: 'go1.27.3',
      },
      stdio: 'pipe',
    });
  }, 30_000);

  afterAll(async () => {
    await stopMollyCoreSupervisor();
    if (buildDir) {
      await rm(buildDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    await stopMollyCoreSupervisor();
  });

  it('supervises molly-core without polluting daemon process.env, serves PersonalMemoryService, and fails fast after stop', async () => {
    const prevSocket = process.env.MOLLY_CORE_IPC_SOCKET;
    const prevToken = process.env.MOLLY_CORE_IPC_TOKEN;
    delete process.env.MOLLY_CORE_IPC_SOCKET;
    delete process.env.MOLLY_CORE_IPC_TOKEN;

    const workDir = await mkdtemp(path.join(os.tmpdir(), 'mc-sup-mem-'));
    try {
      const logger = getLogger('molly-core-supervisor-test');
      await startMollyCoreSupervisor({ logger, binaryPath });
      const configured = getMollyCoreConfiguredEndpoint();
      expect(configured).not.toBeNull();

      const endpoint = await waitForMollyCoreEndpoint(10_000);
      expect(endpoint).toEqual(configured);
      expect(getMollyCoreEndpoint()).toEqual(configured);

      expect(process.env.MOLLY_CORE_IPC_SOCKET).toBeUndefined();
      expect(process.env.MOLLY_CORE_IPC_TOKEN).toBeUndefined();

      const socketDir = path.dirname(endpoint!.socketPath);
      const dirMode = (await stat(socketDir)).mode & 0o777;
      expect(dirMode).toBe(0o700);

      const dbPath = path.join(workDir, 'preferences.sqlite');
      const memory = await PersonalMemoryService.open(dbPath);
      const initial = await memory.read();
      await memory.capture(
        initial.revision,
        [{ text: 'Supervisor-managed Go SQLite entry.' }],
        new AbortController().signal
      );
      const saved = await memory.read();
      expect(saved.entries).toHaveLength(1);
      expect(saved.entries[0]?.text).toBe('Supervisor-managed Go SQLite entry.');

      await stopMollyCoreSupervisor();
      expect(getMollyCoreEndpoint()).toBeNull();
      expect(getMollyCoreConfiguredEndpoint()).toBeNull();
      expect(existsSync(socketDir)).toBe(false);

      await expect(memory.read()).rejects.toThrow();
    } finally {
      if (prevSocket !== undefined) process.env.MOLLY_CORE_IPC_SOCKET = prevSocket;
      if (prevToken !== undefined) process.env.MOLLY_CORE_IPC_TOKEN = prevToken;
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it('keeps fixed endpoint and auth token stable across child crash and automatic restart', async () => {
    const logger = getLogger('molly-core-restart-test');
    const supervisor = new MollyCoreSupervisor({ binaryPath, logger });
    const runPromise = supervisor.run();
    try {
      const firstEndpoint = await supervisor.waitForInitialReady(10_000);
      expect(firstEndpoint).not.toBeNull();
      const firstPid = supervisor.getChildPid();
      expect(firstPid).not.toBeNull();

      process.kill(firstPid!, 'SIGKILL');

      await waitForCondition(() => {
        const currentPid = supervisor.getChildPid();
        return (
          currentPid !== null && currentPid !== firstPid && supervisor.getReadyEndpoint() !== null
        );
      }, 10_000);

      const secondEndpoint = supervisor.getReadyEndpoint();
      expect(secondEndpoint).toEqual(firstEndpoint);

      const comp = await callMollyCoreIpc<{ name: string }>(
        secondEndpoint!.socketPath,
        'core.composition',
        {},
        undefined,
        { authToken: secondEndpoint!.authToken, requireMutualAuth: true }
      );
      expect(comp.name).toBe('molly-core');
    } finally {
      await supervisor.stop();
      await runPromise;
    }
  }, 20_000);

  it('handles permanent failure (exit 2) cleanly, notifies listeners, falls back to TS on pre-connect errors, and never replays post-connect image errors', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'mc-sup-perm-'));
    const fakeBin = path.join(workDir, 'fail-core.sh');
    await writeFile(fakeBin, '#!/bin/sh\nexit 2\n', 'utf8');
    await chmod(fakeBin, 0o755);

    const prevSocket = process.env.MOLLY_CORE_IPC_SOCKET;
    const prevToken = process.env.MOLLY_CORE_IPC_TOKEN;
    try {
      let permanentFired = false;
      const detach = onMollyCorePermanentFailure(() => {
        permanentFired = true;
      });
      const logger = getLogger('molly-core-perm-test');
      await startMollyCoreSupervisor({ logger, binaryPath: fakeBin });
      await waitForCondition(() => permanentFired && getMollyCoreConfiguredEndpoint() === null);
      detach();

      const dbPath = path.join(workDir, 'memory', 'preferences.sqlite');
      const mem = await PersonalMemoryService.open(dbPath);
      const snap = await mem.read();
      expect(snap.enabled).toBe(true);

      const sessionDir = path.join(workDir, 'session');
      const previewDir = path.join(workDir, 'render', DESIGN_PREVIEW_DIRNAME);
      await mkdir(sessionDir, { recursive: true });
      await mkdir(previewDir, { recursive: true });
      const png = await sharp({
        create: { width: 32, height: 32, channels: 3, background: '#336699' },
      })
        .png()
        .toBuffer();
      await writeFile(path.join(sessionDir, 'sample.png'), png);

      process.env.MOLLY_CORE_IPC_SOCKET = path.join(workDir, 'nonexistent.sock');
      process.env.MOLLY_CORE_IPC_TOKEN = 'unused-token';
      const fallbackView = await viewImage(
        { path: 'sample.png' },
        { workdir: sessionDir, previewDirectory: previewDir }
      );
      expect(fallbackView.content.some((block) => block.type === 'image')).toBe(true);

      await expect(
        callMollyCoreIpc(path.join(workDir, 'nonexistent.sock'), 'core.composition', {})
      ).rejects.toSatisfy((err: unknown) => isMollyCorePreConnectError(err));

      const hangSock = path.join(workDir, 'drop-after-connect.sock');
      const dropServer = net.createServer((conn) => {
        conn.once('data', () => {
          conn.destroy();
        });
      });
      await new Promise<void>((resolve) => dropServer.listen(hangSock, resolve));
      try {
        process.env.MOLLY_CORE_IPC_SOCKET = hangSock;
        process.env.MOLLY_CORE_IPC_TOKEN = 'test-token-1234567890';
        const imageServer = buildMollyImageMcpServer({
          designGate: {
            artworkWorkdir: sessionDir,
            workspaceRoot: sessionDir,
            imageAvailable: true,
            imageProtocol: 'openai-images',
            imageConnection: {
              v: 1,
              enabled: true,
              protocol: 'openai-images',
              baseUrl: 'http://127.0.0.1:1/v1',
              apiKey: 'sk-test-no-replay',
              model: 'gpt-image-1',
              updatedAt: 1,
            },
          },
        });
        const client = new Client({ name: 'no-replay-test', version: '1.0.0' });
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await imageServer.connect(st);
        await client.connect(ct);
        try {
          const res = CallToolResultSchema.parse(
            await client.callTool({ name: 'generate', arguments: { prompt: 'red square' } })
          );
          expect(res.isError).toBe(true);
        } finally {
          await client.close();
          await imageServer.close();
        }
      } finally {
        await new Promise<void>((resolve) => dropServer.close(() => resolve()));
      }
    } finally {
      if (prevSocket === undefined) delete process.env.MOLLY_CORE_IPC_SOCKET;
      else process.env.MOLLY_CORE_IPC_SOCKET = prevSocket;
      if (prevToken === undefined) delete process.env.MOLLY_CORE_IPC_TOKEN;
      else process.env.MOLLY_CORE_IPC_TOKEN = prevToken;
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it('does not hang supervisor or stop() when child exits via signal before handshake', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'mc-sup-sig-'));
    const sigBin = path.join(workDir, 'sigkill-self.sh');
    await writeFile(sigBin, '#!/bin/sh\nkill -9 $$\n', 'utf8');
    await chmod(sigBin, 0o755);

    const logger = getLogger('molly-core-sig-test');
    const supervisor = new MollyCoreSupervisor({ binaryPath: sigBin, logger });
    const runPromise = supervisor.run();
    try {
      const initial = await supervisor.waitForInitialReady(5_000);
      expect(initial).toBeNull();
      await supervisor.stop();
      await runPromise;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
