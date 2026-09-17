import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, type CDPSession, type ElectronApplication, type Page } from '@playwright/test';
import {
  assertNamedPipeReleased,
  assertTcpPortReleased,
  reserveTcpPort,
  type ScenarioArtifacts,
} from './world-utils.js';
import {
  collectPostGcRuntimeSnapshot,
  collectProcessTree,
  collectRuntimeSnapshot,
  type RuntimeSnapshot,
} from './resource-probe.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ELECTRON_DIR = join(ROOT, 'apps', 'electron');
const MAIN_ENTRY = join(ELECTRON_DIR, 'out', 'main', 'index.js');
const BUNDLED_CLI_ENTRY = join(ELECTRON_DIR, 'resources', 'cli', 'index.js');
const requireFromElectron = createRequire(join(ELECTRON_DIR, 'package.json'));
const TEARDOWN_OPERATION_TIMEOUT_MS = 20_000;

async function boundedTeardown<T>(label: string, operation: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} exceeded ${TEARDOWN_OPERATION_TIMEOUT_MS}ms`)),
      TEARDOWN_OPERATION_TIMEOUT_MS
    );
    timeout.unref();
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function resolveElectronExecutable(): string {
  const electronPackageDir = dirname(requireFromElectron.resolve('electron/package.json'));
  const relativePath = readFileSync(join(electronPackageDir, 'path.txt'), 'utf8').trim();
  return join(electronPackageDir, 'dist', relativePath);
}

type LogRecord = {
  at: string;
  source: 'electron-main' | 'renderer' | 'page' | 'request';
  level: string;
  message: string;
};

const INHERITED_ENV_ALLOWLIST = [
  'APPDATA',
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'HOME',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WAYLAND_DISPLAY',
  'WINDIR',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
] as const;

export function createIsolatedEnvironment(
  overrides: Record<string, string>,
  inherited: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV_ALLOWLIST) {
    const value = inherited[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...overrides };
}

export class ElectronHarness {
  app: ElectronApplication | null = null;
  page: Page | null = null;
  readonly logs: LogRecord[] = [];
  readonly snapshots: RuntimeSnapshot[] = [];
  private tempRoot: string | null = null;
  private hostPort: number | null = null;
  private hostPipe: string | null = null;
  private traceStarted = false;
  private performanceSession: CDPSession | null = null;
  private rendererPaintCount = 0;
  private launchVerified = false;
  private launchTarget: { installedExecutable?: string; expectedSourceCommit?: string } | null = null;

  constructor(readonly artifacts: ScenarioArtifacts) {}

  async launch(): Promise<void> {
    if (this.app || this.tempRoot) throw new Error('Electron harness already owns a launch');
    this.captureLaunchTarget();
    await this.start(false);
  }

  async launchReviewProfile(source: string): Promise<void> {
    if (this.app || this.tempRoot) throw new Error('Electron harness already owns a launch');
    const profile = realpathSync(resolve(source));
    for (const directory of ['electron-user-data', 'lody-data']) {
      if (!existsSync(join(profile, directory))) {
        throw new Error(`Review profile is missing ${directory}`);
      }
    }
    const tempBase = process.platform === 'win32' ? tmpdir() : '/tmp';
    this.tempRoot = mkdtempSync(join(tempBase, 'lody-e2e-review-'));
    try {
      cpSync(join(profile, 'electron-user-data'), join(this.tempRoot, 'electron-user-data'), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      cpSync(join(profile, 'lody-data'), join(this.tempRoot, 'lody-data'), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      const copiedUserData = join(this.tempRoot, 'electron-user-data');
      for (const cache of [
        'Cache',
        'Code Cache',
        'GPUCache',
        'DawnGraphiteCache',
        'DawnWebGPUCache',
        'Service Worker',
        'Shared Dictionary',
      ]) {
        rmSync(join(copiedUserData, cache), { recursive: true, force: true });
      }
      this.captureLaunchTarget();
      await this.start(true);
    } catch (error) {
      if (this.app) await this.close().catch(() => {});
      else if (this.tempRoot) rmSync(this.tempRoot, { recursive: true, force: true });
      this.tempRoot = null;
      throw error;
    }
  }

  async restart(): Promise<void> {
    if (!this.launchVerified || !this.app || !this.tempRoot) {
      throw new Error('Only a verified running Electron harness can restart');
    }
    await this.shutdown(true);
    await this.start(true);
  }

  async exportReviewProfile(destination: string): Promise<string> {
    if (!this.launchVerified || !this.tempRoot) throw new Error('Review export needs a verified launch');
    const owned = realpathSync(this.tempRoot);
    const target = join(realpathSync(dirname(resolve(destination))), basename(destination));
    if (existsSync(target) || target === owned || target.startsWith(owned + sep)) {
      throw new Error('Review destination must be new and outside the owned profile');
    }
    await this.shutdown(true);
    try {
      mkdirSync(target);
      cpSync(owned, target, { recursive: true, force: false, errorOnExist: true });
    } catch (error) {
      this.record('electron-main', 'retained-review-data', owned);
      this.tempRoot = null;
      this.writeDiagnostics();
      throw error;
    }
    await this.close();
    return target;
  }

  private captureLaunchTarget(): void {
    this.launchTarget = {
      installedExecutable: (process.env.MOLLY_E2E_INSTALLED_EXECUTABLE ?? process.env.LODY_E2E_INSTALLED_EXECUTABLE),
      expectedSourceCommit: (process.env.MOLLY_E2E_EXPECTED_SOURCE_COMMIT ?? process.env.LODY_E2E_EXPECTED_SOURCE_COMMIT),
    };
  }

  private async start(restarting: boolean): Promise<void> {
    if (!this.launchTarget) throw new Error('Electron launch target is missing');
    const { installedExecutable, expectedSourceCommit } = this.launchTarget;
    if (installedExecutable && !/^[a-f0-9]{40}$/.test(expectedSourceCommit ?? '')) {
      throw new Error('Installed acceptance requires MOLLY_E2E_EXPECTED_SOURCE_COMMIT (full SHA)');
    }
    if (installedExecutable && !existsSync(installedExecutable)) {
      throw new Error(`Installed Electron executable does not exist: ${installedExecutable}`);
    }
    if (!installedExecutable && (!existsSync(MAIN_ENTRY) || !existsSync(BUNDLED_CLI_ENTRY))) {
      throw new Error(
        'Desktop E2E artifacts are missing. Run `pnpm e2e:build` before launching scenarios.'
      );
    }

    const tempBase = process.platform === 'win32' ? tmpdir() : '/tmp';
    if (!restarting) this.tempRoot = mkdtempSync(join(tempBase, 'lody-e2e-'));
    if (!this.tempRoot) throw new Error('Verified restart data is missing');
    const electronUserDataDir = join(this.tempRoot, 'electron-user-data');
    const lodyDataDir = join(this.tempRoot, 'lody-data');
    mkdirSync(electronUserDataDir, { recursive: true });
    mkdirSync(lodyDataDir, { recursive: true });
    if (process.platform === 'win32') {
      this.hostPipe = `\\\\.\\pipe\\lody-e2e-${randomUUID()}`;
    } else {
      this.hostPort = await reserveTcpPort();
    }

    const env = createIsolatedEnvironment({
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      MOLLY_DATA_DIR: lodyDataDir,
      MOLLY_E2E: '1',
      ...(this.hostPort !== null ? { MOLLY_E2E_LOCAL_CLI_HOST_PORT: String(this.hostPort) } : {}),
      ...(this.hostPipe ? { MOLLY_E2E_LOCAL_CLI_HOST_PIPE: this.hostPipe } : {}),
      MOLLY_ELECTRON_DISABLE_SHELL_ENV: '1',
      MOLLY_ELECTRON_DISABLE_SYSTEM_PROXY_ENV: '1',
      ...(!restarting ? { MOLLY_ELECTRON_FORCE_ONBOARDING: '1' } : {}),
      MOLLY_ELECTRON_USER_DATA_DIR: electronUserDataDir,
      NODE_ENV: 'test',
    });
    this.app = await _electron.launch({
      args: [
        '--js-flags=--expose-gc',
        // GitHub-hosted Linux runners restrict unprivileged user namespaces,
        // which breaks Electron's SUID sandbox from an unpacked dev tree.
        ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
        // The app directory preserves app.getAppPath() for bundled design resources.
        // Packaged executables locate their own app.asar; never inject source into them.
        ...(installedExecutable ? [] : [ELECTRON_DIR]),
        `--user-data-dir=${electronUserDataDir}`,
        '--lang=en-US',
      ],
      cwd: installedExecutable ? dirname(resolve(installedExecutable)) : ELECTRON_DIR,
      env,
      executablePath: installedExecutable
        ? resolve(installedExecutable)
        : resolveElectronExecutable(),
      timeout: 60_000,
    });
    const childProcess = this.app.process();
    childProcess.stdout?.on('data', (chunk) =>
      this.record('electron-main', 'stdout', String(chunk))
    );
    childProcess.stderr?.on('data', (chunk) =>
      this.record('electron-main', 'stderr', String(chunk))
    );

    const bootState = await this.app.evaluate(({ app, BrowserWindow }) => ({
      appReady: app.isReady(),
      diagnostic: (
        globalThis as typeof globalThis & {
          __MOLLY_E2E_BOOT_DIAGNOSTIC__?: { stage: string; error?: string };
        }
      ).__MOLLY_E2E_BOOT_DIAGNOSTIC__,
      rendererCount: BrowserWindow.getAllWindows().length,
      userDataPath: app.getPath('userData'),
      appPath: app.getAppPath(),
      executablePath: process.execPath,
      isPackaged: app.isPackaged,
    }));
    this.record('electron-main', 'boot-state', JSON.stringify(bootState));
    if (realpathSync(bootState.userDataPath) !== realpathSync(electronUserDataDir)) {
      throw new Error('Electron did not use the isolated acceptance user-data directory');
    }
    if (installedExecutable && !bootState.isPackaged) {
      throw new Error('Installed acceptance target did not boot as a packaged application');
    }
    if (installedExecutable) {
      const sourceCommit = await this.app.evaluate(({ app }) => {
        const fs = process.getBuiltinModule('fs');
        const path = process.getBuiltinModule('path');
        const manifest: unknown = JSON.parse(
          fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')
        );
        return manifest && typeof manifest === 'object' && 'mollySourceCommit' in manifest
          ? manifest.mollySourceCommit
          : null;
      });
      this.record('electron-main', 'installed-source', JSON.stringify({ sourceCommit }));
      if (sourceCommit !== expectedSourceCommit) {
        throw new Error(
          `Installed application source commit does not match ${expectedSourceCommit}`
        );
      }
    }
    if (bootState.diagnostic?.stage === 'failed') {
      throw new Error(
        `Electron main boot failed:\n${bootState.diagnostic.error ?? 'unknown error'}`
      );
    }

    this.page = await this.app.firstWindow({ timeout: 60_000 });
    this.page.on('console', (message) => this.record('renderer', message.type(), message.text()));
    this.page.on('pageerror', (error) =>
      this.record('page', 'error', error.stack ?? error.message)
    );
    this.page.on('requestfailed', (request) =>
      this.record(
        'request',
        'error',
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'failed'}`
      )
    );
    await this.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    this.traceStarted = true;
    await this.page.waitForFunction(() => document.readyState !== 'loading', undefined, {
      timeout: 60_000,
    });
    this.performanceSession = await this.page.context().newCDPSession(this.page);
    this.performanceSession.on('LayerTree.layerPainted', () => {
      this.rendererPaintCount += 1;
    });
    await this.performanceSession.send('Performance.enable');
    await this.performanceSession.send('LayerTree.enable');
    await this.page.evaluate(() => {
      if (window.__MOLLY_E2E_PERFORMANCE__) return;
      window.__MOLLY_E2E_PERFORMANCE__ = { longTaskCount: 0, longTaskDurationMs: 0 };
      const observer = new PerformanceObserver((list) => {
        const summary = window.__MOLLY_E2E_PERFORMANCE__;
        if (!summary) return;
        for (const entry of list.getEntries()) {
          summary.longTaskCount += 1;
          summary.longTaskDurationMs += entry.duration;
        }
      });
      try {
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        observer.disconnect();
      }
    });
    this.launchVerified = true;
  }

  async captureSnapshot(): Promise<RuntimeSnapshot> {
    if (!this.app || !this.page) throw new Error('Electron harness is not running');
    const snapshot = await collectRuntimeSnapshot(
      this.app,
      this.page,
      'ambient',
      this.performanceSession ?? undefined,
      this.rendererPaintCount
    );
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async capturePostGcSnapshot(): Promise<RuntimeSnapshot> {
    if (!this.app || !this.page) throw new Error('Electron harness is not running');
    const snapshot = await collectPostGcRuntimeSnapshot(
      this.app,
      this.page,
      this.performanceSession ?? undefined,
      this.rendererPaintCount
    );
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async captureCliBacklog(): Promise<unknown> {
    if (!this.page) return [];
    return await this.page.evaluate(async () => await window.ipc?.invoke('cli.getOutputBacklog'));
  }

  async stopTrace(path?: string): Promise<void> {
    if (!this.app || !this.traceStarted) return;
    this.traceStarted = false;
    await this.app.context().tracing.stop(path ? { path } : undefined);
  }

  async captureHeapSnapshots(outputDir: string): Promise<{ main: string; renderer: string }> {
    if (!this.app || !this.page) throw new Error('Electron harness is not running');
    mkdirSync(outputDir, { recursive: true });
    const mainPath = join(outputDir, 'electron-main.heapsnapshot');
    const rendererPath = join(outputDir, 'renderer.heapsnapshot');
    await this.app.evaluate(async (_runtime, targetPath) => {
      const writer = (
        globalThis as typeof globalThis & {
          __MOLLY_E2E_WRITE_HEAP_SNAPSHOT__?: (path: string) => string;
        }
      ).__MOLLY_E2E_WRITE_HEAP_SNAPSHOT__;
      if (!writer) throw new Error('Electron main E2E heap writer is unavailable');
      writer(targetPath);
    }, mainPath);

    const cdp = await this.page.context().newCDPSession(this.page);
    const rendererFd = openSync(rendererPath, 'w');
    let complete = false;
    let writeError: unknown;
    cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }: { chunk: string }) => {
      if (writeError) return;
      try {
        writeSync(rendererFd, chunk, undefined, 'utf8');
      } catch (error) {
        writeError = error;
      }
    });
    try {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      if (writeError) throw writeError;
      fsyncSync(rendererFd);
      complete = true;
    } finally {
      try {
        await cdp.detach();
      } finally {
        closeSync(rendererFd);
        if (!complete) rmSync(rendererPath, { force: true });
      }
    }
    return { main: mainPath, renderer: rendererPath };
  }

  async close(): Promise<void> {
    await this.shutdown(false);
  }

  private async shutdown(preserveData: boolean): Promise<void> {
    this.launchVerified = false;
    let closeError: unknown;
    const appProcess = this.app?.process();
    const phase = (name: string, detail?: unknown) => {
      this.record('electron-main', 'teardown', JSON.stringify({ phase: name, detail }));
      this.writeDiagnostics();
    };
    phase('owned-processes');
    const ownedProcesses = appProcess?.pid
      ? await boundedTeardown('Owned process snapshot', collectProcessTree(appProcess.pid)).catch(
          (error: unknown) => {
            closeError = error;
            return [];
          }
        )
      : [];
    phase('trace-stop', ownedProcesses);
    try {
      await boundedTeardown('Trace stop', this.stopTrace());
    } catch (error) {
      closeError ??= error;
    }
    phase('performance-detach');
    try {
      if (this.performanceSession)
        await boundedTeardown('Performance session detach', this.performanceSession.detach());
    } catch (error) {
      closeError ??= error;
    }
    phase('application-close');
    try {
      if (this.app) await boundedTeardown('Electron application close', this.app.close());
    } catch (error) {
      closeError ??= error;
      try {
        appProcess?.kill('SIGKILL');
      } catch (killError) {
        closeError ??= killError;
      }
    } finally {
      this.app = null;
      this.page = null;
      this.performanceSession = null;
    }

    phase('endpoint-release');
    try {
      if (this.hostPort !== null) await assertTcpPortReleased(this.hostPort);
      if (this.hostPipe !== null) await assertNamedPipeReleased(this.hostPipe);
    } catch (error) {
      closeError ??= error;
    }
    phase('directory-cleanup');
    try {
      const survivors = () => ownedProcesses.filter(({ pid }) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code !== 'ESRCH';
        }
      });
      try {
        // Electron's root exit precedes descendant teardown on some platforms.
        // Observe only the captured owned PIDs; never signal unrelated processes.
        await expect.poll(() => survivors(), {
          timeout: TEARDOWN_OPERATION_TIMEOUT_MS,
          message: 'Owned processes must exit before isolated data cleanup',
        }).toEqual([]);
      } catch {
        phase('surviving-owned-processes', survivors());
        throw new Error('Owned processes remain after Electron quit; isolated data retained');
      }
      if (this.tempRoot && !closeError && !preserveData) {
        rmSync(this.tempRoot, { recursive: true, force: true });
      } else if (this.tempRoot) phase('retained-data', this.tempRoot);
    } catch (error) {
      closeError ??= error;
    }
    if (!preserveData || closeError) this.tempRoot = null;
    this.hostPort = null;
    this.hostPipe = null;
    this.rendererPaintCount = 0;
    phase('finished', closeError instanceof Error ? closeError.message : closeError);
    if (closeError) throw closeError;
  }

  writeDiagnostics(): void {
    writeFileSync(
      join(this.artifacts.scenarioDir, 'console.log'),
      this.logs.map((record) => JSON.stringify(record)).join('\n') + '\n',
      'utf8'
    );
    writeFileSync(
      join(this.artifacts.scenarioDir, 'runtime.json'),
      `${JSON.stringify({ snapshots: this.snapshots }, null, 2)}\n`,
      'utf8'
    );
  }

  private record(source: LogRecord['source'], level: string, message: string): void {
    this.logs.push({ at: new Date().toISOString(), source, level, message });
  }
}

declare global {
  interface Window {
    ipc?: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      send(channel: string, payload?: unknown): void;
      on(channel: string, listener: (payload: unknown) => void): () => void;
    };
    __MOLLY_ELECTRON__?: true;
    __MOLLY_E2E_PERFORMANCE__?: {
      longTaskCount: number;
      longTaskDurationMs: number;
    };
  }
}
