# Canvas image marks and quick edits

Status: implemented
Translation: current

[中文](2026-10-12-canvas-image-marks-and-presets.zh.md)

## Abstract

Asking Molly from the canvas could only target a whole element, and every
request started from a blank prompt even when the tools offer a handful of
obvious edits. For one selected image, "Mark areas to edit" now lets the person
draw up to ten numbered boxes, strokes or points and describe the change; Molly
receives a marked copy of the image as an attached reference plus the element
reference, and edits the image's current asset with the existing image edit
tool. The inline ask also offers quick edits that match the selection's kind
(remove background, replace object, relight, make wording editable and split
into layers for images; shorten and rewrite for text). This is phases C and E
of the [canvas click-to-edit proposal](../../proposed/feature/2026-10-10-canvas-click-to-edit.md).
The marked copy is a guide, not a mask; whether the image model honours it is
up to the model, and the paid live send was not run.

## Problem and evidence

After [inline ask](2026-10-10-canvas-inline-ask.md) and
[numbered notes](2026-10-11-canvas-numbered-notes.md), the smallest target was
still a whole element. "Remove the earring" on a portrait had to be described
in words. Lovart's marks inside an image and the Codex app's region comments
were the reference patterns. The Spec rules out a mask editor, and the image
MCP has only generate and edit with reference images, so a marked reference is
the only region signal the current tools can carry. Separately, a blank prompt
hid edits the Agent already knows how to do: lettering images can gain
`textCopy`, and the layered workflow can split a flat image.

## Decision

- **Reuse ladder.** Checked Bento's crop overlay and the selection handles for
  drawing: both edit document geometry and would mutate the artwork. Checked
  the note pins from phase B: they anchor whole elements by id and carry no
  geometry inside an element. Checked an automatic segmentation model (Lovart's
  Cmd-click): it needs a model the product does not ship. All rejected; the
  overlay pattern of note pins is borrowed, and reused are the toolbar
  endpoint, the selection epoch, the reference capture, the `selectionAction`
  IPC event, the composer's selection send path with
  `uploadSessionReferenceImage`, and the existing image edit tool.
- **Canvas.** `packages/design-bento/src/image-marks.ts` owns mark mode. Marks
  are screen-only state in image-normalized coordinates, so canvas zoom, crop
  and fit do not move them. The renderer paints an image as an `<img>` at its
  natural size with a translate/scale transform inside a clipped frame; mark
  mode finds the image's screen affine by placing three zero-size probes at the
  image's corners with the same transform, which also follows rotation and
  zoom. A click without a drag drops a point; Box and Brush pick the drag
  shape; at most 10 marks (`DESIGN_MARKS_MAX`). Mark mode closes on Escape,
  Cancel, a successful request, read-only, a different selection or a lost
  image.
- **Contract.** The request is `{ type: 'marks', selectionEpoch, marksEpoch,
prompt, send }` and carries no pixels. Main captures the reference (one image
  only), then reads `window.molly.marks(epoch)`, which draws the copy at up to
  1600 px on the long edge (PNG, or JPEG on white above 5 MiB). Main checks the
  element id, the PNG/JPEG signature, at most 5 MiB and at most 2048 px per edge
  (`decodeDesignMarkedImage` plus `nativeImage`) before forwarding
  `{ action: 'marks', reference, prompt, send, count, image }`.
- **Send.** The shell turns the bytes into `marked.png` or `marked.jpg`, prefixes
  the localized `design.marksPrompt` and sends image plus text as one ordinary
  turn. A refused send or "Add to chat" puts the chip, the image and the prompt
  into the composer draft instead, as inline ask does.
- **Quick edits.** `DESIGN_ASK_PRESETS` lists each preset's element kind,
  whether it needs one element and whether it needs typed detail. Chips sit in a
  "Quick edits" group after the prompt, so Tab reaches them without hijacking
  the key. The request carries only the preset id; main re-checks the kind and
  count against the live selection, and the shell composes the localized
  instruction followed by the typed text. "Make wording editable" is hidden once
  the image has `textCopy`. A preset never runs a tool by itself.
- **Not done.** No mask output, no automatic object recognition, no relight or
  background tool beyond what the image edit tool already does.

## Validation

- Unit: preset prompt rule, marks request and marked-image decoder
  (`packages/shared/tests/design-selection-commands.test.ts`); chips per kind,
  hidden wording chip, preset send and detail gate, and the Mark button
  (`design-selection-toolbar.test.ts`); box and point marks in image space,
  refused request, cap and undo, closing, epoch-bound read with downscale, and
  badge drawing order (`design-image-marks.test.ts`); preset and marks
  forwarding with send and draft fallbacks
  (`design-canvas-selection-ask.test.tsx`).
- Real Electron app (2026-10-12, dark theme): the Mark button appeared beside
  Ask Molly for a selected portrait image. The first build closed mark mode at
  once, because it mapped through an SVG `<image>` that the live renderer does
  not use; that led to the corner-probe mapping above. With the fix, a drag
  drew box 1 exactly over the earring and a click dropped point 2 on the books,
  the panel placed itself above the image, Send stayed disabled until text was
  typed, and Escape closed mark mode. The Ask popup on the same image showed
  the five image quick edits.
- Not run: "Add to chat" and the live Send from mark mode (the send is a paid
  model turn), the light theme, and text quick edits in the app. Human visual
  acceptance is pending; the Spec revision stays draft.
