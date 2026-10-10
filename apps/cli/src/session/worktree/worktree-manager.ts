import { RepoId, SessionId } from '@molly/shared';
import { resolveLocalProjectBranchAtRootPath } from '@molly/shared/node/local-project';
import spawn from 'cross-spawn';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@/utils/logger';
import { withFileLock } from '@/utils/file-lock';
import { formatErrorMessage } from '@/utils/format-error';
import { ensureMollyDataDir, getMollyDataDir } from '@molly/shared/node/installation-profile';
import { mapGitSpawnError } from './git-process-error';
import { resolveAvailableBranchName } from './branch-name-allocation';

const SAFE_SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MOLLY_LOCAL_BRANCH_PREFIX = 'molly/';
const COMMON_BASE_BRANCH_NAMES = new Set([
  'main',
  'master',
  'dev',
  'develop',
  'development',
  'trunk',
  'release',
  'staging',
  'stage',
  'prod',
  'production',
]);

function assertSafeSessionId(sessionId: SessionId): void {
  if (!SAFE_SESSION_ID_RE.test(sessionId)) {
    throw new Error(
      `Invalid sessionId ${JSON.stringify(sessionId)}: expected /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/`
    );
  }
}

function toGitPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function realpathIfExists(value: string): string {
  try {
    if (typeof fs.realpathSync.native === 'function') {
      return fs.realpathSync.native(value);
    }
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

/**
 * Storage layout (native):
 * - Host: <active installation data root>/repos/<repoId>/
 *   - bare.git/ (bare clone of the repository)
 *   - worktrees/<sessionId>/ (worktree directory for each session)
 *   - cache/{npm,pnpm,pip,...}/ (optional package manager caches)
 */

export interface WorktreeInfo {
  sessionId: SessionId;
  hostPath: string;
  branch: string;
  headSha: string | null;
  isClean: boolean;
}

export type WorktreeInspection =
  | { state: 'missing'; path: string }
  | { state: 'clean' | 'dirty'; path: string; info: WorktreeInfo }
  | { state: 'failed'; path: string; message: string };

export interface ArchivedWorktreeResult {
  branchName: string | null;
  backupCommitCreated: boolean;
}

export type WorktreeManagerSource =
  | { kind: 'github'; repoUrl?: string }
  | { kind: 'local-shared'; sourceGitDir?: string; originalRootPath: string };

export interface WorktreeManagerConfig {
  repoId: RepoId;
  source?: WorktreeManagerSource;
  logger: Logger;
}

export type RemoveWorktreeOptions = {
  baseBranchName?: string;
};

const DEFAULT_ARCHIVE_BACKUP_AUTHOR_NAME = 'Molly Archive';
const DEFAULT_ARCHIVE_BACKUP_AUTHOR_EMAIL = 'archive@lody.ai';

// Ceiling for any single git invocation. Must stay well below the file-lock
// staleness window (30 min) so a stalled git process releases the repo lock
// by failing instead of looking like a live holder.
const GIT_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Per-repo file lock for git operations (cross-process safe)
 */
async function withRepoLock<T>(repoId: RepoId, fn: () => Promise<T>): Promise<T> {
  return withFileLock(`worktree-${repoId}`, fn, {
    timeout: 120000, // 120 seconds timeout for git operations (clone can be slow)
  });
}

/**
 * WorktreeManager handles git worktree operations for a single repository.
 * Each fresh session gets its own worktree directory and a newly allocated branch.
 * Existing branches are reattached only for an explicit same-session restore.
 */
export class WorktreeManager {
  private readonly repoId: RepoId;
  private source: WorktreeManagerSource;
  private readonly logger: Logger;

  /** Base directory on host: <active installation data root>/repos */
  private readonly baseDir: string;
  /** Repo directory on host: <active installation data root>/repos/<repoId> */
  private readonly repoDir: string;
  /** Bare git directory: <active installation data root>/repos/<repoId>/bare.git */
  private readonly bareGitDir: string;
  /** Worktrees directory: <active installation data root>/repos/<repoId>/worktrees */
  private readonly worktreesDir: string;
  /** Cache directory: <active installation data root>/repos/<repoId>/cache */
  private readonly cacheDir: string;

  constructor(config: WorktreeManagerConfig) {
    this.repoId = config.repoId;
    this.source = config.source ?? { kind: 'github' };
    this.logger = config.logger;

    this.baseDir = path.join(getMollyDataDir(), 'repos');
    this.repoDir = path.join(this.baseDir, this.repoId);
    this.bareGitDir = path.join(this.repoDir, 'bare.git');
    this.worktreesDir = path.join(this.repoDir, 'worktrees');
    this.cacheDir = path.join(this.repoDir, 'cache');
  }

  updateSource(source?: WorktreeManagerSource): void {
    if (source) this.source = source;
  }

  private runGit(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
    const mergedEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...env,
      GIT_TERMINAL_PROMPT: '0',
    };
    this.logger.debug(`[${this.repoId}] Running git ${args.join(' ')}`);
    return new Promise<string>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('git', args, {
          cwd,
          env: mergedEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        reject(mapGitSpawnError(error, cwd));
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Git has no deadline of its own for stalled network operations; without this a
      // hung fetch/clone would pin the per-repo worktree lock until the file-lock
      // staleness window frees it.
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, GIT_OPERATION_TIMEOUT_MS);
      timeoutTimer.unref();

      // Use setEncoding to handle UTF-8 multibyte boundaries correctly
      // (e.g., non-ASCII branch names, file paths, user.name)
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');

      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });

      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        clearTimeout(timeoutTimer);
        reject(mapGitSpawnError(error, cwd));
      });

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        if (timedOut) {
          reject(new Error(`git ${args.join(' ')} timed out after ${GIT_OPERATION_TIMEOUT_MS}ms`));
          return;
        }
        if (code !== 0) {
          const details = (stderr || stdout || '').trim();
          reject(new Error(details ? details : `git exited with code ${code}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private isLocalSharedSource(): boolean {
    return this.source.kind === 'local-shared';
  }

  private getGitAdminCwd(): string {
    return this.source.kind === 'local-shared' ? this.source.originalRootPath : this.bareGitDir;
  }

  private async ensureLocalSharedRepoLocked(): Promise<void> {
    if (this.source.kind !== 'local-shared') return;

    // A local-shared repo keeps its git data in the user's own project, but its
    // worktrees still live under the installation data directory — the same
    // `fs.mkdirSync` the bare branch of `ensureRepoLocked` performs. Without it the
    // only thing that would create the directory is `git worktree add`, which reports
    // the failure as a path git was handed rather than as Molly's own data root.
    fs.mkdirSync(this.worktreesDir, { recursive: true });

    const originalRootPath = this.source.originalRootPath;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(originalRootPath);
    } catch (error) {
      throw new Error(`[${this.repoId}] Local worktree source is missing: ${originalRootPath}`, {
        cause: error,
      });
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `[${this.repoId}] Local worktree source is not a directory: ${originalRootPath}`
      );
    }

    try {
      await this.runGit(['rev-parse', '--git-dir', '--is-inside-work-tree'], originalRootPath);
    } catch (error) {
      throw new Error(
        `[${this.repoId}] Local project is not a git repository: ${originalRootPath}`,
        { cause: error }
      );
    }

    fs.mkdirSync(this.worktreesDir, { recursive: true });
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(this.repoDir, { recursive: true });
    const metaPath = path.join(this.repoDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      fs.writeFileSync(
        metaPath,
        `${JSON.stringify(
          {
            kind: 'local',
            originalRootPath,
            ...(this.source.sourceGitDir ? { sourceGitDir: this.source.sourceGitDir } : {}),
            createdAtMs: Date.now(),
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    }
  }

  /**
   * Git worktrees created from a bare repo write an absolute `gitdir:` pointer into `<worktree>/.git`.
   * That absolute host path can break if the repo is moved across mount points. To make the worktree
   * more portable across environments, rewrite the
   * `gitdir:` pointer to a relative path (relative to the worktree directory).
   */
  private ensureWorktreeGitdirIsRelative(sessionId: SessionId): void {
    if (this.isLocalSharedSource()) return;
    const worktreePath = this.getWorktreeHostPath(sessionId);
    const gitFilePath = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitFilePath)) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(gitFilePath);
    } catch {
      return;
    }

    if (!stat.isFile()) {
      return;
    }

    let content = '';
    try {
      content = fs.readFileSync(gitFilePath, 'utf8');
    } catch {
      return;
    }

    const lines = content.split(/\r?\n/);
    const gitdirIndex = lines.findIndex((line) => line.trimStart().startsWith('gitdir:'));
    if (gitdirIndex === -1) return;

    const raw = lines[gitdirIndex] ?? '';
    const currentGitdir = raw.replace(/^\s*gitdir:\s*/i, '').trim();
    if (!currentGitdir) return;

    if (!path.isAbsolute(currentGitdir)) {
      return;
    }

    const worktreeName = path.basename(currentGitdir) as SessionId;
    const expectedGitdir = path.join(this.bareGitDir, 'worktrees', worktreeName);
    const relative = path.relative(worktreePath, expectedGitdir);
    lines[gitdirIndex] = `gitdir: ${toGitPath(relative)}`;
    try {
      fs.writeFileSync(gitFilePath, lines.join('\n'));
    } catch {
      // ignore
    }
  }

  private async ensureRepoLocked(): Promise<void> {
    ensureMollyDataDir();
    if (this.source.kind === 'local-shared') {
      await this.ensureLocalSharedRepoLocked();
      return;
    }
    if (!fs.existsSync(this.bareGitDir)) {
      throw new Error(
        `[${this.repoId}] Historical repository is missing; GitHub cloning is retired.`
      );
    }
    const isBare = await this.runGit(['rev-parse', '--is-bare-repository'], this.bareGitDir);
    if (isBare !== 'true') {
      throw new Error(`[${this.repoId}] Historical repository is not a bare repository.`);
    }
  }

  private async hasCommitish(rev: string): Promise<boolean> {
    try {
      await this.runGit(['rev-parse', '--verify', `${rev}^{commit}`], this.getGitAdminCwd());
      return true;
    } catch {
      return false;
    }
  }

  private async resolveBaseRef(preferredBranch?: string): Promise<string> {
    if (this.source.kind === 'local-shared') {
      const preferred = preferredBranch?.trim();
      if (preferred) {
        if (preferred.startsWith('refs/heads/') || preferred.startsWith('refs/remotes/')) {
          if (await this.hasCommitish(preferred)) return preferred;
          throw new Error(`Local project branch not found: ${preferred}`);
        }
        // `preferred` can still be a pre-selector bare name, which git itself
        // would resolve local-first rather than reject.
        return (
          await resolveLocalProjectBranchAtRootPath(this.source.originalRootPath, preferred, {
            preferLocalOnCollision: true,
          })
        ).refName;
      }
      if (await this.hasCommitish('HEAD')) return 'HEAD';
      throw new Error(`[${this.repoId}] Local repository has no commit to use as a worktree base`);
    }

    throw new Error('New GitHub worktrees are retired; restore the recorded session branch.');
  }

  /**
   * Get the host path for the repository root
   */
  getRepoHostPath(): string {
    return this.repoDir;
  }

  /**
   * Get the host path for a session's worktree
   */
  getWorktreeHostPath(sessionId: SessionId): string {
    assertSafeSessionId(sessionId);
    return path.join(this.getWorktreesHostPath(), sessionId);
  }

  private getWorktreesHostPath(): string {
    return realpathIfExists(this.worktreesDir);
  }

  /**
   * Get the cache directory host path
   */
  getCacheHostPath(): string {
    return this.cacheDir;
  }

  /**
   * Validate the local repository used by the worktree
   */
  async ensureRepo(): Promise<void> {
    return withRepoLock(this.repoId, async () => {
      await this.ensureRepoLocked();
    });
  }

  private getDefaultSessionBranchName(sessionId: SessionId): string {
    if (this.isLocalSharedSource()) {
      const shortId = sessionId
        .slice(0, 12)
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 12);
      return `${MOLLY_LOCAL_BRANCH_PREFIX}${shortId || sessionId.slice(0, 8)}`;
    }
    return `session/${sessionId.slice(0, 8)}`;
  }

  private isMollyManagedLocalBranch(branchName: string): boolean {
    return this.normalizeBranchName(branchName).startsWith(MOLLY_LOCAL_BRANCH_PREFIX);
  }

  private normalizeBranchName(branchName: string): string {
    return branchName
      .trim()
      .replace(/^refs\/heads\//, '')
      .replace(/^origin\//, '');
  }

  private isCommonBaseBranchName(branchName: string): boolean {
    const normalized = this.normalizeBranchName(branchName).toLowerCase();
    if (!normalized) {
      return false;
    }
    if (COMMON_BASE_BRANCH_NAMES.has(normalized)) {
      return true;
    }
    return normalized.startsWith('release/') || normalized.startsWith('releases/');
  }

  private isLegacyReusedBaseBranch(branchName?: string): branchName is string {
    const trimmed = branchName?.trim();
    return !!trimmed && !this.isCommonBaseBranchName(trimmed);
  }

  private async hasLocalBranch(branchName: string): Promise<boolean> {
    const sanitized = branchName.trim();
    if (!sanitized) {
      return false;
    }
    try {
      await this.runGit(['show-ref', '--verify', `refs/heads/${sanitized}`], this.getGitAdminCwd());
      return true;
    } catch {
      return false;
    }
  }

  private async resolveRestoreBranchName(restoreBranchName?: string): Promise<string | null> {
    const trimmed = restoreBranchName?.trim();
    if (!trimmed) {
      return null;
    }
    if (!(await this.hasLocalBranch(trimmed))) {
      throw new Error(`Session restore branch not found: ${trimmed}`);
    }
    return trimmed;
  }

  private shouldPreserveRemovedBranch(
    branchName: string,
    options?: RemoveWorktreeOptions
  ): boolean {
    const baseBranchName = options?.baseBranchName?.trim();
    return (
      !!baseBranchName &&
      branchName === baseBranchName &&
      this.isLegacyReusedBaseBranch(baseBranchName)
    );
  }

  private shouldDeleteRemovedBranch(branchName: string, options?: RemoveWorktreeOptions): boolean {
    if (this.shouldPreserveRemovedBranch(branchName, options)) {
      this.logger.debug(
        `[${this.repoId}] Preserving reused base branch after worktree removal: ${branchName}`
      );
      return false;
    }

    if (this.isLocalSharedSource() && !this.isMollyManagedLocalBranch(branchName)) {
      this.logger.warn(
        `[${this.repoId}] Preserving non-lody local branch after worktree removal: ${branchName}`
      );
      return false;
    }

    return true;
  }

  private isLikelyStaleWorktreeError(error: unknown): boolean {
    const message = formatErrorMessage(error).toLowerCase();
    return (
      message.includes('missing') ||
      message.includes('locked') ||
      message.includes('administrative') ||
      message.includes('not a working tree') ||
      message.includes('already exists')
    );
  }

  private async runWorktreeAddWithPruneRetry(args: string[], cwd: string): Promise<void> {
    try {
      await this.runGit(args, cwd);
    } catch (error) {
      if (!this.isLikelyStaleWorktreeError(error)) {
        throw error;
      }
      this.logger.debug(
        `[${this.repoId}] git worktree add failed; pruning stale entries and retrying once: ${formatErrorMessage(error)}`
      );
      try {
        await this.runGit(['worktree', 'prune'], cwd);
      } catch (pruneError) {
        this.logger.debug(
          `[${this.repoId}] git worktree prune failed before retry: ${formatErrorMessage(pruneError)}`
        );
      }
      await this.runGit(args, cwd);
    }
  }

  private isBranchNameConflictError(error: unknown): boolean {
    const message = formatErrorMessage(error).toLowerCase();
    return (
      (message.includes('branch named') && message.includes('already exists')) ||
      message.includes('cannot lock ref')
    );
  }

  private async runFreshWorktreeAddWithPruneRetry(
    sessionId: SessionId,
    worktreePath: string,
    startPoint: string,
    cwd: string
  ): Promise<void> {
    const branchName = await this.resolveAvailableSessionBranchName(sessionId);
    const createArgs = ['worktree', 'add', '-b', branchName, worktreePath, startPoint];
    try {
      await this.runGit(createArgs, cwd);
      return;
    } catch (error) {
      if (!this.isLikelyStaleWorktreeError(error)) {
        throw error;
      }
      this.logger.debug(
        `[${this.repoId}] Fresh worktree add failed; pruning stale entries before retry: ${formatErrorMessage(error)}`
      );
      try {
        await this.runGit(['worktree', 'prune'], cwd);
      } catch (pruneError) {
        this.logger.debug(
          `[${this.repoId}] git worktree prune failed before fresh-branch retry: ${formatErrorMessage(pruneError)}`
        );
      }

      // `git worktree add -b` creates the branch before every later setup step.
      // If a stale worktree registration made that setup fail, reattach only the
      // branch this invocation just created. A pre-existing/racing branch-name
      // conflict must never take this path.
      if (!this.isBranchNameConflictError(error) && (await this.hasLocalBranch(branchName))) {
        const [branchHead, startPointHead] = await Promise.all([
          this.runGit(['rev-parse', '--verify', `${branchName}^{commit}`], cwd),
          this.runGit(['rev-parse', '--verify', `${startPoint}^{commit}`], cwd),
        ]);
        if (branchHead === startPointHead) {
          await this.runWorktreeAddWithPruneRetry(
            ['worktree', 'add', worktreePath, branchName],
            cwd
          );
          return;
        }
      }

      // The branch was not created by the failed command (or another writer won
      // its name). Allocate a new suffix instead of attaching to that ref.
      const retryBranchName = await this.resolveAvailableSessionBranchName(sessionId);
      await this.runGit(['worktree', 'add', '-b', retryBranchName, worktreePath, startPoint], cwd);
    }
  }

  private async resolveAvailableSessionBranchName(sessionId: SessionId): Promise<string> {
    const baseName = this.getDefaultSessionBranchName(sessionId);
    const output = await this.runGit(
      ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads'],
      this.getGitAdminCwd()
    );
    return resolveAvailableBranchName(
      baseName,
      output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );
  }

  /**
   * Create a worktree for a session
   * Branch name: session/<shortSessionId> (or lody/<shortSessionId> for shared-local
   * sources), with a numeric suffix when that ref already exists.
   */
  async createWorktree(
    sessionId: SessionId,
    baseBranch?: string,
    restoreBranchName?: string,
    exactStartPoint?: string,
    acceptedGitHubBaseBranch?: string
  ): Promise<WorktreeInfo> {
    return withRepoLock(this.repoId, async () => {
      assertSafeSessionId(sessionId);
      const worktreePath = this.getWorktreeHostPath(sessionId);
      const gitAdminCwd = this.getGitAdminCwd();
      await this.ensureRepoLocked();

      // Check if worktree already exists. Restoring an on-disk worktree only
      // reads local git state, so it must not depend on origin being reachable.
      if (fs.existsSync(worktreePath)) {
        this.ensureWorktreeGitdirIsRelative(sessionId);
        const info = await this.getWorktreeInfo(sessionId);
        if (exactStartPoint && info.headSha !== exactStartPoint) {
          throw new Error(
            `[${this.repoId}] Existing worktree HEAD ${info.headSha ?? 'unknown'} does not match captured fork HEAD ${exactStartPoint}`
          );
        }
        this.logger.debug(
          `[${this.repoId}] Worktree already exists (sessionId=${sessionId} branch=${info.branch} head=${info.headSha ?? 'unknown'}): ${info.hostPath}`
        );
        return info;
      }

      const existingBranchName = await this.resolveRestoreBranchName(restoreBranchName);

      if (existingBranchName) {
        if (exactStartPoint) {
          const existingHead = await this.runGit(
            ['rev-parse', '--verify', `${existingBranchName}^{commit}`],
            gitAdminCwd
          );
          if (existingHead !== exactStartPoint) {
            throw new Error(
              `[${this.repoId}] Existing fork branch HEAD ${existingHead} does not match captured fork HEAD ${exactStartPoint}`
            );
          }
        }
        // Worktree missing but branch exists - create worktree from existing branch
        this.logger.debug(
          `[${this.repoId}] Creating worktree from existing branch: ${existingBranchName}`
        );
        await this.runWorktreeAddWithPruneRetry(
          ['worktree', 'add', worktreePath, existingBranchName],
          gitAdminCwd
        );
      } else {
        if (exactStartPoint) {
          const verifiedStartPoint = await this.runGit(
            ['rev-parse', '--verify', `${exactStartPoint}^{commit}`],
            gitAdminCwd
          );
          if (verifiedStartPoint !== exactStartPoint) {
            throw new Error(
              `[${this.repoId}] Captured fork HEAD did not resolve exactly: ${exactStartPoint}`
            );
          }
          this.logger.debug(
            `[${this.repoId}] Creating fork worktree from captured HEAD (sessionId=${sessionId} head=${exactStartPoint})`
          );
          await this.runFreshWorktreeAddWithPruneRetry(
            sessionId,
            worktreePath,
            exactStartPoint,
            gitAdminCwd
          );
        } else {
          const resolvedBase =
            this.source.kind === 'github' && acceptedGitHubBaseBranch
              ? await this.resolveAcceptedGitHubBaseRef(acceptedGitHubBaseBranch)
              : await this.resolveBaseRef(baseBranch);
          this.logger.debug(
            `[${this.repoId}] Creating new worktree (sessionId=${sessionId} base=${resolvedBase}): ${worktreePath}`
          );
          await this.runFreshWorktreeAddWithPruneRetry(
            sessionId,
            worktreePath,
            resolvedBase,
            gitAdminCwd
          );
        }
      }

      this.ensureWorktreeGitdirIsRelative(sessionId);
      const info = await this.getWorktreeInfo(sessionId);
      this.logger.debug(
        `[${this.repoId}] Worktree ready (sessionId=${sessionId} branch=${info.branch} head=${info.headSha ?? 'unknown'}): host=${info.hostPath}`
      );
      return info;
    });
  }

  private async resolveAcceptedGitHubBaseRef(branch: string): Promise<string> {
    const refs = branch.startsWith('refs/')
      ? [branch]
      : [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`];
    for (const ref of refs) {
      if (await this.hasCommitish(ref)) return ref;
    }
    throw new Error(`Accepted GitHub create base branch is unavailable locally: ${branch}`);
  }

  /**
   * Get information about a worktree
   */
  private async getWorktreeInfo(sessionId: SessionId): Promise<WorktreeInfo> {
    assertSafeSessionId(sessionId);
    const worktreePath = this.getWorktreeHostPath(sessionId);

    // Get the actual branch name from git (handles renamed branches and short session IDs)
    const branchName =
      (await this.getCurrentBranchName(sessionId)) ?? this.getDefaultSessionBranchName(sessionId);

    let isClean = true;
    try {
      const status = await this.runGit(['status', '--porcelain'], worktreePath);
      isClean = status.trim() === '';
    } catch {
      isClean = false;
    }

    let headSha: string | null = null;
    try {
      headSha = await this.runGit(['rev-parse', 'HEAD'], worktreePath);
    } catch {
      headSha = null;
    }

    return {
      sessionId,
      hostPath: worktreePath,
      branch: branchName,
      headSha,
      isClean,
    };
  }

  /** Read a session worktree's current state without creating or mutating it. */
  async inspectWorktree(sessionId: SessionId): Promise<WorktreeInspection> {
    return withRepoLock(this.repoId, async () => {
      assertSafeSessionId(sessionId);
      const worktreePath = this.getWorktreeHostPath(sessionId);
      if (!fs.existsSync(worktreePath)) {
        return { state: 'missing', path: worktreePath };
      }
      try {
        const info = await this.getWorktreeInfo(sessionId);
        return { state: info.isClean ? 'clean' : 'dirty', path: worktreePath, info };
      } catch (error) {
        return {
          state: 'failed',
          path: worktreePath,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * Remove a worktree for a session
   * @param force - If true, remove even if dirty
   */
  async removeWorktree(
    sessionId: SessionId,
    force: boolean = false,
    branchName?: string,
    options?: RemoveWorktreeOptions
  ): Promise<void> {
    return withRepoLock(this.repoId, async () => {
      const resolvedBranchName = await this.removeWorktreeInternal(sessionId, {
        force,
        deleteBranch: true,
        branchName,
      });
      if (resolvedBranchName) {
        if (this.shouldDeleteRemovedBranch(resolvedBranchName, options)) {
          await this.cleanupBranch(resolvedBranchName);
        }
      }
    });
  }

  /**
   * Archive a worktree for a session.
   * If the worktree has non-ignored changes, stage and commit them before removing the worktree directory.
   * The branch is preserved so the worktree can be restored later.
   */
  async archiveWorktree(sessionId: SessionId): Promise<ArchivedWorktreeResult> {
    return withRepoLock(this.repoId, async () => {
      assertSafeSessionId(sessionId);
      const worktreePath = this.getWorktreeHostPath(sessionId);
      const branchName = (await this.getCurrentBranchName(sessionId)) ?? null;

      if (!fs.existsSync(worktreePath)) {
        this.logger.debug(`[${this.repoId}] Worktree for session ${sessionId} does not exist`);
        return {
          branchName,
          backupCommitCreated: false,
        };
      }

      let backupCommitCreated = false;
      const status = await this.runGit(['status', '--porcelain'], worktreePath);
      if (status.trim().length > 0) {
        this.logger.debug(
          `[${this.repoId}] Creating archive backup commit for session ${sessionId}`
        );
        await this.runGit(['add', '-A'], worktreePath);
        const cachedDiff = await this.runGit(['diff', '--cached', '--name-only'], worktreePath);
        if (cachedDiff.trim().length > 0) {
          const commitEnv: NodeJS.ProcessEnv = {
            GIT_AUTHOR_NAME: DEFAULT_ARCHIVE_BACKUP_AUTHOR_NAME,
            GIT_COMMITTER_NAME: DEFAULT_ARCHIVE_BACKUP_AUTHOR_NAME,
            GIT_AUTHOR_EMAIL: DEFAULT_ARCHIVE_BACKUP_AUTHOR_EMAIL,
            GIT_COMMITTER_EMAIL: DEFAULT_ARCHIVE_BACKUP_AUTHOR_EMAIL,
          };
          await this.runGit(
            [
              '-c',
              'commit.gpgsign=false',
              'commit',
              '-m',
              `chore: archive backup for session ${sessionId.slice(0, 8)}`,
            ],
            worktreePath,
            commitEnv
          );
          backupCommitCreated = true;
        }
      }

      const resolvedBranchName = await this.removeWorktreeInternal(sessionId, {
        force: true,
        deleteBranch: false,
        branchName: branchName ?? undefined,
      });
      return {
        branchName: resolvedBranchName,
        backupCommitCreated,
      };
    });
  }

  private async removeWorktreeInternal(
    sessionId: SessionId,
    options: {
      force: boolean;
      deleteBranch: boolean;
      branchName?: string;
    }
  ): Promise<string | null> {
    assertSafeSessionId(sessionId);
    const worktreePath = this.getWorktreeHostPath(sessionId);

    const preferredBranchName = options.branchName?.trim() || undefined;
    const currentBranchName = await this.getCurrentBranchName(sessionId);
    const resolvedBranchName =
      currentBranchName ??
      (preferredBranchName && (await this.hasLocalBranch(preferredBranchName))
        ? preferredBranchName
        : null);

    if (!fs.existsSync(worktreePath)) {
      this.logger.debug(`[${this.repoId}] Worktree for session ${sessionId} does not exist`);
      return resolvedBranchName;
    }

    if (!this.isLocalSharedSource()) {
      await this.ensureRepoLocked();
    }

    if (!options.force) {
      const info = await this.getWorktreeInfo(sessionId);
      if (!info.isClean) {
        throw new Error(
          `Worktree for session ${sessionId} has uncommitted changes. Use force=true to remove anyway.`
        );
      }
    }

    const relative = path.relative(this.getWorktreesHostPath(), worktreePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Invalid worktree path: ${worktreePath}`);
    }

    this.logger.debug(
      `[${this.repoId}] Removing worktree for session ${sessionId}${options.deleteBranch ? '' : ' (preserving branch)'}`
    );

    try {
      const args = ['worktree', 'remove', worktreePath];
      if (options.force) args.splice(2, 0, '--force');
      await this.runGit(args, this.getGitAdminCwd());
    } catch (error) {
      if (!options.force) {
        throw error;
      }
      this.logger.debug(`[${this.repoId}] git worktree remove failed, removing directory manually`);
      fs.rmSync(worktreePath, { recursive: true, force: true });
      await this.runGit(['worktree', 'prune'], this.getGitAdminCwd());
    }

    return resolvedBranchName;
  }

  /**
   * Clean up a branch (best effort)
   */
  private async cleanupBranch(branchName: string): Promise<void> {
    if (this.isLocalSharedSource() && !this.isMollyManagedLocalBranch(branchName)) {
      return;
    }
    try {
      await this.runGit(['branch', '-D', branchName], this.getGitAdminCwd());
      this.logger.debug(`[${this.repoId}] Deleted branch: ${branchName}`);
    } catch {
      // Branch might not exist or be in use, ignore
    }
  }

  /**
   * List all worktrees for this repository
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    return withRepoLock(this.repoId, async () => {
      if (!fs.existsSync(this.worktreesDir)) {
        return [];
      }

      const entries = fs.readdirSync(this.worktreesDir, { withFileTypes: true });
      const worktrees: WorktreeInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionId = entry.name as SessionId;
          if (!SAFE_SESSION_ID_RE.test(sessionId)) {
            this.logger.debug(
              `[${this.repoId}] Skipping invalid worktree directory name: ${JSON.stringify(sessionId)}`
            );
            continue;
          }
          try {
            worktrees.push(await this.getWorktreeInfo(sessionId));
          } catch (error) {
            this.logger.debug(
              `[${this.repoId}] Failed to get info for worktree ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }
      }

      return worktrees;
    });
  }

  /**
   * Check if a worktree exists for a task
   */
  hasWorktree(sessionId: SessionId): boolean {
    if (!SAFE_SESSION_ID_RE.test(sessionId)) {
      return false;
    }
    return fs.existsSync(this.getWorktreeHostPath(sessionId));
  }

  /**
   * Prune orphaned worktrees and branches
   */
  async prune(): Promise<void> {
    return withRepoLock(this.repoId, async () => {
      this.logger.debug(`[${this.repoId}] Pruning orphaned worktrees`);
      await this.runGit(['worktree', 'prune'], this.getGitAdminCwd());
    });
  }

  /**
   * Rename the branch for a session's worktree.
   * This allows changing from the current branch to a meaningful name.
   *
   * @param sessionId - The session ID
   * @param newBranchName - The new branch name (e.g., "feat/add-dark-mode")
   * @returns The updated WorktreeInfo with the new branch name
   */
  async renameBranch(sessionId: SessionId, newBranchName: string): Promise<WorktreeInfo> {
    return withRepoLock(this.repoId, async () => {
      assertSafeSessionId(sessionId);

      const worktreePath = this.getWorktreeHostPath(sessionId);
      if (!fs.existsSync(worktreePath)) {
        throw new Error(`Worktree for session ${sessionId} does not exist`);
      }

      // Get the actual current branch name from git
      const currentBranch = await this.getCurrentBranchName(sessionId);
      if (!currentBranch) {
        throw new Error(`Cannot determine current branch for session ${sessionId}`);
      }

      // Validate the new branch name
      if (!newBranchName || typeof newBranchName !== 'string') {
        throw new Error('Invalid branch name');
      }

      const sanitizedName = newBranchName.trim();
      if (sanitizedName === currentBranch) {
        // Already on the same branch, just return current info
        return this.getWorktreeInfo(sessionId);
      }

      // Check if new branch name already exists
      let newBranchExists = false;
      try {
        await this.runGit(
          ['show-ref', '--verify', `refs/heads/${sanitizedName}`],
          this.getGitAdminCwd()
        );
        newBranchExists = true;
      } catch {
        newBranchExists = false;
      }

      if (newBranchExists) {
        throw new Error(`Branch '${sanitizedName}' already exists`);
      }

      this.logger.debug(
        `[${this.repoId}] Renaming branch for session ${sessionId}: ${currentBranch} -> ${sanitizedName}`
      );

      // Rename the branch in the worktree
      await this.runGit(['branch', '-m', currentBranch, sanitizedName], worktreePath);

      // Update worktree info - now we need to get the actual branch name from git
      let headSha: string | null = null;
      try {
        headSha = await this.runGit(['rev-parse', 'HEAD'], worktreePath);
      } catch {
        headSha = null;
      }

      let isClean = true;
      try {
        const status = await this.runGit(['status', '--porcelain'], worktreePath);
        isClean = status.trim() === '';
      } catch {
        isClean = false;
      }

      this.logger.debug(
        `[${this.repoId}] Branch renamed successfully for session ${sessionId}: ${sanitizedName}`
      );

      return {
        sessionId,
        hostPath: worktreePath,
        branch: sanitizedName,
        headSha,
        isClean,
      };
    });
  }

  /**
   * Get the current branch name for a session's worktree.
   * This resolves the actual branch name from git, which may differ from `session/<sessionId>`
   * if the branch was renamed.
   */
  async getCurrentBranchName(sessionId: SessionId): Promise<string | null> {
    assertSafeSessionId(sessionId);
    const worktreePath = this.getWorktreeHostPath(sessionId);

    if (!fs.existsSync(worktreePath)) {
      return null;
    }

    try {
      const branchName = await this.runGit(['branch', '--show-current'], worktreePath);
      return branchName.trim() || null;
    } catch {
      // Fallback to rev-parse
      try {
        const ref = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
        return ref.trim() || null;
      } catch {
        return null;
      }
    }
  }
}

/**
 * Cache of WorktreeManager instances per repo
 */
const worktreeManagers = new Map<RepoId, WorktreeManager>();

/**
 * Get or create a WorktreeManager for a repository
 */
export function getWorktreeManager(config: WorktreeManagerConfig): WorktreeManager {
  let manager = worktreeManagers.get(config.repoId);
  if (!manager) {
    manager = new WorktreeManager(config);
    worktreeManagers.set(config.repoId, manager);
  } else {
    manager.updateSource(config.source);
  }
  return manager;
}
