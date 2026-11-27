import { getMollyDataDir } from '@molly/shared/node/installation-profile';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import { callMollyCoreIpc } from './molly-core-ipc';

export type MollyCoreEndpoint = {
  socketPath: string;
  authToken: string;
};

type CoreCompositionResponse = {
  name?: string;
  version?: string;
  goos?: string;
  goarch?: string;
  composition?: {
    capabilities?: {
      localOnly?: boolean;
      telemetryEnabled?: boolean;
      cloud?: unknown[];
    };
  };
};

const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 25;
const MAX_RESTART_ATTEMPTS = 10;
const STABLE_UPTIME_MS = 30_000;
const SIGTERM_GRACE_MS = 3_000;
const PERMANENT_EXIT_CODES = new Set([2]);

export function resolveMollyCoreBinaryPath(options?: {
  env?: NodeJS.ProcessEnv;
  cliEntrypoint?: string;
  platform?: NodeJS.Platform;
  exists?: (candidate: string) => boolean;
}): string | null {
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const exists = options?.exists ?? existsSync;

  const explicit = env.MOLLY_CORE_BIN?.trim();
  if (explicit) {
    return exists(explicit) ? explicit : null;
  }

  const entry = options?.cliEntrypoint ?? process.argv[1];
  if (!entry) {
    return null;
  }
  const binaryName = platform === 'win32' ? 'molly-core.exe' : 'molly-core';
  const siblingCandidate = path.resolve(path.dirname(entry), '..', 'molly-core', binaryName);
  return exists(siblingCandidate) ? siblingCandidate : null;
}

function createPrivateSocketEndpoint(platform: NodeJS.Platform): {
  endpoint: MollyCoreEndpoint;
  socketDir: string | null;
} {
  const authToken = randomBytes(32).toString('hex');
  if (platform === 'win32') {
    const suffix = randomBytes(12).toString('hex');
    return {
      endpoint: {
        socketPath: `\\\\.\\pipe\\molly-core-${suffix}`,
        authToken,
      },
      socketDir: null,
    };
  }
  const dirName = `mc-sup-${randomBytes(6).toString('hex')}`;
  const baseDir =
    platform === 'darwin' && process.env.MOLLY_ISOLATED_DATA_ROOT_STRICT !== '1'
      ? '/tmp'
      : os.tmpdir();
  const socketDir = path.join(baseDir, dirName);
  mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  return {
    endpoint: {
      socketPath: path.join(socketDir, 'c.sock'),
      authToken,
    },
    socketDir,
  };
}

export function spawnMollyCore(binaryPath: string, endpoint: MollyCoreEndpoint): ChildProcess {
  const handshake = process.env.MOLLY_SUPERVISOR_TRANSPORT === 'stdin';
  const env = { ...process.env };
  if (handshake) {
    delete env.MOLLY_CORE_IPC_TOKEN;
    delete env.MOLLY_DATA_DIR;
    delete env.LODY_DATA_DIR;
  } else env.MOLLY_CORE_IPC_TOKEN = endpoint.authToken;
  const child = spawn(
    binaryPath,
    ['--serve-ipc', endpoint.socketPath, handshake ? '--stdin-handshake' : '--watch-stdin'],
    {
      stdio: ['pipe', 'ignore', 'pipe'],
      env,
      windowsHide: true,
    }
  );
  if (handshake) {
    child.stdin?.on('error', () => child.kill());
    child.stdin?.write(
      JSON.stringify({
        authToken: endpoint.authToken,
        allowedDataRoot: getMollyDataDir(),
      }) + '\n'
    );
  }
  return child;
}

export class MollyCoreSupervisor {
  private readonly fixedEndpoint: MollyCoreEndpoint;
  private readonly socketDir: string | null;
  private readonly binaryPath: string;
  private readonly logger: Logger;
  private child: ChildProcess | null = null;
  private childExitPromise: Promise<number | null> | null = null;
  private ready = false;
  private attempts = 0;
  private stopping = false;
  private terminated = false;
  private wakeBackoffSleep: (() => void) | null = null;
  private activeProbeAbort: AbortController | null = null;
  private resolveInitialReady: ((endpoint: MollyCoreEndpoint | null) => void) | null = null;
  private readonly initialReadyPromise: Promise<MollyCoreEndpoint | null>;
  private readonly permanentFailureListeners = new Set<() => void>();

  constructor(options: { binaryPath: string; logger: Logger; platform?: NodeJS.Platform }) {
    const platform = options.platform ?? process.platform;
    const created = createPrivateSocketEndpoint(platform);
    this.fixedEndpoint = created.endpoint;
    this.socketDir = created.socketDir;
    this.binaryPath = options.binaryPath;
    this.logger = options.logger;
    this.initialReadyPromise = new Promise<MollyCoreEndpoint | null>((resolve) => {
      this.resolveInitialReady = resolve;
    });
  }

  private settleInitialReady(endpoint: MollyCoreEndpoint | null): void {
    const resolve = this.resolveInitialReady;
    if (!resolve) return;
    this.resolveInitialReady = null;
    resolve(endpoint);
  }

  private notifyPermanentFailure(): void {
    for (const listener of [...this.permanentFailureListeners]) {
      try {
        listener();
      } catch (error) {
        this.logger.debug(
          `[molly-core] permanent failure listener threw: ${formatErrorMessage(error)}`
        );
      }
    }
  }

  onPermanentFailure(listener: () => void): () => void {
    if (this.terminated) {
      listener();
      return () => {};
    }
    this.permanentFailureListeners.add(listener);
    return () => {
      this.permanentFailureListeners.delete(listener);
    };
  }

  getConfiguredEndpoint(): MollyCoreEndpoint | null {
    return this.stopping || this.terminated ? null : this.fixedEndpoint;
  }

  getReadyEndpoint(): MollyCoreEndpoint | null {
    return !this.stopping && !this.terminated && this.ready ? this.fixedEndpoint : null;
  }

  getChildPid(): number | null {
    return this.child?.pid ?? null;
  }

  async waitForInitialReady(timeoutMs = 2_000): Promise<MollyCoreEndpoint | null> {
    if (this.stopping || this.terminated) {
      return null;
    }
    if (this.ready) {
      return this.fixedEndpoint;
    }
    if (timeoutMs <= 0) {
      return null;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.initialReadyPromise,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      const startedAtMs = Date.now();
      let becameReady = false;
      let exitCode: number | null = null;
      try {
        const child = this.spawnChild();
        this.child = child;
        const exitPromise = new Promise<number | null>((resolve) => {
          let settled = false;
          const done = (code: number | null) => {
            if (settled) return;
            settled = true;
            resolve(code);
          };
          child.once('exit', (code) => done(code));
          child.once('error', (error) => {
            if (!this.stopping) {
              this.logger.warn(`[molly-core] spawn error: ${formatErrorMessage(error)}`);
            }
            done(1);
          });
        });
        this.childExitPromise = exitPromise;

        await this.waitUntilReady(child, exitPromise);
        becameReady = true;
        this.ready = true;
        this.settleInitialReady(this.fixedEndpoint);
        this.logger.info(
          `[molly-core] serving authenticated IPC at ${this.fixedEndpoint.socketPath}`
        );
        exitCode = await exitPromise;
      } catch (error) {
        if (!this.stopping) {
          this.logger.warn(`[molly-core] startup failed: ${formatErrorMessage(error)}`);
        }
        await this.terminateChild(this.child, this.childExitPromise);
        exitCode = this.child?.exitCode ?? null;
        this.settleInitialReady(null);
      }

      this.ready = false;
      this.child = null;
      this.childExitPromise = null;
      if (this.stopping) {
        this.settleInitialReady(null);
        this.cleanupSocketDir();
        return;
      }
      if (!becameReady && exitCode !== null && PERMANENT_EXIT_CODES.has(exitCode)) {
        this.logger.warn(
          `[molly-core] permanent startup failure (exit ${exitCode}); keeping TS fallback`
        );
        this.terminated = true;
        this.settleInitialReady(null);
        this.cleanupSocketDir();
        this.notifyPermanentFailure();
        return;
      }
      this.attempts = Date.now() - startedAtMs >= STABLE_UPTIME_MS ? 1 : this.attempts + 1;
      if (this.attempts > MAX_RESTART_ATTEMPTS) {
        this.logger.error(
          `[molly-core] exited ${MAX_RESTART_ATTEMPTS} consecutive times; keeping TS fallback`
        );
        this.terminated = true;
        this.settleInitialReady(null);
        this.cleanupSocketDir();
        this.notifyPermanentFailure();
        return;
      }
      const backoffMs = Math.min(1_000 * 2 ** (this.attempts - 1), 30_000);
      this.logger.info(
        `[molly-core] exited (code=${exitCode}); restarting in ${backoffMs}ms (attempt ${this.attempts})`
      );
      await this.interruptibleSleep(backoffMs);
    }
    this.cleanupSocketDir();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.ready = false;
    this.settleInitialReady(null);
    this.activeProbeAbort?.abort();
    this.wakeBackoffSleep?.();
    await this.terminateChild(this.child, this.childExitPromise);
    this.child = null;
    this.childExitPromise = null;
    this.cleanupSocketDir();
  }

  private spawnChild(): ChildProcess {
    const child = spawnMollyCore(this.binaryPath, this.fixedEndpoint);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) {
        this.logger.debug(`[molly-core] stderr: ${text.slice(0, 2_000)}`);
      }
    });
    return child;
  }

  private async waitUntilReady(
    child: ChildProcess,
    exitPromise: Promise<number | null>
  ): Promise<void> {
    const controller = new AbortController();
    this.activeProbeAbort = controller;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const exitState: { exited: boolean; code: number | null } = { exited: false, code: null };
    void exitPromise.then((code) => {
      exitState.exited = true;
      exitState.code = code;
    });

    try {
      while (!this.stopping && Date.now() < deadline) {
        if (exitState.exited) {
          break;
        }
        try {
          const res = await callMollyCoreIpc<CoreCompositionResponse>(
            this.fixedEndpoint.socketPath,
            'core.composition',
            {},
            controller.signal,
            {
              authToken: this.fixedEndpoint.authToken,
              requireMutualAuth: true,
            }
          );
          const caps = res.composition?.capabilities;
          if (
            res.name !== 'molly-core' ||
            !res.goos ||
            !res.goarch ||
            caps?.localOnly !== true ||
            caps?.telemetryEnabled !== false ||
            (Array.isArray(caps?.cloud) && caps.cloud.length > 0)
          ) {
            throw new Error('molly-core reported incompatible local composition');
          }
          return;
        } catch (error) {
          if (this.stopping) {
            throw new Error('molly-core supervisor stopped during handshake', { cause: error });
          }
          if (
            error instanceof Error &&
            error.message === 'molly-core reported incompatible local composition'
          ) {
            throw error;
          }
          if (exitState.exited) {
            throw new Error(`molly-core exited before ready (code=${exitState.code})`, {
              cause: error,
            });
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, READY_POLL_MS);
            timer.unref();
          });
        }
      }
      if (exitState.exited) {
        throw new Error(`molly-core exited before ready (code=${exitState.code})`);
      }
      if (child.exitCode !== null) {
        throw new Error(`molly-core exited before ready (code=${child.exitCode})`);
      }
      throw new Error('molly-core ready handshake timed out');
    } finally {
      if (this.activeProbeAbort === controller) {
        this.activeProbeAbort = null;
      }
    }
  }

  private async terminateChild(
    child: ChildProcess | null,
    exitPromise: Promise<number | null> | null
  ): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const exited = exitPromise ?? once(child, 'exit').then(() => child.exitCode);
    try {
      child.stdin?.end();
    } catch {
      this.logger.debug('[molly-core] stdin already closed during shutdown');
    }
    child.kill('SIGTERM');
    const outcome = await Promise.race([
      exited.then(() => 'exited' as const),
      new Promise<'timeout'>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), SIGTERM_GRACE_MS);
        timer.unref();
      }),
    ]);
    if (outcome === 'timeout' && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }

  private cleanupSocketDir(): void {
    if (!this.socketDir) return;
    try {
      rmSync(this.socketDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.debug(`[molly-core] socket dir cleanup skipped: ${formatErrorMessage(error)}`);
    }
  }

  private interruptibleSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeBackoffSleep = null;
        resolve();
      }, ms);
      timer.unref();
      this.wakeBackoffSleep = () => {
        clearTimeout(timer);
        this.wakeBackoffSleep = null;
        resolve();
      };
    });
  }
}

let supervisorInstance: MollyCoreSupervisor | null = null;
let supervisorLoop: Promise<void> | null = null;

export const getMollyCoreEndpoint = (): MollyCoreEndpoint | null =>
  supervisorInstance?.getReadyEndpoint() ?? null;

export const waitForMollyCoreEndpoint = async (
  timeoutMs = 2_000
): Promise<MollyCoreEndpoint | null> =>
  (await supervisorInstance?.waitForInitialReady(timeoutMs)) ?? null;

export const getMollyCoreConfiguredEndpoint = (): MollyCoreEndpoint | null =>
  supervisorInstance?.getConfiguredEndpoint() ?? null;

const globalPermanentFailureListeners = new Set<() => void>();

export function onMollyCorePermanentFailure(listener: () => void): () => void {
  globalPermanentFailureListeners.add(listener);
  const detachInstance = supervisorInstance?.onPermanentFailure(listener);
  return () => {
    globalPermanentFailureListeners.delete(listener);
    detachInstance?.();
  };
}

export async function startMollyCoreSupervisor(options: {
  logger: Logger;
  binaryPath?: string;
}): Promise<void> {
  if (supervisorInstance) {
    return;
  }
  if (process.env.MOLLY_CORE_DISABLED === '1') {
    options.logger.info('[molly-core] disabled via MOLLY_CORE_DISABLED; using TS fallback');
    return;
  }
  const binaryPath = options.binaryPath ?? resolveMollyCoreBinaryPath();
  if (!binaryPath) {
    options.logger.debug('[molly-core] binary not staged; using TS fallback');
    return;
  }
  const supervisor = new MollyCoreSupervisor({ binaryPath, logger: options.logger });
  for (const listener of globalPermanentFailureListeners) {
    supervisor.onPermanentFailure(listener);
  }
  supervisorInstance = supervisor;
  supervisorLoop = supervisor.run().catch((error: unknown) => {
    options.logger.error(`[molly-core] supervisor crashed: ${formatErrorMessage(error)}`);
  });
}

export async function stopMollyCoreSupervisor(): Promise<void> {
  const supervisor = supervisorInstance;
  if (!supervisor) {
    return;
  }
  supervisorInstance = null;
  await supervisor.stop();
  if (supervisorLoop) {
    await supervisorLoop;
    supervisorLoop = null;
  }
}
