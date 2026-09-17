# Design migration scope review and result-card retirement

Status: proposed
Translation: current

[中文](2026-09-11-design-result-feedback.zh.md)

## Abstract

This review examines P0–P6 against the adjacent project's design experience and Lody's
reuse boundaries, confirming the retirement of result cards, dedicated thumbnails, old-file
auto-promotion, and forced creation steps. Subsequent discussion further removed the
candidate create/adopt/reject workflow: conflicts are handled by Agents through files,
external files are explicitly imported after preview; rendering, image reading, atomic
saves, old content, and receipts remain. Bento semantic roundtrip needs minimal format
adaptation, and the image MCP needs edit support and the removal of a default model; these
cannot be mistaken as fully reused. Specific decisions and implementation costs are in the
[workflow convergence record](2026-09-11-design-workflow-convergence.zh.md); this record
keeps the source investigation and conclusion correction. Only documents were changed;
retirement and new adaptation are not yet implemented.

## History and current facts

- The first plan commit `b660bb34f3bf3d0cd28d7a86dddbc1c7c271ee46` already proposed
  "artwork cards"; P2.5 explicitly required "real result cards and canvas positioning";
  the original Spec required candidate adopt/reject and failure states to be visible, but
  did not specify card form. Verify with
  `git show b660bb3:.agents/notes/proposed/architecture/2026-09-09-graphic-design-platform.zh.md`;
  the current entry is the [phase plan](../../implemented/architecture/2026-09-09-graphic-design-platform.zh.md).
  This proves it came from the plan, not that the form itself was separately approved.
- `a09858632afaf2a9d1929af95f593308951d8ae9` implemented P2.5 cards and candidate
  actions; `baed947b6f16263cb6a2f8f37e10f1695d146fe0` added P2.6 thumbnail references.
  These were not unplanned additions during P2 development.
- The [message rendering entry](../../../../packages/components/src/components/ai-gui/view.tsx)
  mounts the card under the user's turn in design sessions; the [state parser](https://github.com/LeonEthan/molly-design/blob/a09858632afaf2a9d1929af95f593308951d8ae9/packages/components/src/lib/design-turn-result.ts)
  reads persistent `designOutcome` and provides a live display, with states committed,
  candidate, invalid, no_artifact, failed, cancelled.
- The [card component](https://github.com/LeonEthan/molly-design/blob/a09858632afaf2a9d1929af95f593308951d8ae9/packages/components/src/components/sessions/design-turn-result-card.tsx)
  reads candidate state and thumbnail, provides positioning, adopt, discard, and
  user-triggered fix. Fix goes through the ordinary `dispatchPrompt` in
  [session-chat-interface](../../../../packages/components/src/components/sessions/session-chat-interface.tsx),
  not automatic repair or a private Agent channel; the card does not perform semantic
  quality review.
- [Thumbnail generation](https://github.com/LeonEthan/molly-design/blob/baed947b6f16263cb6a2f8f37e10f1695d146fe0/apps/cli/src/design/thumbnail.ts),
  [reading](https://github.com/LeonEthan/molly-design/blob/baed947b6f16263cb6a2f8f37e10f1695d146fe0/apps/cli/src/design/thumbnail-read.ts),
  and optional references in the shared outcome are maintenance surfaces beyond display.
  They reuse the existing rendering bridge, not a second renderer; no measured data proves
  their cost unacceptable, and reuse alone does not make the requirement deletable.

## Required information and presentation forms

| Existing content | Actual purpose | Current plan disposition |
| --- | --- | --- |
| Submission result | Agent saying done ≠ storage committed | Keep trusted feedback as a short record / canvas state in the session; no standalone card required. |
| Generating, failed, cancelled | Reflect execution state | Prefer reusing existing Lody states; avoid repeating the same turn state. |
| No design artifact | Describes the fact that the artwork did not change | Ordinary consultation may also have no artifact; do not default to treating it as an exception or a mandatory per-turn notice. |
| Candidate adopt/discard | Historical implementation kept regeneration/conflict results | Latest decision removes new candidate workflow; old content remains readable, conflicts handled by Agent, external files imported directly. |
| Structural validation diagnosis and fix | User knows why not committed and can continue the conversation | Show on exception, use ordinary input/send path; no dedicated fix workflow. |
| Open current artwork | Navigation between conversation and artifact | Reuse existing sidebar positioning or lightweight artifact link. |
| Per-turn thumbnail | Quick visual review of historical results | Out of migration scope; remove dedicated generate/readback chain, keep Agent rendering and image reading. |

Derived-state principles must be used by fact type: a turn's committed/failed event is a
historical event and cannot be reliably reconstructed from the current artwork. Old
thumbnails likewise cannot be restored from the latest artwork; they have left product
scope. New versions only need to tolerate old fields, not keep producing historical visual
receipts.

"Delete the card" does not mean delete `designOutcome`, submission receipts, or existing
content. Turn facts are still used for idempotency and recovery; removing the UI must check
consumers; existing candidate content/assets should be reachable through controlled file
entry, not by building new candidate panels or continuing to create candidates.

## Agent-naive and reduction principles

Under the repository's agent-naive definition, the app may honestly expose files, storage
state, and user actions. The current card does not require the Agent to call a specific
tool, accept the card's semantic evaluation, or follow fixed generation steps; its mere
existence as dedicated UI does not violate that boundary. What is questionable is the
product assumption of organizing every turn around a "design output"; it may add useless
feedback to discussion turns and is a design trade-off to be validated, not a proven
runtime defect.

The user then explicitly pointed to the adjacent agentic-listing-design repository rules.
The current local `AGENTS.md` does not directly mention Raptor3, but its opening requires
"Prefer the smallest end-to-end implementation that meets the current requirements" and
"Before handoff, remove mechanisms without a current purpose"; its referenced architecture
§3 further requires derived states to be recomputable by default rather than persisted,
fields/states/protocols that exist only for possible future needs to be deleted by default,
only the current-minimum form within a phase, scenario knowledge to live in skills, and
Agents to finish autonomously before checking artifacts. This review applies those project
source texts as the design basis, without automatically transplanting the adjacent
project's full architecture or export governance contract into Molly Design. Public method
background is in the
[Everyday Astronaut first-hand interview summary](https://everydayastronaut.com/starbase-tour-and-interview-with-elon-musk/).

The key question after applying this thinking: after deleting the dedicated result card,
can the user still find the current artwork, confirm submission results, discover errors,
and read legacy artifacts? Existing sessions and the canvas have the foundation to carry
those entry points. P3.0/P3.4 first guarantee access to current artwork, errors, and old
content files before retiring the card; the latest goal does not require human handling of
new candidates. Code reuse and completed states cannot substitute for a necessity
argument; moving the card unchanged to the sidebar is not a real reduction of
responsibility or maintenance surface.

## Recommendations and verification limits

The user confirmed the retirement direction and asked for it to be written into documents.
P3.0 splits generic entry, dedicated-link removal, and retained-capability acceptance; the
original P3.3 minimal-candidate entry goal has been replaced by the overall convergence
(decision: Agent handles conflicts), and P3.4 ensures old content reachability. P4 removes
artwork thumbnails; P6 verifies that rendering and image reading still work without cards.
P2.5/P2.6 historical implementation records are kept with markers that they were replaced
by the new scope; the formal plan and Spec are updated; runtime code has not changed.

This round only reviewed Git history, source code, and the public interview; no product
tests, builds, or UI experience validation were run. It did not claim repeated prompts
already caused user failure, nor use line count as a deletion argument. Live preview is
still in the proposal stage, so the current only available candidate/artifact entry cannot
be deleted based on it alone.

## Source-project feature comparison and conclusion correction

Migration scope was further clarified as: carry over design capabilities already verified
in the adjacent project, reduce only, and do not add product functionality on our own.
Earlier arguments that kept features because they were "useful and agent-naive" missed the
source-scope criterion; subsequent decisions should first prove the corresponding
capability exists in the source, then discuss necessity. Lody's host adaptation and data
integrity implementation do not authorize adding extra product workflows.

Checking the adjacent project's current UI entry `app.js` and orchestration module:

- `showCandidate` (line 308) does create a candidate review card, containing candidate
  preview, diff, accept/reject, re-compare, and artwork comparison. `followJob` (495–507)
  only shows it when the completion event carries a `candidateRevisionId`; when there is no
  candidate it updates the current revision and calls `revealCurrent` to open/refresh the
  artwork. Therefore it cannot be broadly stated that the source project has no cards or
  candidate actions.
- Failure/cancellation use existing message and state prompts (510–518), not a generic
  design-result card covering all turn states. On reopen, the entry for recovering
  `pendingCandidate` (line 685) also serves pending candidates.
- Candidate images come from a preview interface requested by revision; the adjacent
  `packages/orchestration/src/revisions.ts` `previewRevision` (line 196) reads the revision
  and calls the existing renderer to return a PNG. It does not prove that Molly Design's per-turn
  thumbnail capture, storage, and outcome reference chain has a source; that corresponding
  function was not found in the inspected app and public package source. Bento's own page
  thumbnails are also not session-history result thumbnails.

This corrects the judgment: candidate review is an existing capability and can be reduced
and migrated; generalizing it into a per-turn result card and adding per-turn historical
visual receipts is a Molly Design migration extension. Even if they were written into this
project's plan from the start, they do not fit the now-clarified migration scope and should
be removed from subsequent goals, not kept or relocated on "might be useful" grounds. This
is a source-fact correction and does not constitute a requirement to migrate candidates
back in. Current artwork, old-content reachability, and submission correctness remain; the
revision history and comparison system are not migrated back.

## P0–P6 review and disposition

2026-09-12 revision: the original read-sync hook was changed to
[human-save autosave](../../implemented/simplification/2026-09-12-editor-owned-pptd-save.zh.md),
while keeping the [read-first reminder hook](2026-09-12-noninvasive-design-hooks.zh.md);
no per-sampling generation proof or runtime modification is built. The old names in the
table below are understood accordingly; historical implementation is not rewritten.

The adjacent project version checked in this round is `7fd3c06`. The table distinguishes
already-decided removals, items pending decision, and retention reasons; this is a product
scope review, not calling redundancy a P0/P1 runtime defect, nor exempting scope review
with "already done."

| Scope / state | Evidence and judgment | Disposition |
| --- | --- | --- |
| P2.5/P2.6 implemented: generic result card, dedicated fix button, per-turn images | Source only shows review card for pending candidates; Molly Design extended it to all states and added a thumbnail write/read chain. | Retire in P3.0; fixes continue via ordinary input/file diagnostics, old content reachable, no candidate entry built. |
| P4.2 not implemented: sidebar artwork thumbnails | Source `navigation.js` uses session navigation; no corresponding artwork thumbnail chain found. Current-artwork positioning needs no new image generation/cache. | Delete from feature list, P4, and concept-art constraints; do not move the retired image chain to the sidebar. |
| P2.1 already migrated to skill, P3.6 pending: fixed creation flow | Current [SKILL.md](../../../../packages/design-authoring/skills/graphic-design/SKILL.md) Produce section requires fixed order, inspect reference image once, forbid self pixel analysis, publish via finalize; having a source does not equal fitting the target paradigm. | Keep format contract and optional helper scripts; cancel method constraints and mandatory finalize; no longer fail all review because a single tool is absent. |
| P2.7 #2b implemented: old-file auto-promotion | [turn-outcome.ts](../../../../apps/cli/src/design/turn-outcome.ts) still `keepCandidate` when `unchangedSinceSend` and different from current artwork, adding post-turn processing for visibility. Source orchestration's candidates correspond to regeneration or conflict coordination, not proving the same old-file promotion need. | Delete auto-promotion in P3.0d; keep files and existing candidates/receipts; explicit resubmission has a separate baseline contract. |
| P0/P1 done: bridge, save, export, conflict copy | Bento cannot be used as an ordinary React component; storage, resources, and version protection have current consumers. Size interaction already has a clear decision; serial editing replaces normal human-machine concurrency. | Keep necessary adaptation; conflict copy remains an abnormal escape hatch, not expanded into a daily flow. |
| P2.2/P2.3/P2.7 done: input snapshot, atomic commit, receipt recovery | These protect the current artwork and record historical submission facts not reconstructible from it; P2-A2 current-canvas update also consumes committed revision. | Keep; when removing cards check consumers; do not delete the whole `designOutcome`, input snapshot, or rendering bridge together. |
| P3.1/P3.7 pending: read hook, read-only live preview | Confirmed Molly Design adaptation, not claimable as existing in source; shared forward conversion, workspace, actual hooks, and Lody watcher. | Keep confirmed scope; do not expand into a generic hook platform, new runtime, persistent preview library, or auto-submit system. |
| P3 image/selection, P4 context actions | Source already has image editing and stable selection; Molly Design MCP currently only generates images, edit needs to be added. | Reuse input/dispatch and existing image connection, required model with no default; regeneration uses unified commit, candidate flow deleted. |
| P3–P5 asset library, brand resources, artwork catalog, template marketplace | Explicitly out of migration scope; some old diagrams still draw these capabilities. | Keep deleted; 2026-09-12 user separately confirmed Git design history, do not use this to restore these capabilities or the source project's full revision library. |
| P5/P6 cleanup, packaging, and acceptance | Reuse Lody infrastructure and existing tests; platform/agent support needs empirical evidence. | Keep necessary delivery work; do not build a new release system, verification engine, or Agent scheduler. |

Reference-image attachment P2-A3 is an adaptation gap for Molly Design's local composition of the
existing Lody attachment chain; reference-pack non-PNG is an optional helper-script
raster-analysis limitation and cannot be expanded into "Agents do not support non-PNG
images." Both remain separate; specific reuse evidence is below. Hand-written PNG porting
has source and bare-Node-environment reasons; this round does not demand a rewrite by line
count, nor add codecs.

## Retirement boundaries and design-principle sources

2026-09-12 scope update: the user confirmed
[Git design versions](../../implemented/feature/2026-09-12-design-version-history.zh.md), replacing this
record's earlier scope that excluded all historical versions. Only manual version save,
historical viewing, and editing from an old version are added; Git is the only history
backend, a self-built file snapshot library is not implemented. Result cards, historical
thumbnails, candidate approval, and cross-artwork asset libraries remain retired; the
original P0–P2 historical judgments are not rewritten.

Agent image reading and result cards are different consumers: the skill's Review usage in
[SKILL.md](../../../../packages/design-authoring/skills/graphic-design/SKILL.md) calls
`molly_render_preview` and then opens the PNG with whatever image tool is available;
[thumbnail.ts](https://github.com/LeonEthan/molly-design/blob/baed947b6f16263cb6a2f8f37e10f1695d146fe0/apps/cli/src/design/thumbnail.ts)
generates small images for the UI after artifacts are categorized. After deletion, tool
registration, preview queue/host, and image-reading usage must remain; rendering success,
model saying it looked, and successful image reading are different facts. Old-content
preview reuses rendering on demand, without building a candidate panel or persistent
thumbnail service.

P3.0 deletion scope must run through card mounting, dedicated fix actions, thumbnail
collection, field production, readback interfaces, and isolated tests/copy. Shared `maxEdge`
and zoom branches currently serve the card; check for new consumers before deleting; old
outcomes tolerate legacy fields, no need to batch-rewrite sessions or start background file
cleanup. Collection and receipts cannot be skipped just because preview succeeded; P6
verifies old content is readable on reopen, save protection, old records readable, Agent
real image reading, and no dedicated thumbnail generation.

The root `AGENTS.md` adopts the adjacent project's opening principles of smallest
end-to-end and deleting mechanisms without purpose, combined with architecture §3's single
visual truth, recomputable derived state, current-phase minimum form, scenario knowledge in
skills, evidence-driven constraints, and autonomous completion, as this project's
constraints. It questions requirements, deletes before simplifying, and optimizes last. It
does not copy the source's immutable revision library, export-only governance, closed tool
whitelist, or full runtime; those are inconsistent with Molly Design's confirmed scope and Lody's
working paradigm.

Document updates cover root rules, Spec, phase plan, related sync/preview decisions, and
concept-art notes. Product code and runtime skill are unchanged this round; subsequent
implementation still needs P3.0/P3.6 validation, and this documentation check is not product
acceptance.

## Lody routine capability review (2026-09-11)

This round compared Molly Design `HEAD=101425f` source against the pre-migration Lody baseline
`8ea564d`, distinguishing original generic capabilities, P0–P2 already-migrated
capabilities, and P3 new connection work. The installed Lody attachment menu was observed,
but no upload/send was verified, nor was its binary proven to match the local source
version. A single Molly Design OSS acceptance failure cannot be generalized to Lody lacking
attachments; likewise, having an entry and code does not mean the cloud-authenticated
end-to-end has passed.

### Attachment conclusion correction

The earlier P2-A3 claim that "there is no equivalent local identity and storage" missed
the following existing chain:

- [AttachmentAddMenu](../../../../packages/components/src/components/chat/attachment-add-menu.tsx)
  is the unified attachment entry; the [landing page](../../../../packages/components/src/components/chat/chat-landing.tsx)
  and [session input](../../../../packages/components/src/components/sessions/session-chat-input-area.tsx)
  already分流 by type, paste, drag-and-drop, progress, retry, and draft handling.
- [sendSessionFileToLocalRuntime](../../../../packages/components/src/lib/electron-session-file-sender.ts)
  → Electron `localProjects.sendSessionFileLocal` → CLI `session/file-send-local` hands the
  user-selected file to this machine. The existing
  [session-file-blob-store](../../../../apps/cli/src/lib/session-file-blob-store.ts)
  saves bytes and returns `fileId`, digest, `transport: local`, and machine identity; a
  local image library does not have to be built from scratch.
- [message-handler](../../../../apps/cli/src/lib/message-handler.ts) `materializeSessionFileAttachments`
  can read and verify bytes from local storage, place them in the session `.lody/attachments`,
  and provide `resource_link` and file descriptions to the Agent. Cloud backfill has an
  independent switch; do not open authenticated product cloud just to reuse the local path.
- `session-chat-input-area.tsx`'s image upload exception branch already can fall back to
  local file attachments; but the landing-page image hook lacks that branch, and both
  landing/session upload logic check `authToken` before the local path. Therefore it is not
  currently a complete solution usable by the OSS build.

Actual adaptation scope: reuse the above entry, transfer, and storage; handle separation of
local capability from cloud authentication; check first-message-before-session ownership
(the existing handler requires a session to exist); make local images feed P2.2's reference
snapshot and the Agent's actually usable image input. The existing file attachment
`resource_link` is not automatically an ACP `image` block; `prepareDesignTurn` currently
only freezes the image-attachment branch, so "the file was sent over" cannot be claimed as
design reference images being wired.

Readback of already-sent local attachments also needs adaptation:
[session-file-presentation](../../../../packages/components/src/lib/session-file-presentation.ts)
treats all `transport: local` as pending, and
[session-file-download](../../../../packages/components/src/lib/session-file-download.ts)
is still authenticated download. Prefer reusing existing controlled local file reading and
image presentation; the specific identity/path mapping still needs implementation
verification, and arbitrary blob paths cannot be exposed directly. Keeping separate
attachment / canvas asset lifecycles is not the same as building two upload controls,
storage services, or asset libraries. The original "must build new local storage,
medium/large effort" estimate lacked evidence and is withdrawn; no new cost commitment is
made this round.

### Item-by-item check against the original 29-item list

The numbers correspond to the previous overall list; groups with the same reuse source are
merged, product responsibilities are not.

| Original # / content | Existing basis | List should keep only the delta |
| --- | --- | --- |
| 2, 4: shell, session navigation and search | [Sidebar](../../../../packages/components/src/components/loro-sidebar.tsx), [row actions](../../../../packages/components/src/components/sidebar-updated-session-list.tsx), [command palette](../../../../packages/components/src/components/commands/command-palette.tsx) already have name, search, pin, archive, and navigation. | Design identity / current-artwork positioning and dev-field reduction; not building artwork management or a new search system. |
| 3: execution state, continue and recovery | [Session service](../../../../apps/cli/src/session/README.md), [session input/dispatch](../../../../packages/components/src/components/sessions/session-chat-interface.tsx) already have queue, permission, cancel, continue, recovery, and provider session handling. | P3.5 verify design context connection; fix concrete gaps as found, do not rebuild the whole session system. |
| 1, 13, 14: serial editing and abnormal copy | Lody provides execution facts; P1 already has artwork save, leave protection, and conflict copy. | Connect execution/result-processing state with Bento human-change entry; delete normal human-machine concurrency workflow, keep abnormal copy temporarily; no existing cross-artwork read-only contract to claim done. |
| 5, 6: create, size, edit, save, reopen, export | P1 already connected existing Session create/auto-naming and [design-service](../../../../apps/electron/src/main/services/design-service.ts); Bento has edit commands and undo/redo. | Later only new serial boundary and UI adaptation; Lody's ordinary file save/image save is not a substitute for editable design persistence. |
| 7, 8, 9: conversion, reverse projection, draft | P2 already has [intakeAuthoring](../../../../packages/design-authoring/src/intake.ts); Lody has workspace and dispatch. | Forward conversion continues to reuse; reverse editable semantics and projection/draft isolation are explicit new adaptation; existing group/multi-shadow still need minimal PPTD extension. |
| 10, 11, 12: hooks, five agents, version/receipts | Existing Agent wiring, P2 [turn-input](../../../../apps/cli/src/design/turn-input.ts), [turn-outcome](../../../../apps/cli/src/design/turn-outcome.ts), and store already protect submission. | Do not rebuild wiring and receipts; add thin read/write hook adapters and verify actual tool coverage; Lody supporting an Agent does not equal supporting design hooks. |
| 15, 16: candidates and old-file promotion | P2 already has candidate persistence and actions; #2b is a Molly Design-added attribution strategy. | P3.0/P3.3 retire new candidate production and UI, P3.4 protect old content; P3.0d delete old-file passive promotion; explicit resubmission has a separate baseline contract. |
| 17, 18: live preview and current artwork | [File preview](../../../../apps/cli/src/lib/file-preview/README.md), [watch coordinator](../../../../apps/cli/src/lib/code-collab/workspace-watch-coordinator.ts), Bento, and forward conversion already exist. | Connect PPTD multi-file snapshot, restricted subscription, and independent preview; ordinary file preview does not convert PPTD, and the existing watcher subscribes to workspace root, not yet a precise-dependency API. |
| 19: rendering and image reading | P2.4b already has `molly_render_preview`; Lody has file/image display, and Agents have actual image-reading capability. | Keep capability; retiring result cards does not delete generic attachment bubbles, image preview, copy/save, or Agent image content blocks. |
| 20: skill | Lody already has skill discovery/materialization and input references; P2 already migrated the design skill. | Converge forced steps; do not build a new skill manager or fixed creation flow. |
| 21: image generation and current-canvas image operations | P2.4 already has [image connection settings](../../../../packages/components/src/components/settings/image-connection-setting.tsx), [generation tool](../../../../apps/cli/src/mcp/image-generation.ts); Bento [image command](../../../../packages/design-bento/vendor/packages/editor-bento/src/ui/image.ts) already has replace/crop, etc. | P3.2a reuse connection and add generate/edit requests, delete product default model; P3.2b connect current selection; do not rebuild image editor or image job service. |
| 22: reference-image attachments | See the full input/local-file chain above. | Molly Design local composition adaptation and acceptance; do not write this as "adding attachment functionality" or "building new local image storage." |
| 23: non-PNG reference analysis | [image-preview-export](../../../../packages/components/src/lib/image-preview-export.ts) `encodePngBytes` already decodes via browser and converts via Canvas; this file existed in the pre-migration baseline. | Optional script capability adaptation; if normalized, prefer reusing in the existing renderer entry that holds the image and passing an analysis copy; do not let CLI/skill import Electron, and do not build a new decode channel. |
| 24: element references | Already have [mentions](../../../../packages/components/src/components/mentions/README.md), [visual-annotation input](../../../../packages/components/src/components/preview/visual-annotation-draft-composer.tsx), and [anchor contract](../../../../packages/shared/src/visual-annotation-types.ts). | Reuse input/reference presentation and dispatch; web selector/rectangles are not stable Bento IDs, so artwork/baseline/element binding is still needed; do not migrate another annotation system. |
| 25: shortcuts | [Commands and shortcuts](../../../../packages/components/src/lib/commands/shortcuts.ts), ordinary prompt dispatch already exist. | Optional target actions reuse existing entry; no new command system, and no convenience buttons blocking basic creation. |
| 26: layout, settings, onboarding | [Layout state](../../../../packages/components/src/atoms/layout-state.ts), existing side panels, P1 [Focus canvas](../../../../packages/components/src/components/sessions/design-canvas.tsx), [settings tabs](../../../../packages/components/src/components/settings/settings-tabs.tsx), [onboarding steps](../../../../packages/components/src/components/onboarding/onboarding-steps.ts). | Config/copy/layout adaptation. P1 already has Focus canvas; only check new preview/read-only connection, do not redevelop, and do not replace with a Zen mode that hides the right panel; local onboarding already trims capabilities, do not add mandatory language/appearance/image config pages; do not add a "save settings" without concrete need. |
| 27, 28: dev feature retirement and generic capabilities | [Terminal](../../../../packages/components/src/components/terminal/terminal-dock.tsx), [browser](../../../../packages/components/src/components/sessions/session-browser-panel.tsx), [fork](../../../../apps/cli/src/session/session-fork-service.ts), file reading already exist. | Keep if still consumed; exiting dev UI does not delete Agent image reading/files/tools or design preview dependencies. |
| 29: packaging and release acceptance | Existing Electron build, managed-runtime, and [updater service](../../../../apps/electron/src/main/services/app-updater-service.ts), P0 already connected design resources. | Add design resources and real platform/agent/hook acceptance; do not build a second install, update, or test system. |

`encodePngBytes` is a private helper in the existing image-copy path, not a public
interface already wired for reference attachments; extracting and reusing it still needs
verification of dimensions, transparency, and supported formats, and the original PNG skip
does not prove reference-pack supports arbitrary PNG encoding. External paths also do not
automatically go through the attachment entry. An optional script limitation can be stated
first; do not require every Agent image read to go through that script.

### Handling and evidence limits

The attachment description, non-PNG restriction, and P4 reuse boundary in the phase plan
and Spec have been corrected; historical failure observations are kept and the overall
capability and development-size inferences are withdrawn. P3.5/P4/P6 generic capabilities
are listed as reuse/adapt/verify, and P2 completed capabilities are not redeveloped. The
above sender, blob store, PNG helper, layout, command palette, watch coordinator,
onboarding, and shortcut modules show no diff between `8ea564d..101425f`; they are Lody
existing implementation, not new Molly Design extensions discovered this round.

This round is source and plan review, only changing documents; no product tests, real
Agents, attachment uploads, listener execution, or installed-package full behavior were
run. Actual attachment wiring, five-agent image input and hooks, Bento serial editing, and
continuous preview still await their respective implementation acceptance. This section is
a product scope/reuse review and does not automatically label documentation as proven
P0/P1 runtime defects.

## Old-file auto-candidate deletion ruling and implementation breakdown

On 2026-09-11 the user explicitly confirmed deleting P2.7 #2b: in a successful turn where
the PPTD can be proven the same as at dispatch, it is not automatically promoted to a new
candidate just because the current canvas has diverged. This decision replaces the P2.7
choice at the time to keep a candidate for visibility; it does not delete disk files,
existing candidates, or historical receipts. Structural validation and atomic commit remain;
overall convergence later turns abnormal-version candidates into retained drafts/diagnostics
for the Agent, and P3.7 takes direct explicit import. This scope decision is confirmed, but
actual retirement is not yet implemented, so the document remains proposed and the Spec
remains draft.

The source deletion boundary is the `unchangedSinceSend` branch in
[turn-outcome](../../../../apps/cli/src/design/turn-outcome.ts); keep existing `artifactAtSend`
content evidence, and end an unchanged old file without active resubmission as
`no_artifact`, removing passive promotion import/compare. P3.3 separately defines explicit
resubmission under a valid new read baseline; do not force the Agent to change meaningless
bytes just because the digest is unchanged. Clean up local helper functions only after
checking other consumers like store. Recorded outcomes and matching receipts still prefer to
recover historical facts; do not rewrite old turns or erase existing candidates with the new
rule. Missing dispatch snapshot does not imply "not modified"; this slice does not
incidentally change old manifest compatibility contracts or add submission ledgers.

Deletion can be delivered independently of live preview: the cost is that until P3.7 ships,
ordinary turns no longer automatically prompt the user about an old on-disk project; files
remain. Acceptance distinguishes current canvas same/different from old project, old project
already invalid, new artifact changed, abnormal version conflict, and existing receipt
recovery; cancellation/failure still handled by real execution result, not uniformly changed
to `no_artifact`. These tests were not run this round.

The [next implementation breakdown](../../implemented/architecture/2026-09-09-graphic-design-platform.zh.md#下一步实施切片2026-09-11)
keeps Pn.x numbering, arranges old-file deletion, serial editing, format roundtrip, and
forced-flow convergence first, and can advance image MCP completion and independent
attachment adaptation; the candidate panel is no longer a prerequisite for card retirement.
Hooks first complete one verifiable actual adapter before expanding to the rest; file
preview relies only on shared source boundaries and does not wait for all five hooks. P4
reuses UI, P5 cleans by consumer, P6 aggregates actual delivery evidence; no execution tasks
or runtime code were created.

## Current boundaries after the overall review

The [convergence record](2026-09-11-design-workflow-convergence.zh.md) records the user's
confirmed subsequent decisions and source gaps, replacing the minimal-candidate direction
in this record's first-round discussion. Current implementations that need correction
include: candidate production/approval, product default model, text-only image interface,
and the timing boundary where post-turn diagnostics cannot be fed back to an already-ended
Agent. P3 delivers tool-visible conflicts, ordinary continuation, old-content reachability,
and direct import; P4 adds no management pages for these mechanisms.

This document has been synced; that does not mean runtime is complete. The original
attachment reuse, non-PNG script limitation, rendering image reading, receipts, and manual
abnormal copy conclusions continue to apply; normal human-machine concurrency, temporary
preview element instructions, and fixed creation flow no longer enter the first phase.

Subsequent T07 implemented
[ordinary file readback and card retirement](../../implemented/simplification/2026-09-11-design-files-without-result-cards.zh.md):
old candidate raw JSON and embedded assets, old/new drafts are reachable through existing
file entries, and the card and dedicated adopt/discard/fix actions exit. The review-time
above is preserved; new candidate production and thumbnail production are still retired by
separate tasks.
