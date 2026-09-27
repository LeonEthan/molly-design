# Auto-save and manual design version history

Status: implemented
Translation: current

[中文](2026-09-12-design-version-history.zh.md)

## Abstract

The user confirmed Git as the sole design-history backend and canceled a self-built file
snapshot backend. Auto-save of the current artwork is separated from historical versions.
"Save version" records a manually confirmed checkpoint; selecting a historical version from
the canvas toolbar opens it read-only, and "Edit from this version" restores it as a new
current artwork. Geon continues reusing current-artwork validation, save, and draft
protection; Git is not introduced into the Agent creation flow, nor are automatic
commit/push orchestrations reused. An independent local Git repository managed by Geon is
confirmed. (Factual correction: the Git bare-repository history and canvas version UI were
subsequently implemented; evidence and remaining limits are at the end of this record. The
original "not yet implemented, record stays proposed" was the 2026-09-12 decision-phase
state.)

## Scope and basis

On 2026-09-12 the user confirmed the Git history plan and authorized document updates,
replacing the previous scope in the [Spec](../../../../specs/graphic-design-platform.zh.md)
and [migration plan](../architecture/2026-09-09-graphic-design-platform.zh.md) that did not provide
historical versions. This record does not restore candidate approval, branch merging, asset
libraries, per-turn result cards, or historical thumbnails; the user subsequently confirmed
that Geon manages an independent local Git repository isolated from the user's project Git.

This plan connects with [editor autosave updating PPTD](../simplification/2026-09-12-editor-owned-pptd-save.zh.md);
it was later confirmed that auto-writeback is kept along with a public read-before-file
reminder hook. Auto-save maintains working state; manual versioning provides explicit
returnable checkpoints; editor undo/redo continues to use Bento, and the version list does
not replace per-operation undo. Git history is immutable and does not compete with the
current artwork for authority.

## Local code audit

| Existing implementation | Evidence and reuse boundary |
| --- | --- |
| Bento current-artwork auto-save | [product-session.ts](../../../../packages/design-bento/src/product-session.ts) already has changed → schedule → flush → saveOne, returning "auto-saved". No new auto-save mechanism is needed for versioning. |
| Current-artwork and asset save | [store.ts](../../../../apps/cli/src/design/store.ts) embeds assets inside design.json; revisionId is a content digest; designOperation checks baseline and publishes current files under the artwork lock. The digest itself does not keep old files, so it cannot be claimed as existing historical versions. |
| Actual current-artwork location | Current implementation is at `dataRoot/chats/<artworkId>/design.json`; Agent working files are resolved by [workspace.ts](../../../../apps/cli/src/design/workspace.ts) into the session directory or project `.folio/artworks`. Committing to the user's Git project cannot guarantee inclusion of the canonical artwork. |
| Save-as-new-design entry | [design-canvas.tsx](../../../../packages/components/src/components/sessions/design-canvas.tsx) "Save as new design" calls `create` to create an artwork; this is different from creating a version inside the same artwork and cannot be reused by merely relabeling. |
| Lody project branch switching | [local-project.ts](../../../../packages/shared/src/node/local-project.ts) `checkoutLocalProjectBranchAtRootPath` requires a clean worktree and switches project branches; it is not restoring a single artwork. |
| Lody worktree and auto-commit | [worktree rules](../../../../apps/cli/src/session/worktree/AGENTS.md) protect the original project directory; [turn-post-processing-service.ts](../../../../apps/cli/src/session/turn-post-processing-service.ts) auto-commit path prompts the Agent to commit/push again under specific GitHub/PR conditions, which is unsuitable as a local "save version" implementation. |
| Source-project snapshot experience | The adjacent agentic-listing-design `packages/authoring/src/revisions.ts` already has writeSnapshot, listRevisions, loadRevision, commit, rollback, saving documents, assets, and provenance. Its full implementation also includes event logs, traces, candidate forks, etc. Only the needed snapshot/validation experience is borrowed, not moved in wholesale. |

## Recommended interaction

The canvas toolbar shows "Current artwork ▾" and "Save version"; auto-save state continues
to use the existing status hint.

1. Manual edits or a successful Agent commit update the current artwork; auto-save itself
does not create a user version. Clicking "Save version" drains completed edits, captures the
same-version document and assets, and on success shows V1, V2, etc. with creation time. The
first phase does not require a name.
2. The dropdown lists "Current artwork" and saved versions; selecting a historical version
presents it read-only in the existing canvas, with "Edit from this version". Viewing only
does not change the current file or create a snapshot; returning to "Current artwork" resumes
the original work.
3. Clicking "Edit from this version" first ensures the current work is persisted; if the
current artwork has no corresponding saved version, automatically keep a "before switch"
version. If protection fails, do not replace the current artwork. Then restore the selected
historical content as the new current artwork, update PPTD, and rebind the current canvas
state.
4. Original V1/V2/V3 remain unchanged; editing from V1 and then saving a version produces V4,
which can record "based on V1" provenance. The first phase uses a flat timeline, no branch
trees, merges, or worktrees.
5. During execution and artifact processing, historical versions can be viewed read-only, but
cannot be restored or saved as versions; the preview and current-artwork views keep distinct
identities, and a historical selection cannot be sent as a current-artwork reference. Restore
reuses the existing artwork lock and manual-change checks to prevent another window from
starting an Agent at the same time.
6. Restore affects only this artwork and its current PPTD; session records and other project
files are not rolled back. Old Agent drafts and old commit receipts remain; restore does not
automatically give them a new submit baseline or make them new artifacts.

The "before switch" protection version is an explicit exception to avoid losing auto-saved
work; it is not expanded to auto-saving history on every edit or every turn. Read-only
history viewing has no relation to independent candidate approval and does not require
pre-generated thumbnails.

## Storage comparison and decision

| Approach | Reusable advantages | Extra cost | Recommendation |
| --- | --- | --- | --- |
| Immutable snapshots beside existing artwork storage | Can reuse full payload, validation, and save | Requires building separate history files and index maintenance | Canceled, not implemented |
| Geon-managed independent local Git repository | Git saves complete history, isolated from user branches | Repository initialization, reference management, packaging dependency, plus thin UI/restore adapter | Confirmed adopted |
| Reuse user's project Git | Uses existing Git project and object storage | Non-Git project support, staging/branch isolation, canonical inclusion scope, and version references all need clarification | Compared against independent repo; choose one organizational approach |

Git's [object model](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) can express
snapshots; [git show](https://git-scm.com/docs/git-show) can read historical content without
switching the whole worktree. [git-worktree](https://git-scm.com/docs/git-worktree) manages
multiple worktrees, which is not a basic operation for restoring a single artwork. During
implementation, read the specified historical content and then use Geon's controlled restore
entry; do not replace the artwork through project-level reset/checkout, nor invoke existing
auto-commit/push model flows.

Git versions can reuse the current self-contained payload to save BentoDoc, exact
assets/fonts, and format version; version numbers, creation times, and provenance are
generated from Git commits/references and necessary metadata. Historical PPTD is derived from
that payload; no second commit-capable history is built. Images cannot merely reference
current media paths that may be replaced or deleted. Save-version and restore each validate
the actual version; visible versions must be complete, failures do not lose working drafts,
and a failed restore load must not pretend the disk state was unsaved.

Images and fonts must enter the same Git history backend; layout choices must be evaluated
against real proofs and version counts, without claiming unlimited history or that Git
necessarily compresses images well. No self-built asset backup library, garbage collection,
or Git-LFS system is added for history; current-artwork asset storage retains its
responsibility.

## Boundaries after choosing Git

Git is selected as the only history backend, mutually exclusive with "snapshots beside
existing artwork storage". File history has not been built before, so this cancels building
that backend rather than deleting existing current-artwork storage code.

| Capability | After choosing Git |
| --- | --- |
| Self-built immutable history directory, historical snapshot publish/read | Not built; Git objects and commits save complete historical content |
| Independent authoritative version list/version index library | Not built; version list is generated from managed Git commits/references and necessary metadata, and caches must be rebuildable |
| Another backup/object library for historical assets | Not built; exact asset bytes enter the corresponding Git version with the design content, not just current media paths |
| Current-artwork auto-save and PPTD update | Kept. They provide uncommitted working state; Git history does not auto-save for the user |
| Current-artwork structural validation, concurrent version checks, and full publishing | Kept. Git commits only guarantee stored objects are addressable, not that they captured all files of the same edited version |
| Version selection, read-only history viewing, controlled restore, and draft retention | Kept as thin product adaptation; historical content is read from Git, not copied into another long-term snapshot system |

Managed by Geon, the independent local Git repository supports ordinary non-Git projects;
user project branches, staging areas, and unrelated content are unaffected. Manual "save
version" writes validated consistent content as a Git version; version identity uses its
commit ID, and displayed numbers/times are generated by the list; after creation it must be
kept by a stable reference, not only unreachable objects. The pre-restore "before switch"
protection also uses the same Git backend, without a parallel backup system.

Daily edits only update the current artwork; saving a version is what creates a historical
commit. History viewing renders from Git objects; editing from an old version restores that
version's content as the new current artwork through existing validation, and subsequent
versions continue to append commits; historical references are not moved to discard later
versions. Current-artwork CAS identity and Git history commit ID have different
responsibilities and cannot be mechanically interchanged. Temporary consistency
snapshots/publish staging directories may still be needed, but they are not a second
persistent history library.

The earlier cost comparison should be understood accordingly: Git's integration cost
replaces self-built history objects, indexes, and retention mechanisms; it is not layered on
top of a file-snapshot backend. Only one history backend is implemented, with no dual-backend
abstraction or dual-write.

## Principles and verification limits

This feature is user-initiated save and restore of document state; it does not prescribe the
Agent creation flow or depend on new runtime hooks. Recommended button label is "Save
version"; "version" fits the dropdown entry, "archive" may be confused with session archive,
and "save as" is easily confused with creating a new artwork.

During the decision phase, the confirmed Git history decision was written into the formal
Spec, migration plan, and root rules; the Spec remains draft, and this record stays proposed.
Repository organization is confirmed; runtime implementation and acceptance were not yet
complete. That decision phase did not modify runtime code, create Git history repositories,
open Issues, run product tests, or perform performance measurements; subsequent
implementation is in the section below. Evidence of existing auto-save source code does not
equal the previous separate proposal of auto-updating PPTD having been implemented.

## Implementation progress (2026-09-12, incomplete)

An independent Git history backend and existing worker/IPC integration were started: each
artwork uses a `history.git` under the current-artwork directory, saving complete
documents/assets as Git objects and managed references; it does not use the user's project
staging area, branches, global Git config, remotes, or hooks. Ordinary saves do not create
history. Read-only viewing verifies the version belongs to that history; restore first
protects the current content of the unsaved version in the same Git history, then saves the
original current artwork via CAS. Concurrent version changes, missing/redirected history are
rejected and the current artwork is kept; display and disk-save failures are handled
separately.

Five deterministic tests against real local Git verify that viewing an old version does not
change the current artwork, pre-restore protection, subsequent version appending, stale
restore rejection, artwork isolation, directory-redirect rejection, PNG/WOFF2 raw byte
retention, repeated restore, keeping current artwork when protective Git publish fails, and
PPTD roundtrip after restore. Repeated restore compares exact content; the content digest is
not treated as a current-artwork revisionId that carries artwork association information.
The test suite plus two Agent-reminder/MCP wiring combination checks passed 16 items; the
Electron main process and UI type checks passed; logs at `/tmp/folio-history-integration-tests.log`
and `/tmp/folio-history-electron-typecheck-4.log`. Early repeated-restore failures are kept
in `/tmp/folio-history-tests-2.log` and were fixed.

Version selection and "Save version / Edit from this version" were wired into existing IPC
and read-only renderer. History has no file watcher, cannot use external preview import, and
cannot provide current-artwork selections; the current editor is hidden to preserve undo
state, and a new current artwork is loaded only on explicit restore. During execution the
button visibility follows presence, but real changes are still rejected by the existing
daemon artwork gate for active/unknown states. Git uses Lody's existing system executable;
when missing it reports the error truthfully and does not fall back to a second storage.

A real built OSS Electron UI round `/tmp/folio-history-ui-nDwlNI/result.json` verified:
saving V1/V2 via the button, historical versions visible and showing original elements,
current editor hidden and undo/redo still available after returning, explicit restore first
creating a "before switch" version, then editing and saving as V4, and after app restart and
reopening the artwork all four histories remain. Independent canvas screenshot
`history-canvas.png` and UI screenshots remain in that round directory; the harness cleaned
up its processes and endpoints, handle 80370 exit 0. Two early probe failures were a
non-unique button locator and failure to navigate to the artwork after restart; kept at
`/tmp/folio-history-ui-probe.log` and `/tmp/folio-history-ui-probe-2.log`; the third round
passed after probe correction, without hiding the failures.

That built package included Codex/Pi MCP and this feature, not yet the subsequent auto-writeback
change; it cannot be claimed that the native combined round of the new save contract was
complete. After auto-writeback and Git history were combined in source, 69 targeted checks
passed; after adding post-restore PPTD and protective Git publish failure tests the full
check passed, logged at `/tmp/folio-editor-save-history-fullcheck.log`. Tests prove the
restore operation actually updates the same-version PPTD, but cannot replace combined
package verification. Multi-instance real interaction, normal packaged builds, full visual,
and image-generation acceptance remain pending; P4.6/P6.6 must not be claimed complete, and
this record stays proposed.

Subsequent exact combination `c683038` rebuilt and completed
`/tmp/folio-history-ui-3hA6WO/result.json` (handle 2549 exit 0): after each manual edit and
save, it directly reads disk current artwork, PPTD marker, and pages to check version/
elements, without first calling a read IPC that might repair the projection; the native
history-edit button cannot change content, and after restore the current PPTD is the same
version, with V1/V2/before-switch/V4 and restart re-read all passing. Electron/CLI and
endpoints were cleaned up normally by the harness; no model was called. This completes the
built OSS auto-writeback combination evidence, but still does not replace normal package,
real image vendor, or manual full-journey acceptance.

A normal macOS arm64 package `50ddd41bfb3e88537c0dcbec40c0ce86ca40b8e4` subsequently passed
the same version UI, read-only history, current-artwork/undo-stack retention, protection
version, post-restore PPTD, continued editing, and exit/reopen verification. DMG checksum,
read-only mount copy, and signature verification passed; private install directory was
`folio-current-50ddd41b-78c0b9vz`, and package identity is recorded in that directory's
`package-identity.json`. Package round `/tmp/folio-history-ui-S9u0fO/result.json` (handle
73932 exit 0) boot-state confirmed `isPackaged: true`, installed-source recorded the exact
commit above, and after closing endpoint-release, directory-cleanup, and finished all
completed. This round had no model calls; it completes normal package version-operation
evidence. Multi-instance and real multi-image load, manual visual/editing evaluation remain
separately pending.

## Evidence and remaining limits

**Factual correction**: Early sections of this record stated "not yet implemented at
runtime, record stays proposed"; that state has been corrected to `Status: implemented`.
Implementation evidence includes:

- Git history backend: `apps/cli/src/design/history.ts` saves complete `design.json` and
  embedded assets per artwork in an independent `history.git` bare repository;
  `history.test.ts` covers version appending, pre-restore protection, asset byte retention,
  conflict rejection, redirect rejection, and PPTD roundtrip.
- IPC/UI: `apps/electron/src/main/ipc/services/design-ipc.ts` exposes `versions`,
  `saveVersion`, `restoreVersion`, and `viewVersion`;
  `packages/components/src/components/sessions/design-canvas.tsx` provides "Save version",
  "Edit from this version", and read-only history dropdown in the canvas toolbar.
- The version UI combined with automatic PPTD save has passed built OSS and normal package
  verification.

Remaining limits: full verification of cross-instance concurrency (e.g., instance A saves a
version while instance B restores simultaneously) has not been run; see the pending
verification items in `specs/graphic-design-platform.zh.md`. Multi-instance real interaction,
real multi-image load, manual visual/editing evaluation, and normal-directory/Windows/Linux
runtime dependency supply remain pending for subsequent acceptance.
