# Resolve design files in the actual Session workspace

Status: implemented
Translation: pending

## Abstract

Design preparation, preview and collection previously selected the default chat
folder even when Lody executed the Agent in a local project. The existing Session
host cwd now selects an artwork/session namespace through one resolved context,
while immutable turn inputs retain their existing recovery location. Application
projections have a separate directory and cannot become output merely by being
materialized. Existing drafts are preserved; redirecting a frozen turn to a new
workspace is explicitly refused rather than automatically recovered across paths.

## Decision and boundaries

This implements [T04](https://github.com/LeonEthan/Folio/issues/6) within the
[design scope](../../../../specs/graphic-design-platform.zh.md) and the
[scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md).
The deterministic layout and consumer contracts are described in the
[CLI design README](../../../../apps/cli/src/design/README.md).

Lody already determines project, worktree and non-Git execution directories;
replacing that resolver or changing Agent cwd would duplicate its responsibility.
A project-wide `design.pptd` would also mix independent artworks. The chosen
namespace uses existing IDs and adds no work-copy registry or directory-management
UI. Ordinary chat workspaces retain their prior root.

The immutable manifest records the resolved draft directory and artwork ID, but
those fields are not trusted paths. Preparation, render/image RPC and collection
compare them against the live Session's deterministic mapping. Legacy manifests
remain bound to the known chat root. No file-existence heuristic switches roots
mid-turn, and no existing draft or frozen manifest is migrated or overwritten.
An old turn whose actual workspace has changed produces a diagnostic; this is a
remaining availability limit, not a claim that old files were lost.

The fixed `design-current/` path reserves the application projection location,
separate from the collectible draft. T04 does not export canonical state on
dispatch or persist per-baseline projection snapshots; the read-hook slice owns
synchronization. Tests use the T03 exporter only to demonstrate that application
input cannot become an Agent result. The current canvas and T01 unchanged-output
semantics remain in the existing store and collector.

Image output uses the same draft media directory. Explicit edit references can
still come from the actual Session workspace, preserving the existing attachment
path. No hooks, file watcher, candidates, runtime restart or paid retries are added.

## Verification and limits

Focused deterministic tests exercise synthetic application projection → synthetic Agent draft → preview
payload → collection → current canvas in project-marked, non-Git and ordinary chat
directories. They cover re-resolving the same workspace, distinct artwork/session
IDs, frozen input preservation, workspace changes and redirected namespaces.
MCP tests use an in-memory transport and synthetic image responses to check that
generation and edits land in the resolved artwork directory while attachment
sources remain readable. These are production-module tests, not a real Agent or
installed Electron UI acceptance run; no paid model or live image service was
invoked. `corepack pnpm check`, `corepack pnpm format`, `corepack pnpm run docs check`,
and `git diff --check` passed. The full CLI suite passed 2,834 tests with four
existing skips; Electron passed 120 tests. The packaged-skill materialization
test and authoring build also passed after updating the supplied directory
instructions. Upstream source hashes remain unchanged.

The Spec remains draft. This note does not approve or claim completion of the
separate hooks, continuous preview, or packaged platform acceptance slices.

## Combined desktop lifecycle verification

The combined T01–T04, T09–T11, T23 and T26–T27 build passed the existing real
Electron smoke journeys: 3 scenarios / 18 steps for onboarding, Session stop/delete,
and worktree/terminal cleanup. Electron, preload, IPC and the bundled CLI were real;
the external ACP was scripted and both application data directories and the daemon
endpoint were isolated. This proves those lifecycle paths in the combined
development build, not a commercial model, full canvas-readonly matrix or installed release.

The initial worktree cleanup run correctly retained its directory: Agent and
terminal processes exited, but the newly materialized skills made the old synthetic
clean-worktree fixture dirty. Only that fixture now ignores its two bundled
`graphic-design` skill directories. A deterministic Git check confirms authored
PPTD, artwork media and custom skills remain visible as uncommitted files. The
production dirty-worktree guard is unchanged; no force cleanup or user ignore
configuration was added. The corrected smoke run passed without changing runtime code.
