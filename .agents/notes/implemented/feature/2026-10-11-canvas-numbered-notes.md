# Canvas numbered notes: several targeted requests in one turn

Status: implemented
Translation: current

[中文](2026-10-11-canvas-numbered-notes.zh.md)

## Abstract

Asking Molly from the canvas handled one target per request, so several small
fixes meant several turns and several restore points. Cmd/Ctrl-click on an
element (or "Add as note" in the inline ask) now drops a numbered pin with its
own instruction, and "Send to Molly" sends every note as one ordinary turn
with one element reference per note. Pins are screen-only canvas state; main
reads and validates their targets exactly like a selection, at one saved
revision. This is phase B of the
[canvas click-to-edit proposal](../../proposed/feature/2026-10-10-canvas-click-to-edit.md).
Pins do not survive a canvas page reload, and the paid live send was not run.

## Problem and evidence

After [inline ask](2026-10-10-canvas-inline-ask.md) the request stayed at the
target, but each request covered one selection. Reviewing an artwork usually
produces a list ("headline darker", "crop the photo", "move the date"). The
Codex app's numbered annotation comments, addressed together from chat, and
Lovart's up-to-10 marks per prompt were the reference patterns.

## Decision

- **Reuse ladder.** Checked Bento's built-in review comments
  (`editor/comments.ts`): they persist into `Slide.comments` in the document and
  use `window.prompt`, so reusing them would add a document field the YAML
  projection does not carry and mutate the artwork per note. Checked Lody's
  preview visual annotations: they anchor by DOM selector/xpath for HTML
  previews and persist in a Loro comment document. Both rejected; the
  numbered-marker pattern is borrowed. Reused: the toolbar endpoint, the
  selection capture (now `captureDesignReferences`, shared by selections and
  notes), `design.selectionAction`, `DesignElementReference` mentions and the
  composer send path from phase A. Multiple `<molly-elements>` markers per
  prompt were already parsed, validated and outlined (phase D).
- **Canvas.** `packages/design-bento/src/note-pins.ts` owns pins: element ids
  plus text, an epoch bumped on every change, markers at the top-right of the
  targets in screen pixels, an editor popup and a tray above the dock
  (count, Clear, Send). Cmd/Ctrl-click without a drag pins the current
  selection when the click lands in it, otherwise the outermost element hit;
  Cmd-drag duplicate is untouched. An empty note is dropped when its editor
  closes; a second note on the same targets is appended to the existing pin;
  at most 10 pins (`DESIGN_NOTES_MAX`). Targets deleted from the document
  disappear from their pin; a pin with no targets left is removed. Pins are
  hidden while the canvas is read-only.
- **Contract.** The toolbar request is `{ type: 'notes', notesEpoch }` and
  carries no element ids. Main runs `window.molly.notes(epoch)`, parses
  `DesignNotesSchema`, flushes like any explicit reference action, builds one
  reference per note at the saved revision, validates them together and
  re-reads the epoch before forwarding `{ action: 'notes', notes, notesEpoch }`.
- **Send and clear.** `sendDesignNotes` builds `1. prompt @Note 1` lines, one
  mention per note, and sends one text block without touching the draft. The
  pins stay locked from the request until the shell answers through the new
  `design.settleNotes(artwork, host, epoch, sent)`, which the shell calls on
  every outcome, including an ignored event; this prevents a second click from
  sending the same notes twice. Only an accepted turn clears them, and a newer
  edit to the pins keeps them. A refused send keeps the pins and says so;
  unlike Ask, notes never fall back into the composer draft, because the
  draft holds one selection chip.

## 2026-10-20 staging pass

The owner approved phase 3 of the canvas comment polish: the tray's Send now
stages the notes in the composer as an "N comments" chip with the annotated
whole-artwork snapshot and the one marked copy as ordinary attachments, while
⌘/Ctrl+Enter in the editor or the tray keeps the direct send. See
[canvas comment phase 3](2026-10-20-canvas-comment-stage-and-compare.md).
Notes remain session state cleared only after the staged or direct turn is
actually sent; published copies now carry the pins epoch and the canvas page's
instance id (epochs restart on recreation), so an accepted staged send retires
exactly the copy it sent and pins edited since staging — or restored into a
recreated canvas — stay.

## Validation

- Unit: schema bounds and the epoch-only request
  (`packages/shared/tests/design-selection-commands.test.ts`); pins gesture,
  merge, cap, prune, lock until settled, epoch/clear and tray failure
  (`packages/components/tests/design-note-pins.test.ts`); "Add as note"
  (`design-selection-toolbar.test.ts`); canvas event routing and clearing
  (`design-canvas-selection-ask.test.tsx`); numbered composer send
  (`session-chat-input-submission.test.tsx`).
- Real Electron app (2026-10-11, dark theme): Cmd-click pinned the headline
  and the leaf's vein line, Enter saved each note, markers numbered 1 and 2,
  the tray read "Notes · 2", reopening a marker restored its text, and
  `window.molly.notes()` returned both targets with their prompts.
- Not run: the live Send (a paid model turn), the light theme, and element
  kinds other than text and line. Human visual acceptance is pending; the Spec
  revision stays draft.

## 2026-10-19 presentation pass

The owner approved a presentation-only pass (phase 1 of the canvas comment
polish): no storage, no toolbar-request contract and no Agent behavior changed.
The canvas overlays now follow the Bento page theme tokens in both themes
instead of hard-coded colors: the selection toolbar, popups, tooltip and size
readout, the pins, the note editor and the tray, and the highlight tones read
the page's `--ink/--surface/--line/--muted/--accent/--on-accent`, a new
`--signal` (focus rings and the working/changed outlines, replacing the
vermilion `#d9512c`/`#6195ed`/`#566b86` literals) and a per-theme `--outside`
amber. The per-element `data-dark` overrides were dropped; the page's own
`data-theme` (driven by the app theme through `nativeTheme`) is the single
source. Pins are round accent badges with a surface ring and a soft shadow;
hovering a pin previews its text and lightly outlines its targets through the
existing element-highlight system via an in-page-only `hover` tone (it never
crosses IPC). While its editor is open the pin lifts. The editor beside the pin
is a pill with an auto-growing textarea and a round accent save-arrow: Enter
saves and closes without sending, Shift+Enter adds a line, Escape closes (an
empty note is still dropped), and ⌘/Ctrl+Enter saves and then sends every note
like the tray. The tray is an inverse ink pill reading "1 comment" /
"N comments" with a surface "Send" button and an icon-only clear button.
While a turn sent from notes runs, each note's targets carry a
non-interactive numbered badge beside the working outline, briefly turning into
a check when the turn commits; the badge numbers are derived from the
references sent into the turn and ride the existing highlight channel as an
optional per-group `badge` field (the group cap grew from one per tone to ten
badges plus the three tones), so no new IPC channel, turn marker or persistence
was added. Pins remain hidden while the canvas is read-only; the badges are the
run-state presentation. Validation: updated unit tests (pin keys and IME guard,
hover preview, tray copy and clear, badge geometry/fade and the notes-run
highlight wiring); real-app light and dark screenshots of the pins, the hover
preview, the open editor, the tray with two notes and the run badges, captured
on a fixture design in the built app. The paid live Send was not run; the run
badges were exercised through the real `design.highlight` IPC path with the
canvas held read-only, not through a model turn. The visual pass caught two
defects, both fixed before merge: `display` on the new tooltip and badge rules
overrode the `hidden` attribute (a stuck tooltip after hover, badges painted
when hidden), now covered by computed-style assertions.
