# apps/cli/src/session/worktree

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Repo checkouts, worktrees, branch allocation, and setup scripts for sessions.
[../AGENTS.md](../AGENTS.md) and [apps/cli/AGENTS.md](../../../AGENTS.md) apply. Background
and file responsibilities: [../README.md](../README.md).

## Worktrees, branches, and setup

- Do not run post-turn automatic commit/push, PR discovery or Agent-driven branch renaming,
  including historical GitHub/worktree sessions with associated PRs. Keep worktree restore,
  setup and cleanup; design saves use the separate Molly-managed history repository.
- Resume a Session on a local project with the workspace's current branch as-is, worktree mode
  included: a persisted `acpSessionId` proves prior execution, so the stored `project.branch` is
  historical state, not a checkout request. A legacy direct local Session may re-enter
  `session/create` when no ACP session is resumable; initial `session/create` writes `project`
  metadata before dispatch, has no ACP session id, and must retain an explicitly requested branch.
  ACP restore and legacy direct-session reinitialization must never switch back to the Session's
  recorded branch.
- New independent project sessions use local projects or chat. GitHub creation, speculative preparation,
  new-worktree forks and automatic clone/fetch are retired. Historical GitHub sessions reuse
  existing local bare repositories and their recorded branches; missing/invalid state fails
  without replacement initialization, base-branch fallback or deletion of surviving files.
  Accepted first creates with a durable pending turn and no prior workspace/runtime evidence
  may allocate from their exact cached base; preserve the legacy omitted-base default (`main`).
  Existing recorded branches never fall back. Child Sessions validate the same-machine root
  parent's repository and recorded worktree, then share it without allocating a child worktree.
  Preserve historical decoding, setup/cleanup and accepted-operation recovery.
  Legacy marker `source.repoUrl` is retired transport metadata: compare GitHub
  identity by repo id and base branch so dropping the URL never disposes retained work.
  A conflicting historical marker fails without disposal or replacement creation.
- A fresh local worktree always owns a newly allocated branch from its selected base
  ref; suffix collisions instead of attaching to an existing ref. Reattaching an existing
  branch is reserved for an explicit `restoreBranchName` from the same Session.
- Worktree setup scripts are per worktree-directory lifetime: session runtime restore after
  idle GC must skip setup when the session's worktree directory already exists, but setup still
  runs when a missing worktree directory is materialized again.
- INVARIANT: speculative-worktree marker mutations are read-check-act on one file and are
  serialized per session (`withSessionMarkerLock` in `speculative-worktree.ts`) — a superseded
  preparation's dispose racing its replacement's materialization must never delete the
  replacement's directory.
- A prepared worktree may be adopted only when the durable claim did not return `mismatch` AND
  its directory still exists on disk; otherwise discard the prepared runtime (its ACP process
  cwd points at a dead inode) and let the cold path rebuild via `createWorktree`. A `mismatch`
  claim deletes the mismatched directory, so adoption after it hands the session a path that is
  not on disk.
- `worktree-config-resolver.ts` follows the durable launch-config rule in
  [../AGENTS.md](../AGENTS.md): do not write per-session `sessionLaunchConfig`.
