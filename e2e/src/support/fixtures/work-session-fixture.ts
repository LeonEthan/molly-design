import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
// The shared barrel targets bundler resolution; load its runtime contract here
// without pulling that barrel into this suite's NodeNext type graph.
const sharedPackage: string = '@molly/shared';
const { formatCustomAcpCommandLine } = await import(sharedPackage);

const execFileAsync = promisify(execFile);
const SCRIPTED_ACP_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/scripted-acp.mjs'
);
const SCRIPTED_MODEL_SERVER_ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/scripted-model-server.mjs'
);

/** One JSONL log mixes scripted-ACP process events and model-server wire events. */
export type ScriptedRuntimeEvent = {
  at: string;
  pid: number;
  event: string;
  sessionId?: string;
  mode?: string;
  stopReason?: string;
  requestId?: string;
  port?: number;
  model?: string;
  streaming?: boolean;
  transport?: string;
};

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    );
  }
}

export class WorkSessionFixture {
  readonly projectName = 'lody-e2e-work';
  readonly projectRoot: string;
  readonly eventLogPath: string;
  readonly scriptedAcpEntry = SCRIPTED_ACP_ENTRY;
  readonly scriptedAgentCommandLine: string;
  private modelServer: ChildProcess | null = null;
  modelServerPort: number | null = null;

  private constructor(
    readonly tempRoot: string,
    eventLogPath?: string
  ) {
    this.projectRoot = join(tempRoot, this.projectName);
    this.eventLogPath = eventLogPath ?? join(tempRoot, 'scripted-runtime-events.jsonl');
    this.scriptedAgentCommandLine = formatCustomAcpCommandLine({
      command: process.execPath,
      args: [this.scriptedAcpEntry, this.eventLogPath],
    });
  }

  /** The bundled engine's only external wire: a deterministic loopback model. */
  async startModelServer(): Promise<void> {
    if (this.modelServer) return;
    // The log lives in the retained artifact directory, so a previous run's
    // entries (including a dead server's `server-start` port) may still be
    // present; truncate to keep waitForEvent scoped to this server.
    writeFileSync(this.eventLogPath, '', 'utf8');
    this.modelServer = spawn(process.execPath, [SCRIPTED_MODEL_SERVER_ENTRY, this.eventLogPath], {
      stdio: 'ignore',
    });
    const started = await this.waitForEvent('server-start');
    const port = started.at(-1)?.port;
    if (typeof port !== 'number') throw new Error('Scripted model server did not bind a port');
    this.modelServerPort = port;
  }

  static async create(eventLogPath?: string): Promise<WorkSessionFixture> {
    const tempBase = process.platform === 'win32' ? tmpdir() : '/tmp';
    const fixture = new WorkSessionFixture(
      mkdtempSync(join(tempBase, 'lody-e2e-work-')),
      eventLogPath
    );
    try {
      mkdirSync(fixture.projectRoot, { recursive: true });
      writeFileSync(
        join(fixture.projectRoot, 'README.md'),
        '# Synthetic Molly E2E workspace\n\nThis repository contains no user data.\n',
        'utf8'
      );
      // This journey exercises clean-worktree cleanup. Design preparation now
      // installs its helpers in the actual cwd; ignore only those fixture
      // helpers, never authored PPTD/media or the artwork namespace.
      writeFileSync(
        join(fixture.projectRoot, '.gitignore'),
        '/.agents/skills/graphic-design/\n/.claude/skills/graphic-design/\n',
        'utf8'
      );
      await execFileAsync('git', ['init', '--initial-branch=main', fixture.projectRoot]);
      await execFileAsync('git', ['-C', fixture.projectRoot, 'add', 'README.md', '.gitignore']);
      await execFileAsync('git', [
        '-C',
        fixture.projectRoot,
        '-c',
        'user.name=Molly E2E',
        '-c',
        'user.email=e2e@lody.invalid',
        '-c',
        'commit.gpgSign=false',
        'commit',
        '-m',
        'test: initialize synthetic workspace',
      ]);
      return fixture;
    } catch (error) {
      fixture.dispose();
      throw error;
    }
  }

  readEvents(): ScriptedRuntimeEvent[] {
    try {
      return readFileSync(this.eventLogPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as ScriptedRuntimeEvent];
          } catch {
            // A process may be in the middle of appending the final JSONL record.
            return [];
          }
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async waitForEvent(event: string, minimumCount = 1): Promise<ScriptedRuntimeEvent[]> {
    await expect
      .poll(() => this.readEvents().filter((entry) => entry.event === event).length, {
        timeout: 30_000,
        intervals: [50, 100, 250, 500],
      })
      .toBeGreaterThanOrEqual(minimumCount);
    return this.readEvents().filter((entry) => entry.event === event);
  }

  getStartedAgentPids(): number[] {
    return [
      ...new Set(
        this.readEvents()
          .filter((entry) => entry.event === 'process-start')
          .map((entry) => entry.pid)
      ),
    ];
  }

  async expectAgentProcessesExited(pids = this.getStartedAgentPids()): Promise<void> {
    expect(pids.length, 'The scripted ACP process never started').toBeGreaterThan(0);
    await expect
      .poll(() => pids.filter(isProcessAlive), {
        timeout: 30_000,
        intervals: [50, 100, 250, 500],
      })
      .toEqual([]);
  }

  dispose(): void {
    this.modelServer?.kill('SIGTERM');
    this.modelServer = null;
    rmSync(this.tempRoot, { recursive: true, force: true });
  }
}
