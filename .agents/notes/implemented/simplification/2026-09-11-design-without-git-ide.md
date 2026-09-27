# Design sessions without Git or IDE operations

Status: implemented
Translation: pending

## Abstract

The design landing page inherited branch and worktree selection, while session
headers and settings probed installed IDE launchers. T25 removes those choices and
their exclusive background work: a new local design session uses its selected
folder directly. Terminal, files, reference browser, shared-workspace forks, and
legacy worktree execution/recovery remain because they have real general consumers.
An isolated native non-Git flow verifies those design and tool paths; provider
coverage is a synthetic external ACP process, not a real model matrix.

## Decision and consumer audit

This implements [Issue #27](https://github.com/LeonEthan/Folio/issues/27), following
the [design Spec](../../../../specs/graphic-design-platform.zh.md) and
[scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md).
It follows [T24's review retirement](2026-09-11-developer-workflow-retirement.md).

| Surface           | Removed consumers                                                                                                                                                                     | Retained consumers and reason                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| New local design  | Branch/worktree pills and mobile picker; local Git-state cache, dedupe, retry, CLI-state refresh subscription; reading/writing the new-session workdir preference                     | Project folder and trusted Session cwd; existing stored preferences/Session metadata remain untouched                                    |
| IDE               | Session header split launcher, custom launcher settings, detection probes, preference storage listeners, Electron launch/probe IPC, exclusive IPC schemas and launcher implementation | Current artwork, copy path, reveal in file manager, open with default app, download and generic file error actions                       |
| Fork and tabs     | Human new-worktree fork menus and their Git eligibility/cache/probe effects                                                                                                           | Provider-native shared-workspace fork, Tab/Side Chat, pending historical worktree-fork recovery, pane/file/browser lifecycle             |
| Terminal          | No removal                                                                                                                                                                            | Interactive user process, Agent process tools, diagnostics and lifecycle cleanup share real non-Git consumers                            |
| Reference browser | No removal                                                                                                                                                                            | Human reference browsing, session partition restoration and independent tab visibility                                                   |
| Settings          | Repository-status preload in the global settings cache                                                                                                                                | Query mounts only with project worktree settings; existing local/legacy setup and cleanup scripts still execute and must remain editable |
| File tree         | Inactive local file-list source subscription when a provider owns the tree                                                                                                            | Real local file listing, source resolver, watcher lifecycle, bounded file preview and recovery                                           |
| Session owner     | Unconditional organization auth hook in local composition                                                                                                                             | Immutable `teamSharing` capability gates organization lookup; local Session owner semantics and cloud team pickers remain                |

Deleting every Git/worktree module would break old sessions and file ownership.
The retained execution roots include workspace/worktree resolution, credentials
where existing workspaces need them, setup/cleanup scripts, dirty-worktree checks,
file/process/permission protocols and `WorkspaceWatchCoordinator`. There is no
Loro rewrite, directory import, data cleanup or replacement design orchestration.
GitHub-only shared components and standalone CLI contracts are not newly exposed by
the local design landing page; the cloud-only `session create` command still fails
without auth configuration and was not repurposed as local session orchestration.

The current-artwork callback was previously passed only to hidden conversation
headers. The visible desktop toolbar now receives that existing callback so the
ordinary design entry survives the IDE wrapper removal and can reveal the canvas.

### Factual correction to the earlier smoke interpretation

The earlier console showed two independent events: `useWorkspaceMembers` mounted
`auth.getActiveOrganization` in local UI, and local worktree file listing observed
a removed path after archive. They are not a call chain. The first violates the
local public boundary and is now gated. The second uses local project control and
can legitimately report a missing path after clean-worktree removal; deletion and
dirty-file protection remain unchanged.

## Verification

An isolated native Electron run in a synthetic folder without `.git` completed
onboarding, external scripted ACP dispatch, design read/save, terminal output at
the resolved folder cwd, text-file preview and reference Browser navigation.
From the file preview, clicking the visible Current artwork action revealed the
design canvas. The
browser used an isolated HTTPS protocol fixture, avoiding external-network timing.
Archive/permanent deletion preserved the ordinary source file. Captured logs had
no `auth.getActiveOrganization` request. A first terminal-cwd assertion compared
macOS `/tmp` with `/private/tmp`; comparing real paths corrected the test assumption.

The legacy worktree lifecycle journey seeds metadata with `LoroRepo.upsertDocMeta`
and the existing local data-plane sync, then uses the local `session/create`
control contract and the real UI terminal/archive/delete path. The focused native
run passed all six steps, including process, terminal and clean-worktree release.
This keeps authoritative legacy worktree coverage after its landing-page selector
is retired. It does not recreate a design-only scheduler or modify dirty rules.

`corepack pnpm check` passed, including 3,271 component tests, CLI lifecycle
and dirty-worktree tests, and public/platform/import boundary checks. The desktop
build, e2e suite checks and documentation checks passed. The rebuilt native smoke suite passed all three scenarios and 18 steps, covering
local onboarding, Session lifecycle, and the legacy worktree lifecycle. Native evidence
is synthetic and local; no paid model calls, real-provider matrix, or visual quality
claim is made. Native evidence is retained outside Git at
`/tmp/folio-t25-native-round5` and `e2e/artifacts/acceptance/t25-smoke-complete`.
Captured logs and synthetic Agent transcripts remain uncommitted.
