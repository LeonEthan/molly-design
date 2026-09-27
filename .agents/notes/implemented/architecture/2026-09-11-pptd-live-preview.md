# File-change-driven live PPTD preview

Status: implemented
Translation: current

[中文](2026-09-11-pptd-live-preview.zh.md)

## Abstract

PPTD is currently converted mainly at turn-end collection or when the Agent requests a
preview, making it hard for the user to see the latest valid result of a file while it is
being created. This plan establishes an on-demand file subscription for the opened design
preview, reusing existing collection, PPTD import, and Bento rendering to update an
independent read-only preview. File changes do not mean the artifact is complete, nor do
they commit the current artwork; the design-read hook and final version check keep their
original responsibilities. In the first phase, results are viewed during execution while the
owning current artwork is also read-only; after processing completes and commits, editing
and the current-artwork reference are restored. External files are previewed and then
explicitly imported while idle, without creating candidates; cross-file reads can only
verify observed stable states and cannot infer that the author has completed a set of edits.

## Relation to existing plans

The direction is reasonable and can be included in P3; this round only revises design
documents and the phase plan, without runtime code implementation. It supplements the
[sync and hook decision](../../rejected/architecture/2026-09-10-design-sync-hooks.zh.md),
without replacing read baseline, draft isolation, or canonical atomic commit. The product
contract is expressed in the [Spec](../../../../specs/graphic-design-platform.zh.md); work
breakdown is in the [phase plan](2026-09-09-graphic-design-platform.zh.md).

| Boundary | Sole responsibility |
| --- | --- |
| File subscription and preview conversion | Watch creation PPTD and dependency bytes, generate read-only Bento preview |
| Read hook | Generate PPTD projection from the current artwork including manual edits, record successful read baseline |
| Write hook | Check read baseline for controlled writes to existing designs |
| Formal collection/commit service | Decide turn artifacts, structural validation, atomic current-artwork version check, and persistence |
| Bento canvas | Independent editing, rendering, generic snapshot/flush; does not manage Agent lifecycle |

File notifications cover Write, Edit, patch, Shell, scripts, and external editors; no
per-Agent preview implementation is needed for the five Agents. Tool completion can only
supplement refresh. This uses file-driven development-tool responsibility division, without
introducing Vite, HMR protocols, or a new Agent scheduling system.

## Reuse basis and actual gaps

- [buildPreviewPayload](../../../../apps/cli/src/design/render-preview.ts) already reuses
  `collectAuthoring → intakeAuthoring` to build a preview payload containing document and
  assets without committing the current artwork. [intakeAuthoring](../../../../packages/design-authoring/src/intake.ts)
  validates fixed bytes, binds assets, and calls importPptd (`06aa8ba:packages/design-authoring/src/import.ts`).
  Continuous preview reuses this conversion chain; collection and caching can be extended
  within existing design modules without copying validator/importer.
- [collectAuthoring](../../../../packages/design-authoring/src/collect-authoring.ts) already
  has path whitelist and link checks, but currently reads `design.pptd`, `pages/`, and
  `media/` per file, with no cross-file transaction or whole-collection before/after
  stability check. Its existing Map return or debounce cannot be directly called a
cross-file atomic snapshot; a restricted dependency closure and read-stability mechanism
  must be added.
- [WorkspaceWatchCoordinator](../../../../apps/cli/src/lib/code-collab/workspace-watch-coordinator.ts)
  already has root-directory shared subscription, release, generations, and watcher error
  handling; [watch plan](../../../../apps/cli/src/lib/code-collab/workspace-watch-plan.ts)
  currently still recursively watches top-level directories except ignored ones. First
  evaluate adding precise target subscription/extracting a reusable lower layer to this
  infrastructure; do not directly enable Code Collab indexing, All Changes, or full
  workspace scanning, and do not copy another broker/process-recovery system.
- [FilePreviewService](../../../../apps/cli/src/lib/file-preview/file-preview-service.ts)
  explicitly handles single-file reads and does not start a workspace watcher; keep that
  boundary. The design service carries PPTD-project subscription and conversion; the desktop
  reuses the [Bento host](../../../../apps/electron/src/main/services/design-service.ts)
  rendering resources and controlled bridge; specific read-only payload integration awaits
  P3 verification. Do not convert every change into a `geon_render_preview` MCP call or PNG
  file generation.

## Subscriptions by consumer

1. When opening live preview, identify the artwork, canonical workspace path, creation entry,
   and source identity; establish the watch first, then read and verify the initial files,
   covering the subscription initialization window. Opening the editable current artwork
   itself does not require watching all creation files.
2. Consumers of the same workspace/creation entry share the watcher and conversion result,
   each bound to a subscription generation. After the last consumer leaves, release the
   subscription, tasks, and temporary assets; disconnected windows must also be released by
   existing connection lifecycle. Historical workspaces with no consumers are not watched or
   converted.
3. Valid targets are limited to `design.pptd`, referenced pages, and necessary asset
   directories. To discover first creation, atomic rename replacement, deletion-recreation,
   and missing references, allow watching the nearest legal parent directory of these targets,
   non-recursive and filtered; do not expand into full-workspace recursive watching because a
   file is temporarily missing.
4. When referenced images change, rebuild the restricted target set, re-verify after
   establishing new target watches, then release old target watches. During an invalid
   manifest, keep the last known targets and necessary parent directories and wait for a fix;
   notifications do not carry trusted path authorization, and all reads continue to enforce
   existing path, type, size, and resource limits.
5. On reopen, reconnect, and active refresh, re-verify files; after a consumer's turn ends,
   perform one additional verification. Background turns with no consumers use existing
   formal collection only and do not start the preview chain.

## Snapshots, update ordering, and failures

File events are only dirty signals. Merge consecutive events and build a digest for the
current dependency set and file content; reconvert only when bytes or dependencies change.
Byte changes of same-named assets must also trigger updates; do not compare only filenames,
sizes, or modification times. The merge strategy includes a maximum wait ceiling to avoid
continuous writes indefinitely delaying attempts, but it does not require converting every
write event.

When reading, reuse safe collection; before and after reading verify the dependency set and
content, and re-collect limitedly if necessary; hand the confirmed byte Map to the same
intake and rendering payload. Conversion and rendering use captured asset bytes, not
re-reading assets from the changing directory. Continuous changes must not block CLI session
processing: limit one in-flight conversion per project, keep only the latest pending request,
and verify execution budget; specific isolation should prefer reusing existing resources.

"Consistent" here means input that is fixed for one pass, dependency- and
structurally-validated, and not observed to change during re-verification; it **does not
promise atomic transactions for arbitrary external multi-file writes**. Even if two
collections are identical and content is valid, the author may simply have paused at a valid
intermediate draft; previewing it is allowed, but it cannot be declared complete. If future
requirements demand author transaction consistency, a producer publish protocol must be
designed separately and not replaced by hooks or a forced finalize flow.

Each input change increments a request generation; before publishing conversion and
rendering results, re-verify source digest, artwork, and subscription identity so that old
results cannot replace newer request results. After a consumer closes, switches, or
reconnects, old tasks must not publish even if they complete. Asset caching is isolated by
content and snapshot identity to avoid old cached images at the same path polluting a new
preview.

When reading is unstable, the document is temporarily invalid, or assets are missing, keep
the last valid preview and clearly show "updating/waiting for valid files"; the source digest
is used only for internal consistency checks and does not need to be shown to the user. When
there is no valid result yet, show a waiting state; do not disguise a blank current artwork
as a live result. The last valid preview is not a success promise for the latest file.
Continuous format errors, permission denials, out-of-bounds, or resource over-limit provide
visible diagnostics, do not busy-retry, and do not bypass validation.

When watching fails, show that auto-update is unavailable and provide a manual refresh
entry; reconnect, reopen, and turn-end compensate for missed notifications through active
verification. Do not promise the watcher never loses events, and do not poll all workspaces
for compensation. Preview failures affect only that consumer's visible state; they do not
fail the Agent turn, auto-fix files, or retry the model; formal collection and commit remain
independent.

## Confirmed UI and direct-import boundaries

This section is revised together with [serial editing](2026-09-11-design-serial-editing.zh.md)
and the [overall convergence](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md);
the old candidate create/adopt flow is no longer an implementation target, and runtime code
has not changed.

- Distinguish "saved current artwork" from "creation read-only result" in the existing
canvas area; do not build a separate preview management page or another editor. Label
  Agent/external editing only when the source is verifiable; do not guess the author from
  file events. Switching keeps the current-artwork editing instance, unsaved content, and
  undo state.
- During execution and artifact processing, viewing, zooming, switching, and canceling are
  allowed, but all instances of the owning artwork prohibit human changes and import; other
  artworks are unaffected. The first phase does not expand interactions that reference
  temporary previews during execution; after formal commit, select current-artwork elements
  and continue editing. Read-only does not mean the Agent itself cannot read images or
  process files.
- After the Agent completes, keep read-only until formal collection/commit ends; a safe
  commit directly shows the new current artwork and restores editing, without adding an
  adopt confirmation. Conflicts, failures, and cancellations keep the original artwork/draft
  and show real diagnostics; subsequent continuation follows ordinary explicit session
  continuation, and the application does not auto-fix or continue running.
- When there is no running turn and no pending processing, external PPTD is previewed and
  then explicitly "imported as current artwork" once. Reuse flush, structural/asset checks,
  and atomic save; do not first create a candidate and then adopt/reject, and do not add a
  new artwork-directory import product.
- Import uses the exact document/asset snapshot the user has seen and the version of the
  replaced current artwork; handle unsaved modifications first, and keep content on failure.
  Source file changes afterwards cannot swap the input; if the original snapshot cannot be
  used, re-present and let the user explicitly import again. Import does not fabricate an
  Agent read fact; repeated requests follow save idempotency semantics.
- Preview does not auto-save or formally export; export is based on the saved current
  artwork. Compatible reading of existing candidate content is handled by P3.4 or through
  the same explicit import path; no separate candidate UI is kept.

## Preventing sync loops

Only subscribe to Agent/external editing creation entries and dependencies; PPTD
projections generated from the Bento current artwork, formal storage, preview caches, and
rendering output do not enter that creation subscription/artifact collection entry. Reuse
the planned projection/draft isolation instead of relying on a temporary `ignoreNextEvent`
boolean to guess which event came from the application. After the Agent explicitly uses a
projection as a new creation draft, observe and validate it under the new draft identity.

Even if an application write signal is mistakenly received, source classification and lack
of commit side effects still block "reverse sync → watch conversion → commit again". Preview
does not update read baseline, turn manifest, current-artwork version, or completion state.
At turn end, re-collect, validate, and commit; do not skip checks because a preview already
exists; only verified identical computation results may be reused, not commit authorization.

## Phases and validation

P3.7 implements on-demand subscription, stable byte collection, conversion scheduling,
read-only presentation, and direct external-file import; P4 completes state, switching, and
import interactions; P5 cleans up while keeping watcher infrastructure that still has
consumers; P6 validates the actual packaged build. P3.7 can first reuse existing forward
conversion to complete a slice, without requiring all five hooks or reverse conversion to be
finished; the projection/draft source boundary must first align with P3.1.

Acceptance covers: step-by-step/same-content writes, same-path asset replacement, atomic
rename, dependency add/delete/missing, continuous writes, watcher loss/failure, multi-consumer
release, old conversion/old window late arrival, limited resources, external editing,
background turns with no consumers, coexistence of preview and read-only current artwork
during execution, pre-dispatch save failure, cancel/disconnect-reopen/old events not
unlocking early, restoring editing after completion and protecting abnormal unsaved content,
and explicit import after source changes, as well as sync projections not creating loops.
Plan with existing deterministic test facilities using injected notifications and controllable
task completion order, without real sleeps or event timing; real-platform file-watching
evidence is recorded separately.

This round only performed source and plan review, without running product tests, builds,
Agents, or real file watching. Preview payload, watch infrastructure, and collection limits
are source evidence; continuous preview itself was not yet implemented. Subsequent scope
rulings removed P2.7 #2b old-file auto-candidate per P3.0d; P2-A3 remains an independent
adapter, and reference-pack first phase clarifies the script limitation, normalized as an
optional improvement.

Documentation verification: `corepack pnpm run docs status` / `docs check` reported no errors,
20 pre-existing size warnings, and no registered SHA topic; `corepack pnpm check:public-boundary`
and `git diff --check` passed. The Spec remained draft, and the plan/decision stayed proposed,
with translation pending.

Pre-commit verification: `corepack pnpm format`, `corepack pnpm typecheck`, and `corepack pnpm check:quick`
passed; unrelated test-file diffs caused by formatting were reverted. Per the no-product-tests
requirement this round, the full `pnpm check` including tests was not run, and actual
preview/watch acceptance was not performed.

2026-09-11 scope review supplement: retiring generic result cards and per-turn thumbnails
does not affect this chain, nor does it affect Agent-initiated rendering and image reading.
The candidate workflow has already been retired by the overall convergence decision; this
chain directly reuses atomic save; no candidate panel or persistent preview history is
built. P2.7 #2b old-file auto-candidate was confirmed removed per P3.0d; that removal does
not need to wait for this preview chain to go live, and old files and existing candidates
are kept. This plan carries explicit file preview/import and was not yet implemented. See
[migration scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md).

## Outcome

**Correction**: Several places in this record stated "no runtime code implementation",
"continuous preview itself not yet implemented", and "this plan carries explicit file
preview/import and was not yet implemented"; that fact has been corrected by subsequent
implementation. Live preview and explicit import were implemented by
[automatic PPTD preview](../feature/2026-09-11-automatic-pptd-preview.md),
[manual PPTD preview](../feature/2026-09-11-manual-pptd-preview.md), and
[direct preview import](../feature/2026-09-11-direct-preview-import.md), and wired into the
canvas version UI. The rest of the original design constraints and source reuse boundaries
are kept and not deleted.

**Later change:** Preview subscriptions and idle explicit import now follow the YAML
entry in [YAML authoring preview](../feature/2026-09-14-yaml-authoring-preview.md)
([#39](https://github.com/LeonEthan/Geon/issues/39)). This note remains the PPTD-era
live-preview decision and is not rewritten into its opposite.
