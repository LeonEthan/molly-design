# Serial human and Agent editing of the same artwork

Status: implemented
Translation: current

[中文](2026-09-11-design-serial-editing.zh.md)

## Abstract

Earlier plans allowed continued human editing of the same canvas during Agent creation,
making human-Agent conflict a routine user flow. The confirmed direction now switches to
serial editing: human edits are saved before dispatch, and the owning canvas is read-only
until Agent execution and artifact processing end, after which editing resumes. The
application reuses Lody's execution state and controls generic canvas read-only capability;
Bento does not plug into the Agent lifecycle. Reverse sync and version protection remain;
file conflicts are handled by the Agent. The trade-off is that the user cannot manually edit
the same artwork while it is being generated; other artworks remain editable. Existing
conflict save-as remains as an abnormal-concurrency copy escape hatch. (Factual correction:
the serial-editing boundary was subsequently implemented by T02; see the Outcome at the end
of this record. The original "not yet implemented at runtime" was the proposal-phase state.)

## Replaced agreements

This decision replaces the goal of simultaneous human-Agent modification of the same artwork
in the [main plan](2026-09-09-graphic-design-platform.zh.md), [read sync](../../rejected/architecture/2026-09-10-design-sync-hooks.zh.md),
and [live preview](2026-09-11-pptd-live-preview.zh.md). The product contract is updated in
the [Spec](../../../../specs/graphic-design-platform.zh.md); P1/P2 historical implementation
records are kept. It supplements the [scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)
without restoring result cards or dedicated thumbnails.

## Minimum execution boundary

| Phase | Application behavior |
| --- | --- |
| Idle | Normal human editing, save, and export |
| Preparing dispatch | Pause new human changes for the owning artwork, flush and confirm pending saves; on success freeze version, selection, and input, then start the Agent |
| Save/start failure | Keep input and edits; after confirming no running task, restore editing without silently discarding drafts |
| Agent execution | All canvas instances of the owning artwork are read-only; viewing, zooming, switching views, and canceling are allowed; after commit they reference the current artwork; other artworks remain editable |
| Tool/permission wait or cancel handling | Stay read-only; issuing a cancel request does not mean the task has ended |
| Collection/commit after Agent ends | Stay read-only, reuse formal validation, commit, or file-conflict diagnosis; do not unlock after the last text output |
| Result processing ended | Refresh the committed current artwork, or keep the original artwork and provide draft location and ordinary error feedback, then restore editing; failure/cancel does not auto-commit a preview |
| Disconnect, close, and reopen | Do not unlock because the view disappeared; on restore first check real execution and result-processing state, stay read-only if unknown and show status. After confirming no task and no in-flight commit, restore editing |

This rule applies by artwork/actual associated workspace, covering the discussion turn of
that artwork, not guessing from prompts whether an image will be changed. Queued turns that
have not started re-save and fix baseline before actual dispatch; overlapping execution on
the same artwork uses existing queue/rejection mechanisms. Late end messages from old turns
must not unlock new turns; no separate task scheduler or persistent lock platform is added
for this feature.

Read-only covers text input, properties, drag, paste, image replacement, delete, size
changes, and undo/redo. Human save, import, and other service entry points execute the same
check; do not rely only on the current window's buttons. Pending saves before entering
read-only must be drained or explicitly rejected before fixing the Agent baseline; in-flight
composite input must not be lost either. Agent writes to drafts and this turn's formal
commit remain allowed and must not be mistakenly blocked by human-write restrictions.

The application plugs into read-only via generic parameters, snapshots, and save interfaces;
Bento does not read Agent state. Read-only identity and lifecycle reuse existing artwork
association, execution, and result-processing facts; no disk commit lock is held for the
entire model execution, and atomic locks only protect actual save/commit operations.

## Keep and remove

| Capability | New plan |
| --- | --- |
| Reverse sync | Keep. Manual editing happens before the turn; the Agent still must get the latest PPTD when reading; read-only itself does not update files |
| Projection/draft separation and read baseline | Keep. Re-reading in the same turn cannot overwrite Agent drafts or implicitly change baseline |
| Final version check | Keep. External programs, old requests, or uncovered windows may still change state; UI read-only is not a filesystem sandbox |
| Routine human-Agent conflict coordination | Remove this normal product scenario; validation shifts to rejecting human modification during execution |
| Existing manual conflict save-as | No longer expanded into a daily collaboration feature; temporarily kept as abnormal copy escape hatch. Merely prohibiting modification during Agent execution cannot prove that multi-window/external modification no longer happens when idle; complete removal requires first clarifying the copy escape hatch |
| Candidate workflow | Confirmed removed. Modifications and regeneration are committed uniformly; conflicts are handled by the Agent re-reading files, and external files are explicitly imported after preview; existing content remains reachable |
| Old-PPTD auto-candidate | Confirmed removed per P3.0d; serial editing does not mean an old file came from this turn. Keep existing files/candidates and real new-artifact protection |
| Current artwork and creation preview | Keep both sources. During execution both are read-only: the former is saved, the latter is uncommitted; switching between them is allowed |
| Agent render preview and image reading | Keep; does not depend on whether the user canvas is editable |

The subsequent 2026-09-11 [overall convergence](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md)
further removes the candidate flow and temporary preview-element reference requirements;
this does not change the read-only lifecycle, and the manual save abnormal copy is not
removed in this round either.

## Implementation and acceptance

P3.0e carries the serial boundary; P3.1 still implements reverse conversion and hooks, P3.7
implements live preview, P4 plugs in read-only hints and entry states, and P6 validates the
full chain. Conversion and listening can be developed independently, but user-path integration
acceptance must follow the new serial boundary.

Acceptance uses existing deterministic facilities, covering: pre-dispatch save
failure/in-flight save/composite input; text, properties, drag, undo entry points;
multi-instance and other-artwork unaffected; permission wait, cancel, failure, commit failure;
disconnect/reopen, late end, subsequent turns; import cannot bypass read-only; old candidate
content remains readable; abnormal external modification is still rejected by version checks
and unsaved content is kept. During execution the user can view previews and let the Agent
read images; after result processing editing is restored. If abnormal dirty state is found,
keep content and report error; do not clear by reloading.

This round does not run product tests or model calls, and does not claim existing runtime
races are solved. Only document consistency, links, size, and public boundary checks were run;
the Spec remains draft, and this decision and phase stay proposed.

## Outcome

**Correction**: The end of this record originally stated "not yet implemented at runtime"
and "this decision and phase stay proposed"; that fact has been corrected by subsequent
implementation. T02 implemented the serial-editing boundary of this record; evidence is in
[canvas save handshake and read-only during execution](2026-09-11-canvas-serial-execution.zh.md)
and the source files `apps/cli/src/design/canvas-host.ts` and
`apps/electron/src/main/services/design-canvas-access.ts`. The rest of the design
constraints, trade-offs, and historical context in the original text are kept and not
deleted.
