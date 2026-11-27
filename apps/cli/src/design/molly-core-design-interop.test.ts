import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { callMollyCoreIpc } from '@/mcp/molly-core-ipc';
import { DESIGN_BUSY, DESIGN_LOCK_FILENAME, DESIGN_LOCK_STALE_MS, withDesignLock } from './lock';
import { canonicalContentBytes, designOperation, type DesignPayload } from './store';
import { designHistoryOperation, type DesignVersion } from './history';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const IPC_TOKEN = 'm13-interop-mutual-auth-token-0123456789abcdef';

async function waitForSocket(socketPath: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection(socketPath);
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25).unref();
    });
  }
  throw new Error(`Timed out waiting for molly-core IPC socket at ${socketPath}`);
}

function runGoLockProbe(
  helperBin: string,
  payload: { action: string; directory: string; timeoutMs?: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      helperBin,
      ['-test.run=^TestDesignLockInteropHelper$'],
      {
        env: {
          ...process.env,
          MOLLY_DESIGN_INTEROP_HELPER: '1',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${stdout}\n${stderr}`));
        } else {
          resolve();
        }
      }
    );
    proc.stdin?.end(JSON.stringify(payload));
  });
}

describe.skipIf(process.platform === 'win32')(
  'M1.3 Go internal/design & internal/gitstore cross-process interop with Node',
  () => {
    let socketDir: string;
    let socketPath: string;
    let lockHelperBin: string;
    let child: ChildProcess;

    beforeAll(async () => {
      socketDir = await mkdtemp('/tmp/mc-m13-');
      const binaryPath = path.join(socketDir, 'molly-core');
      lockHelperBin = path.join(socketDir, 'design-interop.test');
      socketPath = path.join(socketDir, 'c.sock');
      const goEnv = {
        ...process.env,
        CGO_ENABLED: '0',
        GOFLAGS: '-mod=readonly',
        GOTOOLCHAIN: 'go1.27.3',
      };
      execFileSync('go', ['build', '-o', binaryPath, './cmd/molly-core'], {
        cwd: REPO_ROOT,
        env: goEnv,
        stdio: 'pipe',
      });
      execFileSync('go', ['test', '-c', '-o', lockHelperBin, './internal/design'], {
        cwd: REPO_ROOT,
        env: goEnv,
        stdio: 'pipe',
      });
      child = spawn(binaryPath, ['--serve-ipc', socketPath], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          MOLLY_CORE_IPC_TOKEN: IPC_TOKEN,
        },
        stdio: 'pipe',
      });
      await waitForSocket(socketPath);
    }, 30_000);

    afterAll(async () => {
      if (child && !child.killed) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 2_000).unref();
        });
      }
      if (socketDir) await rm(socketDir, { recursive: true, force: true });
    });

    let dataRoot: string;

    beforeEach(async () => {
      dataRoot = await mkdtemp(path.join(os.tmpdir(), 'molly-m13-interop-'));
    });

    afterEach(async () => {
      await rm(dataRoot, { recursive: true, force: true });
    });

    it('enforces mutual exclusion, DESIGN_BUSY timeout, and stale lock takeover across Node lock.ts and Go internal/design', async () => {
      const targetDir = dataRoot;

      let releaseNodeLock!: () => void;
      const nodeEntered = new Promise<void>((resolve) => {
        void withDesignLock(targetDir, {}, async (assertHeld) => {
          resolve();
          await new Promise<void>((r) => {
            releaseNodeLock = r;
          });
          await assertHeld();
        });
      });
      await nodeEntered;

      await expect(
        runGoLockProbe(lockHelperBin, {
          action: 'lock_probe',
          directory: targetDir,
          timeoutMs: 120,
        })
      ).rejects.toThrow(DESIGN_BUSY);

      releaseNodeLock();

      await runGoLockProbe(lockHelperBin, {
        action: 'lock_probe',
        directory: targetDir,
        timeoutMs: 2_000,
      });

      const lockPath = path.join(targetDir, DESIGN_LOCK_FILENAME);
      await writeFile(lockPath, JSON.stringify({ pid: 999999, token: 'abandoned-node-holder' }));
      const staleDate = new Date(Date.now() - DESIGN_LOCK_STALE_MS - 5_000);
      await utimes(lockPath, staleDate, staleDate);

      await runGoLockProbe(lockHelperBin, {
        action: 'lock_probe',
        directory: targetDir,
        timeoutMs: 1_000,
      });

      await writeFile(lockPath, JSON.stringify({ pid: 888888, token: 'abandoned-go-holder' }));
      await utimes(lockPath, staleDate, staleDate);
      const stolenByNode = await withDesignLock(targetDir, {}, async (assertHeld) => {
        await assertHeld();
        return 'node-stole-it';
      });
      expect(stolenByNode).toBe('node-stole-it');
    });

    it('withholds unvalidated design/gitstore write RPCs and matches Node read, canonical digest (including &<>), and history readback 100%', async () => {
      const ipcOpts = { authToken: IPC_TOKEN, requireMutualAuth: true };

      for (const removedMethod of [
        'design.create',
        'design.save',
        'design.lock_probe',
        'gitstore.create',
        'gitstore.restore',
      ]) {
        await expect(
          callMollyCoreIpc(socketPath, removedMethod, {}, undefined, ipcOpts)
        ).rejects.toThrow('unknown method');
      }

      const sampleArtwork = JSON.parse(
        await readFile(
          new URL('../../../../packages/design-bento/sample.json', import.meta.url),
          'utf8'
        )
      ) as { doc: Record<string, unknown>; assets: Record<string, string> };

      const pngA = await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 4,
          background: { r: 240, g: 60, b: 20, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const hashA = createHash('sha256').update(pngA).digest('hex');
      const uriA = `data:image/png;base64,${pngA.toString('base64')}`;

      const sessionId = randomUUID();
      const association = {
        sessionId,
        name: 'Golden Differential & <Poster>',
        userId: 'user-golden',
        machineId: 'machine-golden',
        createdAt: '2026-11-23T12:00:00.000Z',
      };

      const sampleElements = Array.isArray(sampleArtwork.doc.elements)
        ? sampleArtwork.doc.elements
        : [];
      const corpus = [
        {
          label: 'blank-1080x1350',
          doc: {
            schemaVersion: 4,
            canvas: { width: 1080, height: 1350 },
            diagnostics: [],
            background: { type: 'solid', color: '#ffffff' },
            elements: [],
          },
          assets: {} as Record<string, string>,
        },
        {
          label: 'bento-sample-with-font-and-image',
          doc: sampleArtwork.doc,
          assets: sampleArtwork.assets,
        },
        {
          label: 'bento-sample-with-html-special-chars-and-extra-asset',
          doc: {
            ...sampleArtwork.doc,
            background: { type: 'solid', color: '#f7f5f0' },
            elements: [
              ...sampleElements,
              {
                id: 'extra-badge-&-<1>',
                kind: 'image',
                bounds: [20, 20, 64, 64],
                zIndex: sampleElements.length + 1,
                src: `asset:${hashA}`,
                fit: 'contain',
              },
            ],
          },
          assets: { [hashA]: uriA, ...sampleArtwork.assets },
        },
      ];

      const createdByNode = await designOperation(dataRoot, {
        operation: 'create',
        association,
        width: 1080,
        height: 1350,
      });

      const readByGo = await callMollyCoreIpc<DesignPayload>(
        socketPath,
        'design.read',
        { dataRoot, sessionId },
        undefined,
        ipcOpts
      );
      expect(readByGo.revisionId).toBe(createdByNode.revisionId);
      expect(readByGo.association).toEqual(createdByNode.association);

      let currentRev = createdByNode.revisionId;
      for (const sample of corpus) {
        const savedByNode = await designOperation(dataRoot, {
          operation: 'save',
          sessionId,
          baseRevisionId: currentRev,
          content: { doc: sample.doc, assets: sample.assets },
        });
        const nodeCanon = canonicalContentBytes({
          doc: savedByNode.doc,
          assets: savedByNode.assets,
        });
        const nodeDigest = createHash('sha256').update(nodeCanon).digest('hex');
        const goCanon = await callMollyCoreIpc<{ digest: string; bytes: number }>(
          socketPath,
          'design.canonical_digest',
          { doc: savedByNode.doc, assets: savedByNode.assets },
          undefined,
          ipcOpts
        );
        expect(goCanon.digest, sample.label).toBe(nodeDigest);
        expect(goCanon.bytes, sample.label).toBe(nodeCanon.byteLength);

        const readBackByGo = await callMollyCoreIpc<DesignPayload>(
          socketPath,
          'design.read',
          { dataRoot, sessionId },
          undefined,
          ipcOpts
        );
        expect(readBackByGo.revisionId, sample.label).toBe(savedByNode.revisionId);
        expect(readBackByGo.doc, sample.label).toEqual(savedByNode.doc);
        currentRev = savedByNode.revisionId;
      }

      const v1Node = (await designHistoryOperation(dataRoot, {
        operation: 'history-create',
        sessionId,
        baseRevisionId: currentRev,
      })) as DesignVersion;

      const listByGo = await callMollyCoreIpc<DesignVersion[]>(
        socketPath,
        'gitstore.list',
        { dataRoot, sessionId },
        undefined,
        ipcOpts
      );
      expect(listByGo).toEqual([v1Node]);

      const readV1Go = await callMollyCoreIpc<DesignPayload>(
        socketPath,
        'gitstore.read',
        { dataRoot, sessionId, commitId: v1Node.commitId },
        undefined,
        ipcOpts
      );
      const readV1Node = (await designHistoryOperation(dataRoot, {
        operation: 'history-read',
        sessionId,
        commitId: v1Node.commitId,
      })) as DesignPayload;
      expect(readV1Go.revisionId).toBe(readV1Node.revisionId);
      expect(readV1Go.doc).toEqual(readV1Node.doc);
    });
  }
);
