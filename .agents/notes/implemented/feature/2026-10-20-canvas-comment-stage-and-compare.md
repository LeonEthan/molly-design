# Canvas comment phase 3: stage notes in the composer and hold to compare

Status: implemented
Translation: current
PR: https://github.com/LeonEthan/molly-design/pull/214

[中文](2026-10-20-canvas-comment-stage-and-compare.zh.md)

## Abstract

The canvas comment tray's Send used to dispatch a turn immediately, and there
was no way to see what the artwork looked like before Molly's last edit. The
tray's Send now stages the notes in the chat composer — an "N comments" chip
with a hover/focus list plus the annotated whole-artwork snapshot and the one
marked region image as ordinary attachments — so the user can add an overall
instruction and send normally, while ⌘/Ctrl+Enter in the editor or tray still
sends at once. Separately, holding `\` or the canvas toolbar's compare button
after a committed Agent turn shows the pre-turn render until release. The
compare frame is rendered in memory from the Molly-managed Git history entry
matching the superseded revision; nothing is written to the document, history
or a sync loop. This is phase 3 of the canvas comment polish (items 8 and 11 of
[issue #185](https://github.com/LeonEthan/molly-design/issues/185)); the
staging flow and the overlay mechanics are verified on the real app in the
linked PR, while a real committed turn feeding compare end to end was not run
(no authorized verification connection in the isolated profile), and the Spec
revision stays draft pending human visual acceptance.

## Problem and evidence

After phases B–D, reviewing an artwork with numbered notes still meant one
immediate turn per batch: there was no room to add an overall instruction, and
no way to inspect the notes before they left. The Codex app stages canvas
comments in its composer as chips. And while the canvas briefly outlined what
changed after a turn, the person could not flip between the current artwork and
its pre-turn state; the target-feedback phase deferred hold-to-compare because
no non-mutating render of a history entry existed.

## Decision

- **Reuse ladder (staging).** Checked the composer's single-selection chip
  (`designSelectionState`): one element reference, no list — rejected. Checked
  parking the notes as inline mention ranges in the draft text: it would
  clutter the draft with ten mention chips and lose the one-chip remove
  gesture — rejected. Checked the preview visual annotations and comment
  reference chips: they ride as separate `SessionInputBlock` types anchored to
  conversation entities, not to canvas element references — rejected. Borrowed
  the chip pattern (`DesignSelectionChip` → `DesignNotesChip` with a Radix
  popover listing the numbered comments on hover/focus) and reused the
  composer's per-session draft caches (`sessionStagedNotesCache` beside the
  text/image draft caches), the ordinary image attachment pipeline
  (`handleAddFiles`, including its count limits and failed-upload blocking),
  the `appendDesignSelectionMention` mention flow and the expansion pass, so
  the sent text is exactly what the direct send builds: numbered lines, one
  `<molly-elements>` reference per note.
- **Annotated snapshot.** Main renders the saved artwork offscreen through the
  existing export renderer (`renderSavedDesign`), serves it once to the canvas
  over the host-bound `/ws/<id>/notes-snapshot` route, and the canvas
  (`window.molly.annotateNotesSnapshot`) draws every note's number where it
  sits — pin points and the default corner anchor are projected from screen
  geometry through the stage rect, region outlines from their image-normalized
  coordinates — then re-encodes with the marked copy's PNG/JPEG ≤5 MiB
  fallback. Main validates the composed bytes with the same signature/size/edge
  checks as the marked copy. The tray Send carries `stage: true`; the notes
  request, epoch guard and reference capture are unchanged.
- **Semantics kept.** Staging never consumes the retained unsent-notes copy
  (the `accept` into a flight happens only on a direct send), and every publish
  carries the pins epoch plus the canvas page's instance id — epochs restart
  when the canvas is recreated, so a staged chip from a closed-and-reopened
  canvas can never settle away the new page's pins. An accepted
  send — staged from the composer or direct from the tray — settles with
  `sent=true`, which clears the canvas pins and retires the retained copy only
  when the pins never changed since (epoch and instance match); a newer edit
  keeps both. Removing the chip unstages it and drops only the images staged
  with it; the pins stay on the canvas. Staging is all-or-nothing against the
  composer's image cap: when the attachments do not fit, nothing is staged and
  the tray reports the failure.
- **Hold-to-compare.** When a committed turn reloads an open canvas and the
  saved revision changed, main asynchronously renders the history entry whose
  `contentDigest` matches the superseded canvas document and assets (`history-read`
  is read-only; metadata-only rebases do not change this content identity) through the same offscreen renderer, downscales to ≤2048 px and
  keeps one PNG data URL per artwork in memory. A turn start, teardown or a
  newer preparation invalidates it. The shell learns availability over
  `design.compare`; holding `\` in the shell or the canvas — the canvas posts
  `{type:'compare'}` over the toolbar endpoint — or the toolbar's compare
  button, drives `window.molly.showCompare(src|null)`, an overlay that tracks
  the stage rect through zoom and pan and blocks stage pointer input while
  shown. Rejected: capturing the visible canvas with `capturePage` (viewport
  crop, zoom-dependent, would need a chrome-hiding dance), and a hidden parallel
  canvas instance (view lifecycle for a static need the render path already
  covers).

## Validation

- Unit: schema bounds for the stage flag, the epoch-stamped sync and the
  compare request, plus the annotated-snapshot decoder
  (`packages/shared/tests/design-selection-commands.test.ts`); tray Send stages
  while ⌘Enter sends directly and pins survive an unsent settle
  (`design-note-pins.test.ts`); snapshot annotation geometry for pins, corner
  anchors and region outlines (`design-note-pins.test.ts`); overlay placement,
  hiding and pointer blocking (`design-compare-overlay.test.ts`); chip staging,
  numbered send with the draft, removal without settling
  (`session-chat-input-submission.test.tsx`); canvas event routing for staged
  notes (`design-canvas-selection-ask.test.tsx`); retention epochs and the
  staged settle (`design-note-retention-core.test.mjs`); compare source
  selection (`design-compare-core.test.mjs`).
- Real Electron app (2026-10-20, dark theme, isolated profile, no model
  configured): the tray Send staged a "2 comments" chip with the annotated
  whole-artwork snapshot and the one marked copy as attachments; the chip's
  hover popover listed both numbered comments; removing the chip dropped only
  its staged images and kept the draft text and the canvas pins; ⌘↵ from the
  tray dispatched at once with nothing staged, and the accepted-then-failed
  turn kept the numbered comments in the transcript while clearing the pins
  (the phase-2 "cleared once actually sent" rule). The compare overlay, driven
  with an injected frame over the canvas bridge, covered the stage exactly
  (sub-pixel), followed zoom, kept pins and the tray above it, and blocked
  stage pointer input while shown.
- Not run: a real committed turn feeding hold-to-compare end to end (no
  authorized DeepSeek Flash connection in the isolated profile), and the paid
  staged send. Human visual acceptance is pending; the Spec revision stays
  draft.

## Limits

- The annotated snapshot is prepared from the last saved revision, so an edit
  still saving while Send is pressed is caught by the epoch/revision guards
  exactly as the direct send's references are.
- The compare frame is prepared only when a committed turn reloads an open
  canvas; a turn that finishes while the canvas is closed has no frame, like
  the post-turn outlines.
- Turns sent from a staged chip show the plain working outline while running;
  the numbered run badges stay tied to the tray's direct send.
- Hold-to-compare targets the pre-turn content as a whole-artwork image; it
  cannot diff individual elements, which the post-turn outlines already cover.

## PR review correction

The first implementation incorrectly described `sourceRevisionId` as the artwork's
content hash. It hashes the whole saved envelope; Save Version and restore can
change editing metadata while history deduplication retains an older entry with
identical document and assets. Bento snapshots reorder document keys, so hashing a live snapshot also fails
against history's validated saved bytes. The existing surface payload closure now
supplies the superseded saved content without retaining another copy. Compare
now matches the existing `contentDigest`
using the canonical content serialization from `store.ts` (document plus assets
sorted by key), preserving the existing history reader and offscreen renderer.
The serializer pattern is adapted locally in the Node-only compare helper;
importing the CLI store at runtime would pull storage and validation into Electron,
and a new cross-runtime API or stored mapping is unnecessary for this lookup.
Compare preparation also runs for every turn-driven revision reload, including
background-only and canvas-size changes; the element diff still drives outlines.
These are implementation corrections to the existing whole-artwork comparison
intent; the Spec remains draft.

Regression tests exercise background-only and size-only reloads through the real
service, and content-based selection after envelope rebases, asset-order stability,
and refusal to select different content. Both failures reproduced before the fix.
Native Electron verification launched through computer-use used an isolated
synthetic fixture with production save/version/restore, history read, offscreen
render and compare APIs. Screenshots confirmed the pre-change background appears
and release returns to the current background; after restore, a size-only change
also prepared and displayed the matching older frame. The fixture used temporary
show/release controls, not a paid Agent turn or the full chat dispatch path. Final
check and independent review results are recorded in the PR.
