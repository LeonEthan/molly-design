# First drag after selection regression

[Issue #21](https://github.com/LeonEthan/molly-design/issues/21) is scoped to a
first click-drag that selects another element but fails to move it. The originally
reported broad save-time stutter was not reproduced in the rebuilt application;
that is not a claim about performance on every machine or artwork.

## Run

```sh
pnpm e2e:build
pnpm --filter @molly/e2e exec tsx src/support/canvas-first-drag-probe.ts
```

This opt-in native regression is outside the active Cucumber journeys and smoke
gate. It consumes the built local desktop and rejects installed-executable
overrides. ElectronHarness owns an isolated profile, artwork storage, CLI endpoint
and process tree. The test uses two synthetic text elements, real native mouse
input, animation-frame checkpoints and the actual save service; no provider is
needed. Each run retains build hashes and measurements under the ignored
`e2e/artifacts/canvas-first-drag/run-*` directory.

The checks cover switching targets on the first drag, already-selected dragging,
a click without movement followed by a new drag, a gesture starting while saving,
and another after saving completes. The saving case starts from an explicit
save-start signal and asserts the canvas reported `saving` at the actual
mousedown; it does not assert a save duration or continuous saving throughout
the gesture. Every moving gesture must follow a 48×24-pixel pointer displacement
by more than 40×15 pixels, preserve the other element, and retain its preview
position after release. Snapping remains enabled.

Native dock Undo/Redo must restore the exact canonical documents. Readonly must
reject semantic commands and disable mutation dock buttons; this check does not
bypass the desktop overlay to inject mouse input into a locked native view.
Unlocking must restore dragging. A full isolated app restart must reopen the exact
saved canonical document. Uncaught canvas errors fail the probe.

## Failure and repair evidence

On source checkout `97356691fab65d59d6c28c21b9f9fab752824d73`, the original
selection handoff failed the first-drag assertion. Changing only the handoff to
synchronous `dragStart` still moved about four screen pixels and then threw
`Cannot set properties of null (setting 'dist')` inside Moveable. The same element
moved normally on its next gesture. Disabling snapping did not repair it.

The assembly fix also omits the redundant `updateRect()` when assigning a changed
target. Target assignment already updates its rectangle; queuing an additional
refresh before the target change is applied carries old target state into the
new gesture. Unchanged targets keep their existing rectangle refresh. The direct
handoff no longer leaves a promise waiting to replay a stale mousedown.

Manual acceptance and cross-platform interaction remain separate from this local
macOS regression. A passing probe does not mark the issue ready for closure.
