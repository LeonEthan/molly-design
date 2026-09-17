# Leave waits for a loading attach

Status: implemented
Translation: pending

## Abstract

`leaveDesign` read `window.folio.state()` on records whose attach was still
loading. A record exists from `records.set` onward while `window.folio` only
appears after the page commits, so a clean loading canvas reported `undefined`
state and raised a false "Canvas still has unsaved edits" dialog that blocked
close. The correction drains same-artwork loading attaches before reading any
record and re-checks until none remain. Load failure is handled by outcome,
not assumed away: a load rejected after `loadURL` failed has its record
destroyed, so the later per-record pass finds nothing; a load rejected later
(register/readonly) leaves a half-initialized record behind, and the same
per-record pass still protects it through the usual dialog. Selection and
re-check semantics live in testable `design-leave-drain-core.ts`.

## Problem and evidence

Diagnostic `93698` (exit 1, cleanup passed, no diagnosticErrors), evidence
`/tmp/folio-t29-export-leave-KdkskB/evidence`: `design.leave` started at
06:21:45.959Z, the old wc4 flush succeeded, then the check on the newly
attaching wc7 read `window.folio.state()` as `undefined` at 06:21:46.171Z and
showed the unsaved-edits dialog, while wc7's attach only finished at
06:21:46.694Z. Both instances ended dirty=false: a load race, not a dirty
draft and not a sidebar selector issue. The empty-canvas two-session control
diagnostic 55876 passed.

The misread window is `[records.set, preload-run]` inside one attach: tens of
milliseconds wide, so an external caller cannot target it reliably — renderer
IPC jitter alone is wider. The 06:21 run hit it because `leaveDesign` first
spent ~200ms flushing the old instance. No new paid calls, imports, or fixture
edits were used to establish this; the saved evidence above is retained
unchanged.

## Decision

`leaveDesign` now drains through `drainRelevantLoads` (new
`design-leave-drain-core.ts`, maps injected, no Electron import): with an
explicit `hostId` it awaits that host's loading promise; without one it awaits
loads whose host maps to the artwork plus loads with no host entry. The
no-host case is deliberate over-waiting: `hosts` records visibility intent,
not load ownership, so a hidden mid-load attach whose artwork is not yet
knowable cannot be filtered out — that only delays leave, never discards.
The drain loops until no relevant load remains, so an attach starting
mid-drain is covered too. Each awaited rejection is swallowed and falls
through to the existing per-record logic: a `loadURL`-failed load destroyed
its record (nothing to preserve), while a later-stage failure left a zombie
record that the same logic still protects via dialog. Init failure therefore
keeps the current protection, and `undefined` is never treated as
discardable. Selection, re-check, swallow, and host-scoping semantics are
covered by deterministic thenable tests
(`design-leave-drain-core.test.mjs`, 5 tests, no timers): a naive
single-pass, await-everything, or rethrowing implementation fails them.

`reloadDesignCanvas` shares the read-undefined-state shape but was left
untouched: the diagnosed symptom is leave-only, and the change stays minimal.
No Agent runtime, retry policy, or process lifecycle changes.

## Verification and limits

`leaveDesign` behavior on ready canvases is unchanged: a native regression
guard (`/tmp/folio-leave-race-repro.mjs`, dev-mode source build) opens fresh
sessions, calls `design.leave` on real attach cycles, and asserts leave true
with zero unsaved-edits dialogs — 3/3 rounds green. All three results record
`exercised:false`, so they prove only the routine ready-instance guard and do
not claim a second native hit on the initialization race. The
tens-of-milliseconds undefined window cannot be targeted deterministically
from outside this process, so old-code red versus new-code green on that exact
sub-window rests on the retained 06:21 evidence plus structural coverage: the
drain spans the whole load, which strictly contains the misread window. A load
that never settles would stall leave the way it already stalls attach; every
observed load settles. At that stage, full installed acceptance of the
corrected build remained pending with the release run.

## Follow-up readiness correction

The installed `bb7a424c1a0023a4ba0e9cb3fc5fe257b06a02f4` navigation diagnostic
at `/tmp/folio-t29-real-images-BOAVYz/evidence/result.json` showed that draining
the attach promise was necessary but not sufficient. An exact
`data-sidebar-session-id` row click invoked `design.leave` for the old artwork.
The new canonical WebContents emitted `did-finish-load` at 10:28:22.789Z and
`design.attach` returned at 10:28:22.792Z, but one millisecond later leave opened
the native unsaved-canvas dialog with `Canvas is not ready; edits are retained`.
No hash or popstate event followed, so the URL stayed on the old Session until
the 60-second diagnostic bound expired. Cleanup passed. This rules out the
tooltip/title selector and directly demonstrates that the attach promise's old
end boundary did not establish the generic canvas API's readiness.

The earlier claim that the attach load _strictly contains_ the missing-
`window.folio` interval is therefore corrected. Bento already tracks a real
font-backed `ready` state for its editor-status message. Its generic
`folio.state()` now exposes that state and the product session emits
`folio:ready` at the same transition. Electron installs the event listener and
performs an immediate check to close the already-ready race; attach proceeds
only when `state`, `snapshot`, `flush`, and `setReadonly` all exist and
`state().ready` is true. A main-process 30-second deadline bounds failure even
when the renderer is stuck; it never marks the canvas ready. Failed readiness
destroys the half-open instance through the existing attach cleanup, and the
later leave path continues to protect any dirty/composing/saving state rather
than treating it as discardable.

The normal installed package built from
`567741bde4b0459e33711687ab438aaae70caafb` then passed the retained full
journey at `/tmp/folio-t29-real-images-nPfTcw/evidence/result.json`. The actual
hard-reload transition hit the original overlap: the prior poster attach ran
from 10:53:00.007Z through 10:53:00.664Z while the exact second-session row was
clicked, and leave completed at 10:53:00.666Z with no native unsaved-canvas
dialog. The route reached the requested Session and the journey continued
through its 12-image canvas and same-profile restart. This installed run is a
bounded regression of the observed failure, while the focused ready-before,
ready-after and main-process-deadline tests provide the deterministic contract
coverage.

A separate process opened the copied profile and found both canvases ready and
editable with their exact snapshots, saves and version histories intact. It
also passed owned-process and endpoint cleanup; evidence is
`/Users/macmini/copied-profile-verification-akD0AA/result.json`. These automated
results do not supply the pending human editing verdict.
