# Reject incomplete smooth-line segments before canvas startup

Status: implemented
Translation: pending

## Abstract

A smooth line with an incomplete group of Bézier control points passed YAML intake
and canonical save, but threw in the pinned renderer before the editor published
its product API. The desktop then reported a misleading readiness timeout.
Admission now checks the renderer's existing point-count constraint after kernel
replay, shared by authoring and the canonical store. Existing invalid files return
an element-specific error without changing their bytes; restoring their intended
geometry remains an explicit content edit.

## Evidence and decision

The live Electron renderer reported the smooth-line point-count exception before
`window.molly` existed. Synthetic three-point lines independently reproduced both
successful intake and successful persistence before the fix. The renderer treats
two points as a straight line, and longer smooth paths as cubic segments with
`1 + 3k` points. YAML conversion preserved the points; kernel replay omitted this
renderer-specific structural constraint.

`assertRenderableLines` adds that small constraint in design-authoring and is
called after replay by both projection admission and the CLI store. The pinned
vendor remains unchanged. Importing the complete renderer would pull its DOM and
geometry dependencies into the authoring bundle; the small structural adaptation
keeps those runtime boundaries intact. Extending the deadline cannot fix this
initialization exception. Changing curve mode or inserting points would silently
change the artwork, so neither is performed.

The existing roundtrip fixture also contained an invalid three-point smooth line;
it now uses a complete cubic segment. Agent format documentation explains control
points versus sampled polyline points. No new creative-step requirement is added.
This corrects implementation to the existing rendering contract; no Spec intent
or approval changes.

## Verification

- New intake regressions reject 3, 5, 6 and 8 smooth points and accept 2, 4, 7 and
  10 points, plus three-point sharp/round polylines.
- Store regression fails before the fix and passes afterward: rejected writes
  preserve canonical bytes; historical invalid files return the concrete error
  without rewriting bytes.
- Authoring suite: 136 passed, one unrelated history assertion failed because the
  checkout's Git log contains no PPTD/Folio subject.
- CLI design tests: all 172 tests across 22 files passed. Repository typecheck,
  lint, document check, import/platform/public boundaries and diff checks passed.
- `pnpm check` stopped at the unrelated Git-history assertion. Separately running
  its remaining checks found missing `design.sizeMode` and `design.autoSize`
  translations in the existing canvas-size selector; boundary checks passed.
- `pnpm format` passed. `pnpm start:local` rebuilt the bundled CLI and desktop,
  and the application restarted successfully with these changes.
- Original user artwork was not modified, as explicitly requested. Restart is
  not visual recovery evidence for that invalid artwork.
