# Pi current-design read and write hooks

Status: implemented
Translation: pending

## Abstract

Pi could previously edit a PPTD draft without receiving the canvas's saved manual
changes. A thin native extension now requests the shared design service's current
projection, attests exact successful complete read coverage and checks controlled draft writes
against a generation-frozen baseline. Final collection independently checks the
same attempt and artifact bytes before structural validation and canonical
compare-and-swap. The adapter is version-bounded and does not claim to sandbox
shell/custom tools; explicit conflict resubmission remains a separate slice.

## Ownership and decision

This implements the Pi slice of [read hooks](../../rejected/architecture/2026-09-10-design-sync-hooks.zh.md)
on top of [serial editing](2026-09-11-canvas-serial-execution.zh.md),
[trusted workspace paths](2026-09-11-design-workspace-paths.md) and
[lossless PPTD projection](2026-09-11-pptd-editable-roundtrip.zh.md).
The [workflow convergence proposal](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md)
owns explicit new attempts and candidate retirement. This note does not approve
or rewrite the draft Spec.

The existing machine-local RPC authenticates the same-user transport; the daemon
resolves Session, active invocation, artwork and workspace. Its canvas owner must
already have confirmed the desktop flush. No request supplies a data root or
artwork identity. An unknown invocation or unconfirmed save refuses synchronization.
The service reads one atomic canonical payload (document and embedded assets),
exports it, stages a complete projection and publishes at the fixed
`design-current/` path. Temporary publication directories are immediately removed,
never retained history. Neither drafts nor frozen inputs are projection targets.

Read evidence is one-shot and content-exact. The complete entry and pages of one
revision must be successfully returned across native Read ranges; image reads remain useful
but do not attest textual design completeness. Offsets and native truncation/limit continuation ranges qualify only for their
exact returned lines. Overlapping ranges do not fill holes; coverage never mixes
revisions. Each assistant generation captures existing eligible facts; same-batch
read/write execution cannot upgrade generated arguments. A draft attempt never
changes baseline merely because another read succeeds. Successful controlled
Write/Edit completion records the complete artifact digest; later unobserved byte
changes cannot inherit it. The finalizer checks trusted Session Agent identity,
not a removable manifest marker, and refuses missing in-memory facts after restart.

All already-saved canvases, including initial blanks, use the same initialization
rule. Inferring newness from an empty element list or absent draft would miss
manual background/size changes. Ordinary files are not design-controlled.

## Runtime evidence and launch

The registry pins `pi-acp@0.0.33`. Inspection of its published source map and bundle
shows that it spawns `PI_ACP_PI_COMMAND` or `pi` with `--mode rpc --no-themes` and
inherits the environment; it does not embed Pi or forward extension arguments.
The actual inspected Pi package is `@earendil-works/pi-coding-agent@0.85.1`.
Its `--extension` argument loads the bundled Folio extension without editing user
or project settings. A session-owned temporary executable shim forwards native
arguments and preserves the explicitly configured Pi executable, using existing
Session startup/retry/process ownership. Injection requires trusted durable design
Session metadata; ordinary and custom Pi sessions keep their prior launch. A
speculated process created before design identity exists is disposed and recreated
through the existing cold startup path. Pi's version is queried from that same
executable with a five-second bounded probe; unsupported or unknown versions refuse design-hook requests.

Published evidence:

- pi-acp npm integrity: `sha512-vX9kY1tK14E72G4dBAx+RGCk/k7XPjTHls6dLUxA8WSkBav6B6JHuSBv3eusp50LCR/GTRsR2kIKsG0Z5jANzw==`.
- pi-acp `dist/index.js` SHA256: `24ff73fda6e3c76ddce2d359a79f5c4b8f292eb290e4d2ab85aac94676b2c2dc`.
- Pi `dist/core/agent-session.js` SHA256: `fb8a3981c20c8c0bbd42231b1c99a10335fb3858b659056b341954de9cfa467f`.
- Pi `dist/core/extensions/runner.js` SHA256: `0de12ed1275e02595f92476eec3f61ae1f2e54fd2225ced721ddc90af58a5e61`.

Pi's native agent session awaits extension message events and forwards native
`beforeToolCall`/`afterToolCall` as `tool_call`/`tool_result`. Native Read returns
one text block with explicit truncation information; the service compares actual
returned bytes, not a fresh filesystem hash pretending delivery succeeded.
The observed parallel batch emitted all tool calls before read results; the
assistant-generation fence also protects a sequential runtime ordering.

## Verification and limits

`apps/cli/scripts/probe-pi-design.ts` runs the actual pinned ACP adapter and Pi
runtime against a synthetic local external provider. It exercises saved manual
change, real read hooks, rejected same-batch write, successful subsequent writes,
natural `end_turn`, preserved frozen input, intake and canonical commit. The
probe uses the real shared service/store but a synthetic control host: by itself
it is not Electron/MessageHandler acceptance. No paid model call or global/user
configuration mutation is needed. The separate `apps/cli/scripts/probe-pi-design-desktop.mjs` reuses Lody's
ElectronHarness, onboarding and actual provider settings. The successful macOS
round launched the Electron package and bundled CLI in isolated user/data roots,
added a native Bento shape, saved it through real IPC, dispatched Pi through the
ordinary composer, observed the same-batch tool error and subsequent legal writes,
then observed natural completion commit a changed background with the shape intact.
Only the external model response stream was scripted; Electron, IPC, MessageHandler,
canvas ownership, Pi ACP, extension tools and final collection were production code.
The successful run's final revision was
`5996bb643b63424eb3ad56d414e40cf19df2c05f50c33c4642c858ff547a3e72`.
The sealed production-bundle round waited for native `readonly=false` after finalization and retained a receipt screenshot at
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-t05-desktop-pXFGjL/evidence/committed.png`
and native canvas capture at the same directory’s `canvas.png`.
Runtime logs remain local (`/tmp/folio-t05-desktop-sealed.log`); no transcripts are committed.

That run exposed and corrected an actual integration defect: causal user input
`sourceTurnId` is distinct from the execution's stable `canvasTurnId`. An internal
execution getter exposes the latter only after preparation; hook ownership and
cleanup use that canvas ID, while frozen input and final baseline lookup use the
causal ID. No new wire identity is accepted from the caller.

Deterministic tests cover exact/failed/partial/duplicate/cross-revision reads,
generation isolation, no implicit rebase, ordinary files, projection-write refusal,
draft preservation and successful-write artifact binding. Shell and custom tools
have no universal hook guarantee. Linux/Windows executable shims require runtime
verification; source support is not a cross-platform acceptance claim.

Pi native Read is bounded at 2,000 lines / 50 KB and appends continuation framing.
The adapter removes only that framing; the service independently compares the
actual text with the pending read offset and merges complete line intervals.
The existing YAML serializer previously emitted a 60,006-character line for one
60,000-character unbroken scalar. Its double-quoted, 80-column folding preserves
that scalar exactly while making it readable using existing native continuations.
No format version or supported Bento content size changes.

The large native probe also passed with a 180,000-character scalar and four actual
native continuation reads. The complete chunk coverage tests preserve holes across
duplicate/out-of-order ranges and reject mixed revisions. The existing artifact collector accepts only root entry/pages/media, so fixed
projection and temporary publication source paths cannot be collected as Agent
output. The current CodeCollab workspace watcher refreshes a generic file index;
there is no design auto-import watcher. Generic file access/index refresh remains
available for current inputs; no speculative global path exclusion is added.

Validation: full `corepack pnpm check`, `corepack pnpm format`, `docs check`,
`git diff --check` and `corepack pnpm e2e:build` passed. Child test environments
removed inherited `ANTHROPIC_*`/`CLAUDE_CODE_USE_*` values without reading or printing
them. The focused CLI set passed 142 tests, exporter roundtrip passed 73, and the
bounded RPC continuation schema passed its regression. The native large probe
parses the exact production request schema before dispatch, closing the coverage
gap between a direct service host and the real daemon's offset/limit contract.

The integrated main revision `9944930` passed the full checks again and a freshly
built desktop replay of the same native Pi journey. It retained the manual shape,
rejected the early write, committed revision
`202122bd4472a61d8eae891a58105b3f1463ad33247ef31e9bd628eceecab2d9`, and restored
canvas editing after finalization. The root inspected the native canvas capture;
the external model remained synthetic. This replay includes the already integrated
result-card, thumbnail and PR workflow removals, but no later preview changes.

The wire preserves native numeric read parameters; positive-integer range checks
apply only after the service identifies a projection read. Native ordinary-file
behavior (including offset zero) is left to Pi. Final schema/service regressions
and CLI typecheck passed after this scope correction and the bounded version probe.
The final full check log is `/tmp/folio-t05-check-final.log`.
