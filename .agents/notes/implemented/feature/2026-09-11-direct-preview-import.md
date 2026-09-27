# Direct import of the displayed PPTD snapshot

Status: implemented
Translation: pending

## Abstract

An external PPTD preview can now be explicitly saved as the current artwork without
an intermediate candidate. The desktop retains the rendered document and embedded
assets, flushes current editors while holding their mutation gate, and uses the
existing atomic save. Refresh cannot replace the bytes of an accepted import, and
failures retain the preview and editor contents. A confirmed save remains a success
when a subsequent editor reload fails; the UI reports that distinction.

## Decision and responsibilities

This implements [T16 / Issue #18](https://github.com/LeonEthan/Folio/issues/18) under
the [design Spec](../../../../specs/graphic-design-platform.zh.md), extending
[manual previews](2026-09-11-manual-pptd-preview.md) and composing with
[automatic observation](2026-09-11-automatic-pptd-preview.md).

The existing preview view record holds its exact content in memory. The renderer's
explicit import request names artwork, consumer and displayed source identity. A
mismatched, closed or invisible surface refuses import; an accepted request retains
its original object while asynchronous flush or later preview replacement proceeds.
Nothing rereads authoring files at import time. The lifetime is the open view or an
in-flight request, without a persistent snapshot store.

The generic canvas access service holds the existing flush permit through save and
reload and registers the replacement among pending writes. Every canonical instance
flushes before the initial baseline is captured. Unknown execution state, execution
or artifact processing refuse import, including a state change while flushing or
queued behind another worker operation. A competing dispatch cannot pass its own
flush while this mutation owns the permit. The worker still performs independent
schema, kernel, asset and atomic version checks.

The preview record retains the first import baseline for retries. Existing store
idempotence recognizes bytes already committed after a lost response; a different
current revision conflicts rather than silently rebasing the import. There is no
Agent read-evidence fabrication, semantic merge, candidate lifecycle or workspace
rewrite. Passive observation still never saves. Only canonical content is editable
and eligible for formal export.

Holding the mutation gate through reload costs a short readonly interval. This is
preferable to allowing new human edits between flush and replacement. The import
result distinguishes storage acknowledgement from reload failure so a UI problem
cannot falsely report that a durable write was rolled back.

## Verification

Deterministic access and component tests cover flush/save failure preservation,
unknown/execution/processing refusal, a dispatch claim during flush, locked human
writes, repeated import attempts, exact displayed identity and truthful reload errors.
The existing native design verification exercises the production preview/worker,
asset replacement while import waits for an explicit flush signal, stale identity,
closed preview, lost-reply idempotence, version and asset rejection, preserved workspace
files and editable saved canonical content.

The full native journey passed on macOS arm64 with Electron 39.5.1 / Chromium
142.0.7444.265. Evidence is in `/tmp/folio-t16-native-o76yu8p6/evidence`:
`result.json`, `source-preview-result.json` and `source-import-result.json`.
The actual Session UI probe reused ElectronHarness with isolated application and
user data. It imported the last valid displayed document after the workspace source
became invalid, retained the invalid source unchanged, and saved a subsequent human
shape edit in the imported canonical. Evidence is in `/tmp/folio-t16-ui-IBzXiR`;
`preview-surface.png` and `canonical-surface.png` were inspected. Page screenshots
do not capture the separate native child view, so they are not canvas evidence.

Production CLI/desktop builds and docs checks pass. An initial full check passed
all tests but found two missing import translations; English and Chinese entries
were added before the final run. The final `pnpm check` passes, including types,
lint, tests, translations and platform/public boundaries. `pnpm format`, docs check
and `git diff --check` pass. No paid model, installed package, Windows or Linux
GUI execution was performed. The source preview's lifetime remains memory-only;
matching observed files does not establish a producer transaction or completion.
