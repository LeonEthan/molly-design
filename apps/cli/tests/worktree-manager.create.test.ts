import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SessionId } from '@molly/shared';
import { WorktreeManager } from '../src/session/worktree/worktree-manager';
import {
  createLocalRepo,
  createRemoteRepo,
  gitCommit,
  runGit,
  seedHistoricalRepo,
  restoreHistoricalWorktree,
  useWorktreeManagerTestFixture,
} from './worktree-manager-test-helpers';

describe('WorktreeManager', () => {
  let testDir: string;
  let manager: WorktreeManager;
  let localRepoDir: string;

  useWorktreeManagerTestFixture((fixture) => {
    ({ testDir, manager, localRepoDir } = fixture);
  });

  describe('ensureRepo', () => {
    it('should prepare a shared local source without creating a bare clone', async () => {
      const sourceDir = createLocalRepo(testDir);
      manager.updateSource({
        kind: 'local-shared',
        originalRootPath: sourceDir,
      });

      await manager.ensureRepo();

      // @ts-expect-error - accessing private property for testing
      expect(fs.existsSync(manager.bareGitDir)).toBe(false);
      // @ts-expect-error - accessing private property for testing
      const metaPath = path.join(manager.repoDir, 'meta.json');
      expect(JSON.parse(fs.readFileSync(metaPath, 'utf8'))).toMatchObject({
        kind: 'local',
        originalRootPath: sourceDir,
      });
    });
  });

  describe('createWorktree', () => {
    it('should create a worktree for a session', async () => {
      await manager.ensureRepo();

      const sessionId = 'a1b2c3d4-session-1' as SessionId;
      const info = await manager.createWorktree(sessionId);

      expect(info.sessionId).toBe(sessionId);
      expect(info.branch).toBe(`molly/${sessionId.slice(0, 12)}`);
      expect(fs.existsSync(info.hostPath)).toBe(true);
    });

    it('should rewrite .git gitdir to a relative path', async () => {
      await manager.ensureRepo();

      const sessionId = 'gitdir01-session-gitdir' as SessionId;
      seedHistoricalRepo(manager, localRepoDir);
      const info = await restoreHistoricalWorktree(manager, sessionId);
      const gitFile = fs.readFileSync(path.join(info.hostPath, '.git'), 'utf8');
      expect(gitFile).toMatch(/^gitdir:\s*\.\./m);
      expect(gitFile).not.toMatch(/^gitdir:\s*\//m);
    });

    it('should reject unsafe session ids', async () => {
      await manager.ensureRepo();
      await expect(manager.createWorktree('../evil' as SessionId)).rejects.toThrow(
        /Invalid sessionId/
      );
      await expect(manager.createWorktree('session/evil' as SessionId)).rejects.toThrow(
        /Invalid sessionId/
      );
    });

    it('should be idempotent', async () => {
      await manager.ensureRepo();

      const sessionId = 'idempt02-session-2' as SessionId;
      const info1 = await manager.createWorktree(sessionId);
      const info2 = await manager.createWorktree(sessionId);

      expect(info1.hostPath).toBe(info2.hostPath);
      expect(info1.branch).toBe(info2.branch);
    });

    it('should rebuild a missing registered worktree without reusing its old branch', async () => {
      const sourceDir = createLocalRepo(testDir);
      manager.updateSource({ kind: 'local-shared', originalRootPath: sourceDir });
      const sessionId = 'staleadd-session-worktree' as SessionId;
      const first = await manager.createWorktree(sessionId);

      // Model a worktree directory disappearing before Git's registration is pruned.
      fs.rmSync(first.hostPath, { recursive: true, force: true });

      const rebuilt = await manager.createWorktree(sessionId);

      expect(rebuilt.branch).toBe(`${first.branch}-2`);
      expect(fs.existsSync(rebuilt.hostPath)).toBe(true);
    });

    it('should create multiple worktrees', async () => {
      await manager.ensureRepo();

      const session1 = 'multi0aa-session-a' as SessionId;
      const session2 = 'multi0bb-session-b' as SessionId;

      const info1 = await manager.createWorktree(session1);
      const info2 = await manager.createWorktree(session2);

      expect(info1.hostPath).not.toBe(info2.hostPath);
      expect(fs.existsSync(info1.hostPath)).toBe(true);
      expect(fs.existsSync(info2.hostPath)).toBe(true);
    });

    it('should create a shared-local worktree on a molly session branch', async () => {
      const sourceDir = createLocalRepo(testDir);
      manager.updateSource({
        kind: 'local-shared',
        originalRootPath: sourceDir,
      });

      const sessionId = 'local001-session-worktree' as SessionId;
      const info = await manager.createWorktree(sessionId);

      expect(info.branch).toBe('molly/local001-ses');
      expect(fs.existsSync(info.hostPath)).toBe(true);
      expect(runGit(info.hostPath, ['rev-parse', '--show-toplevel'])).toBe(info.hostPath);
      expect(runGit(sourceDir, ['worktree', 'list'])).toContain(info.hostPath);
    });

    it('should suffix a stale generated shared-local branch instead of restoring it', async () => {
      const sourceDir = createLocalRepo(testDir);
      manager.updateSource({
        kind: 'local-shared',
        originalRootPath: sourceDir,
      });
      const sessionId = 'local007-session-collision' as SessionId;
      const staleBranch = 'molly/local007-ses';
      runGit(sourceDir, ['branch', staleBranch]);

      const info = await manager.createWorktree(sessionId);

      expect(info.branch).toBe(`${staleBranch}-2`);
      expect(runGit(sourceDir, ['show-ref', '--verify', `refs/heads/${staleBranch}`])).toContain(
        `refs/heads/${staleBranch}`
      );
    });

    it('should create from the captured commit even after the source HEAD advances', async () => {
      const sourceDir = createLocalRepo(testDir);
      const capturedHead = runGit(sourceDir, ['rev-parse', 'HEAD']);
      fs.writeFileSync(path.join(sourceDir, 'later.txt'), 'later\n', 'utf8');
      const laterHead = gitCommit(sourceDir, 'later source commit');
      manager.updateSource({ kind: 'local-shared', originalRootPath: sourceDir });

      const info = await manager.createWorktree(
        'forkhead-session-worktree' as SessionId,
        undefined,
        undefined,
        capturedHead
      );

      expect(info.headSha).toBe(capturedHead);
      expect(info.headSha).not.toBe(laterHead);
    });

    it('should reject an existing target worktree at a different captured commit', async () => {
      const sourceDir = createLocalRepo(testDir);
      const capturedHead = runGit(sourceDir, ['rev-parse', 'HEAD']);
      fs.writeFileSync(path.join(sourceDir, 'later.txt'), 'later\n', 'utf8');
      const laterHead = gitCommit(sourceDir, 'later source commit');
      manager.updateSource({ kind: 'local-shared', originalRootPath: sourceDir });
      const sessionId = 'forkmismatch-session' as SessionId;
      await manager.createWorktree(sessionId, undefined, undefined, laterHead);

      await expect(
        manager.createWorktree(sessionId, undefined, undefined, capturedHead)
      ).rejects.toThrow(/does not match captured fork HEAD/);
    });

    it('should base a shared-local worktree on an exact remote ref', async () => {
      const { sourceDir } = createRemoteRepo(testDir, 'main');
      runGit(sourceDir, ['checkout', '-b', 'feature/remote-only']);
      fs.writeFileSync(path.join(sourceDir, 'remote-only.txt'), 'remote only\n', 'utf8');
      const featureHead = gitCommit(sourceDir, 'remote only');
      runGit(sourceDir, ['push', '-u', 'origin', 'feature/remote-only']);
      runGit(sourceDir, ['checkout', 'main']);
      runGit(sourceDir, ['branch', '-D', 'feature/remote-only']);
      manager.updateSource({
        kind: 'local-shared',
        originalRootPath: sourceDir,
      });

      const info = await manager.createWorktree(
        'local002-remote-ref' as SessionId,
        'refs/remotes/origin/feature/remote-only'
      );

      expect(info.headSha).toBe(featureHead);
    });

    it('should resolve a unique remote-only branch when restoring a shared-local worktree', async () => {
      const { sourceDir } = createRemoteRepo(testDir, 'main');
      runGit(sourceDir, ['checkout', '-b', 'feature/remote-only']);
      fs.writeFileSync(path.join(sourceDir, 'remote-only.txt'), 'remote only\n', 'utf8');
      const featureHead = gitCommit(sourceDir, 'remote only');
      runGit(sourceDir, ['push', '-u', 'origin', 'feature/remote-only']);
      runGit(sourceDir, ['checkout', 'main']);
      runGit(sourceDir, ['branch', '-D', 'feature/remote-only']);
      manager.updateSource({
        kind: 'local-shared',
        originalRootPath: sourceDir,
      });

      const info = await manager.createWorktree(
        'local004-remote-short' as SessionId,
        'feature/remote-only'
      );

      expect(info.headSha).toBe(featureHead);
    });

    it('should reject an explicit missing shared-local base instead of using HEAD', async () => {
      const sourceDir = createLocalRepo(testDir);
      manager.updateSource({
        kind: 'local-shared',
        originalRootPath: sourceDir,
      });

      await expect(
        manager.createWorktree('local003-missing-base' as SessionId, 'refs/heads/missing')
      ).rejects.toThrow('Local project branch not found: refs/heads/missing');
    });

    it('should resolve a local branch exactly when a tag has the same name', async () => {
      const sourceDir = createLocalRepo(testDir);
      const oldHead = runGit(sourceDir, ['rev-parse', 'HEAD']);
      fs.writeFileSync(path.join(sourceDir, 'new-head.txt'), 'new head\n', 'utf8');
      const branchHead = gitCommit(sourceDir, 'new branch head');
      runGit(sourceDir, ['tag', 'main', oldHead]);
      manager.updateSource({ kind: 'local-shared', originalRootPath: sourceDir });

      const info = await manager.createWorktree('local005-tag-collision' as SessionId, 'main');

      expect(info.headSha).toBe(branchHead);
    });

    it('should restore an existing session branch after its original base is deleted', async () => {
      const sourceDir = createLocalRepo(testDir);
      const restoredHead = runGit(sourceDir, ['rev-parse', 'HEAD']);
      const restoreBranch = 'lody/local006-restore';
      runGit(sourceDir, ['branch', restoreBranch]);
      manager.updateSource({ kind: 'local-shared', originalRootPath: sourceDir });

      const info = await manager.createWorktree(
        'local006-restore-base' as SessionId,
        'feature/deleted-base',
        restoreBranch
      );

      expect(info.branch).toBe(restoreBranch);
      expect(info.headSha).toBe(restoredHead);
    });

    it('restores historical files and the recorded branch without refreshing origin', async () => {
      const bareDir = seedHistoricalRepo(manager, localRepoDir);
      const sessionId = 'historic-session' as SessionId;
      const created = await restoreHistoricalWorktree(manager, sessionId);
      fs.writeFileSync(path.join(created.hostPath, 'notes.txt'), 'keep me');
      const recordedHead = gitCommit(created.hostPath, 'session notes');
      fs.writeFileSync(path.join(localRepoDir, 'later.txt'), 'later');
      gitCommit(localRepoDir, 'origin advances');
      fs.rmSync(localRepoDir, { recursive: true, force: true });

      expect((await manager.createWorktree(sessionId)).headSha).toBe(recordedHead);
      runGit(bareDir, ['worktree', 'remove', created.hostPath]);
      const restored = await manager.createWorktree(sessionId, undefined, created.branch);
      expect(restored.branch).toBe(created.branch);
      expect(restored.headSha).toBe(recordedHead);
      expect(fs.readFileSync(path.join(restored.hostPath, 'notes.txt'), 'utf8')).toBe('keep me');
    });

    it('rejects a fresh historical worktree even when a cached main branch exists', async () => {
      seedHistoricalRepo(manager, localRepoDir);
      const sessionId = 'retired-new-session' as SessionId;
      await expect(manager.createWorktree(sessionId)).rejects.toThrow(
        /New GitHub worktrees are retired/
      );
      expect(manager.hasWorktree(sessionId)).toBe(false);
    });

    it('does not initialize or clone a missing historical repository', async () => {
      manager.updateSource({ kind: 'github', repoUrl: localRepoDir });
      await expect(manager.ensureRepo()).rejects.toThrow(/missing/);
      expect(fs.existsSync(path.join(manager.getRepoHostPath(), 'bare.git'))).toBe(false);
    });

    it('keeps surviving files when the historical repository is missing', async () => {
      const bareDir = seedHistoricalRepo(manager, localRepoDir);
      const sessionId = 'surviving-session' as SessionId;
      const created = await restoreHistoricalWorktree(manager, sessionId);
      fs.writeFileSync(path.join(created.hostPath, 'notes.txt'), 'do not delete');
      fs.rmSync(bareDir, { recursive: true, force: true });
      await expect(manager.createWorktree(sessionId)).rejects.toThrow(/missing/);
      await expect(manager.removeWorktree(sessionId, true)).rejects.toThrow(/missing/);
      expect(fs.readFileSync(path.join(created.hostPath, 'notes.txt'), 'utf8')).toBe(
        'do not delete'
      );
    });

    it('fails closed when the recorded historical branch is missing', async () => {
      seedHistoricalRepo(manager, localRepoDir);
      await expect(
        manager.createWorktree('missing-branch' as SessionId, undefined, 'session/lost')
      ).rejects.toThrow('Session restore branch not found: session/lost');
    });
  });
});
