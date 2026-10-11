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
  mention per note, and sends one text block without touching the draft. Only
  after the turn is accepted does the canvas call the new
  `design.clearNotes(artwork, host, epoch)`; a newer edit to the pins keeps
  them. A refused send keeps the pins and says so; unlike Ask, notes never fall
  back into the composer draft, because the draft holds one selection chip.

## Validation

- Unit: schema bounds and the epoch-only request
  (`packages/shared/tests/design-selection-commands.test.ts`); pins gesture,
  merge, cap, prune, epoch/clear and tray failure
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
