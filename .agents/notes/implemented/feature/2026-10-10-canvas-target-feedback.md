# Canvas target feedback: outline what Molly is changing and changed

Status: implemented
Translation: current

[中文](2026-10-10-canvas-target-feedback.zh.md)

## Abstract

After an Agent turn, the canvas gave no sign of which elements Molly had
touched, and nothing showed whether elements outside the person's selection
had changed too. The canvas now outlines referenced elements while their turn
runs, briefly outlines added or changed elements after a committed turn
reloads the open canvas, and separately outlines and counts changes outside the
referenced elements in a dismissible notice. The comparison is recomputed from
the canvas being replaced and the saved revision; it is never stored and never
blocks or repairs anything. Press-and-hold comparison with "Before Molly's
edit" is deferred because no non-mutating render of a history entry exists yet.

## Problem and evidence

Phase D of the [canvas click-to-edit proposal](../../proposed/feature/2026-10-10-canvas-click-to-edit.md),
approved by the owner on 2026-10-10. Lovart and Higgsfield present edits as
local to the clicked target; Molly's Agent edits the whole document, so the
person had to compare by eye to see what moved.

## Decision

- **Reuse ladder.** Reused the post-turn canvas reload
  (`syncDesignCanvasFromStore`), the frozen element references in the user turn,
  the conversation view's ranged hydration, and the toolbar's
  executeJavaScript presentation path. Rejected: persisting a per-turn change
  list in the turn outcome (new durable state for a derived view), computing
  the diff in the CLI from the frozen manifest (Electron must not read CLI
  workspace paths), and a React overlay (geometry lives in the native canvas).
- **Diff.** `diffDesignElements` (`@molly/shared/design-selection-commands`)
  compares elements by id with key-order-insensitive JSON: added or modified
  ids are `changed`, missing ids are `removed`, and stacking order alone is not
  a change. Electron snapshots the superseded canvas just before the reload
  (after the existing clean-state check) and diffs it with the saved document;
  `syncFromStore` returns the result, or `null` when no reload happened. The
  baseline is the requesting host's canvas, else the visible one
  (`selectChangeBaseline`); a retained hidden sibling may hold an older revision
  and is never used.
- **Attribution.** The renderer reads the committed turn's element references
  (walking back from an assistant id to its user turn) and splits changes into
  inside and outside. A turn without references owns every change, so no
  notice appears. Removed elements outside the references count toward the
  notice but cannot be outlined.
- **Outlines.** `window.molly.highlight(groups)` in the canvas draws tones
  `working` (dashed, persistent), `changed` (solid, fades after 2.4 s) and
  `outside` (amber dashed, fades after 6 s). A call replaces only the tones it
  names; an empty list clears all, so clearing the working outline cannot erase
  the post-turn outlines. Main validates groups with `DesignHighlightSchema`;
  the page itself takes no zod dependency. `highlight` resolves whether a ready
  canonical canvas received the groups. When the live source preview was on
  screen at commit, the canonical canvas attaches later, so the renderer keeps
  the post-turn groups and delivers them after that attach.
- **Running turn.** While `canvasState.turnId` is set, the referenced elements
  get a `working` outline on the canonical view and on every new preview frame
  (each frame is a fresh page; the preview service re-applies stored working
  outlines before showing it). If the canvas opens before the conversation index
  holds that turn, the lookup runs again once the turn is indexed.

## Validation

- Unit: diff and schema bounds (`packages/shared/tests/design-selection-commands.test.ts`),
  reference extraction, turn walking and attribution
  (`packages/components/tests/design-turn-elements.test.ts`), outline geometry,
  fading and tone replacement (`design-element-highlight.test.ts`), and canvas
  wiring for changed, outside and working outlines
  (`design-canvas-receipt.test.tsx`).
- Real Electron app on a cloned data directory (2026-10-10, Kimi For Coding
  HighSpeed): with only the headline selected, the prompt "Make this headline
  deep forest green, and change the subline color to match it" showed the
  working outline on the headline while the run was read-only; after commit
  the notice read "Molly also changed 1 element outside your selection", and
  Show outlined the subline. The automatic post-commit outline was not caught
  on screen within its 2.4 s window; it shares the call that produced the
  notice.
- The assembled Bento build copies `src/` modules by an explicit list; the new
  module needed adding there, which unit tests and `pnpm check` do not cover.

## Limits

- Feedback appears only when the canvas is open at commit; a later attach reads
  the store without outlines.
- Press-and-hold comparison with "Before Molly's edit" is not implemented.
