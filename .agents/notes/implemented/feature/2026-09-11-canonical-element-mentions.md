# Canonical element mentions

Status: implemented
Translation: pending

## Abstract

T12 lets a user select current Bento elements and continue in the ordinary composer.
The existing mention range stores the artwork, saved revision and stable IDs, then
expands them into the ordinary prompt. The desktop saves pending edits before
capturing the revision; both the send gate and daemon frozen-input path reject stale
references. This reuses composer persistence and Agent execution without a reference
manager or temporary-preview targeting. Native and repository verification is recorded below.

## Decision

The [Spec](../../../../specs/graphic-design-platform.zh.md) and
[scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)
require current canonical identity, not browser annotations. Existing visual annotation
anchors identify DOM selectors and viewport rectangles, so reusing that payload would
misrepresent the target. Existing mention insertion, ranges, expansion and transcript
spans already carry stable identities without another chat content block or storage layer.

The generic Bento selection bridge is read-only and knows no Agent lifecycle. Electron
accepts only its visible canonical host while idle, remembers IDs, flushes pending
edits, and reads the post-save revision. Fresh unsaved edits can therefore be referenced;
a previously inserted reference retains its older identity after further changes.
The source-preview host never registers as a selection source. A view switch during
capture refuses the result; an active IME composition in the composer refuses insertion.

The mention label is display-only. Its persisted range value expands to a bounded
`folio-elements` JSON marker with artwork, baseline and IDs. Both the renderer after
save and the daemon before frozen input use the same canonical validation; the daemon
rechecks frozen references on recovery. Invalid references remain in the input draft or
accepted history for explicit correction, and no revision is silently refreshed.
Existing attachment blocks, provider tools, structural validation and final CAS are unchanged.

## Verification

Both full `corepack pnpm check` runs, the final local Electron build, `pnpm format`, and
`pnpm run docs check` passed. Focused tests cover real mention insertion and focus,
IME refusal, persisted-range expansion, attachment-preserving frozen input, post-flush
baseline validation, artwork mismatch, deleted IDs, stale revisions, and frozen-input
recovery without changing the stored marker. Final source checks passed before seal.

On macOS arm64 with Electron 39.5.1, actual Bento pointer selection inserted a mention
in the normal composer and restored focus. Real Pi 0.85.1 through pi-acp 0.0.33 read the
current projection through native hooks, wrote the selected element's fill, then
naturally finalized and committed. Two elements remained; the unrelated element was
deep-equal and the background unchanged. The preview reference button was disabled;
a reference request during a deliberately held Agent execution was explicitly refused.
The canonical editor unlocked after commit. Native screenshots were inspected.

The probe reused `ElectronHarness` with independent Electron data, CLI data and endpoint;
only the model wire was synthetic. Its private pi-acp cache was prewarmed after an
initial npx extraction race. A preceding probe correctly refused an empty selection.
All final native assertions passed; cleanup subsequently hit ENOTEMPTY removing the
isolated temporary data directory after application/port teardown. This is recorded
rather than represented as a clean harness exit. A subsequent process audit found no
owned Electron/daemon/Pi processes or working directories; only empty Session directories
remained, and the harness’s explicit endpoint-release check had passed. Synthetic probe outputs and screenshots
remain outside Git; no captured transcript is committed.

No paid-model visual-quality judgment or Windows/Linux installation claim is made.
This implementation does not approve the draft Spec.
