# Preserve the first drag when canvas selection changes

Status: proposed
Translation: pending

## Abstract

Switching to another canvas element with a click-drag could select it without
moving it, making continued editing feel delayed. The proposed assembly adaptation
hands the current gesture directly to Moveable and avoids refreshing the old
target while a new target is being assigned. The focused native regression now
exercises movement, save overlap, history, readonly commands and reopening.
The fix remains pending manual acceptance; it does not establish a general
save-performance improvement.

## Scope and ownership

[Issue #21](https://github.com/LeonEthan/molly-design/issues/21) was narrowed after
manual testing of a rebuilt application no longer reproduced broad save-time
stutter. Memory pressure was reported as a possible contributing condition and
was not independently measured. Save debounce, storage, Agent lifecycle and
memory policy are outside this correction.

Bento owns selection and dragging. The Molly builder adapts the temporary
assembled canvas; the pinned vendor tree and provenance remain unchanged. This
supersedes the assembled behavior of the historical
`canvas-moveable-deferred-dragstart` patch recorded in the
[vendor migration note](../../implemented/architecture/2026-09-21-vendor-bento-in-tree.md),
without rewriting that source record.

## Evidence and decision

The two-element native reproduction fails on the original handoff. A synchronous
handoff alone moves only the first few pixels before Moveable throws because
`dragInfo` becomes null. Native pointer events and computed distances continue;
disabling snapping does not fix the failure. Keeping synchronous handoff while
removing the extra rectangle refresh on a changed target makes the same gesture
follow its pointer. These experiments isolate the target/gesture transition from
save latency.

The pinned vanilla Moveable adapter flushes a pending target update in
`dragStart`; target updates already recompute the target rectangle. Calling
`updateRect()` before that target update settles also schedules state for the old
target. The adaptation lets assignment own changed-target geometry and retains
`updateRect()` for unchanged targets. The obsolete deferred handoff and its
mouse-down guard are removed together, so a released gesture cannot be replayed
by a later selection. No dependency update or runtime-library patch is needed.

## Verification and limits

The [native regression](../../../../e2e/CANVAS-FIRST-DRAG-REGRESSION.md) documents
its command, synthetic fixture, assertions and baseline. It checks actual saved
data after restart and records the saving state at native mousedown. Readonly
coverage uses the public command boundary and disabled controls; it does not
inject native mouse events past the desktop's readonly overlay. Automated native
results are local macOS evidence; human acceptance and other platforms remain
outstanding.
