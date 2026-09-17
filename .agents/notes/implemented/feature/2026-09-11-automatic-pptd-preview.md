# Consumer-scoped automatic PPTD previews

Status: implemented
Translation: pending

## Abstract

An open source preview follows actual changes to its PPTD entry, referenced page and
required assets without committing them. Consumers of the same source share one native
watch and one serialized observation/conversion, while each keeps an isolated readonly
Bento surface. Invalid or changing drafts retain the last valid surface; closing the
last consumer releases watching and cached observations. This observes bounded stable
bytes, not a producer transaction or Agent completion.

## Decision and ownership

This implements [T15 / Issue #17](https://github.com/LeonEthan/Folio/issues/17), extending
[manual previews](2026-09-11-manual-pptd-preview.md) under the existing
[live preview proposal](../../implemented/architecture/2026-09-11-pptd-live-preview.zh.md).
The existing native watcher was unsuitable unchanged: it recursively discovers
non-ignored directories and keeps its discovered watches until removal. Its explicit
`trackedOnly` mode reuses the native error, debounce and close paths while disabling
discovery and ignore-control semantics. Default file-index consumers are unchanged. Electron bundles this source-only workspace
package through its existing dependency exclusion list; externalizing it produced a
native CommonJS export failure during verification.
Only validated dependencies and their ancestors are watched, including hidden draft
paths; no directory enumeration or historical workspace activation occurs.

The real Session UI revealed that the prior source resolver rejected a missing entry
before a watch could be installed. Current-source resolution now admits only ENOENT
at the trusted expected entry; historical requests retain existence/type/root checks.
No resolver creates directories or files.

The collector reports validated references before reading missing files. Dependencies
are installed and re-observed before publication, with at most two dependency-change
retries per drain. Invalid input retains known dependencies until a valid observation
can replace them. Parent watches cover first creation, directory replacement and
atomic rename; removed dependency watches are released. Missing filenames trigger
only the tracked closure. Filesystem events invalidate old conversion/render generations
immediately, and the existing debounce has a maximum wait under continuous traffic.

Electron owns consumer lifetime, sharing and status; the existing design worker owns
the bounded double observation and PPTD intake. Equal exact path/content identities
skip intake; consumers with the same identity keep their native view. A dirty input
coalesces behind one in-flight observation/publication. Rendering consumes frozen bytes,
never rereads changing assets, and source/host generations prevent old results from
replacing newer views. Native renderer loss, navigation and window closure release
subscriptions, as do inactive or closed source views.

Opening/reopening, reconnect, focus, manual refresh and observed finalized history
reconcile exact files. Watcher failures show automatic updates as unavailable and leave
manual refresh usable. This does not add polling, a conversion process, a persistent
preview store or Agent scheduling. Projection, canonical storage and preview/export
outputs cannot enter the validated source closure. Preview publication has no save,
baseline, receipt or completion path; formal collection and atomic commits remain
independent. Direct import is the separate T16 slice.

## Verification

Deterministic coverage exercises exact content deduplication, missing/new dependencies,
hidden ancestor creation, rename, removed watches, coalescing, multiple consumers,
old/closed observations and retained canonical attachment behavior. The existing
opt-in native design journey adds actual file events for a missing asset, page rename
and same-path image replacement, alongside readonly/no-save and unchanged-canonical
checks. The macOS arm64 Electron 39.5.1 native journey passed at
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-t15-native-final-ha815l0z/evidence`
(`result.json` and `source-preview-result.json`). Its hidden-window capture is not
visual evidence; the separate existing ElectronHarness Session UI probe produced a
nonempty inspected `preview-surface.png` in `/tmp/folio-t15-ui-HKX44Q`, with `result.json`.
That UI probe opens before the entry exists, writes an external project, observes
automatic ready/waiting status without Refresh clicks, and verifies readonly zoom,
return to canonical and preserved undo.

Production build, focused tests, refreshed CLI typecheck/lint and documentation checks
pass. The first full check encountered two unrelated Claude authentication test failures
under inherited provider overrides; both pass in the clean child environment (31 tests).
The full clean `pnpm check` passes, including typecheck, lint, tests, i18n, imports and
platform/public boundaries. `pnpm format`, `docs check` and `git diff --check` pass. No paid Agent, installed package,
Windows or Linux GUI run was performed; actual five-Agent writes use this common
filesystem path but were not each executed in this slice. Missing filesystem events
are compensated by explicit consumer reconciliation, not a promise of lossless watching.
