# Manual readonly PPTD preview

Status: implemented
Translation: pending

## Abstract

The canvas can now open and manually refresh the current Session's authoring files
without submitting them. A separate readonly Bento surface renders a frozen,
content-identified document and asset snapshot while retaining the canonical editor.
Incomplete or changing files retain the last valid preview and show a waiting state.
Two matching observations establish only an observed draft, never author completion;
watching and direct import remain separate work.

## Responsibilities and scope

This implements [T14 / Issue #16](https://github.com/LeonEthan/Folio/issues/16), the
manual-open part of the [live preview proposal](../../implemented/architecture/2026-09-11-pptd-live-preview.zh.md).
The existing `design/source-path` resolver accepts an absent turn ID only to resolve
today's source from trusted Session metadata. Supplied turn IDs keep the historical
frozen-input/root checks; failed historical lookups never fall back to today's draft.
The existing CLI design worker performs snapshot collection and intake; the daemon
returns no image bytes and the renderer cannot nominate an arbitrary filesystem path.

`collectAuthoring` has a reference-only mode: one entry, its referenced page and the
existing semantic enumerator's required media/font files. Unrelated files are not
read. File handles reject links and compare identity/metadata around reads, with
16 MiB per-file and 48 MiB total observation limits. Two full observations compare
names and exact bytes before the first frozen map enters the existing importer.
Same-path asset replacement changes the source digest and embedded asset identity.
This deliberately avoids a new converter or a producer publish/finalize protocol.

Electron reuses the isolated Bento resource surface. Preview surfaces have no save
route and never register for canonical flush/execution ownership. Host/artwork/request
generations discard late resolution or rendering after a newer request or closure.
Switching preserves the canonical instance, undo state, and the existing execution
lock. Source status explicitly labels unsubmitted drafts; current-artwork copy/export
controls are disabled in source mode. Formal collection, commit and export paths
remain independent, with no baseline, turn status or revision writes from preview.

The snapshot entry point can be reused by T15; no watcher, polling, import/adoption,
candidate catalogue, result card, thumbnail, or Agent scheduling was added here.

## Verification

Deterministic tests cover unchanged frozen bytes, same-path assets, ignored unrelated
files, unstable observations, missing references, and current versus historical source
resolution. Electron generation tests cover late refresh, closed hosts and changed
artworks. Component tests exercise repeated selection while refresh is pending and
rapid return to the canonical view while its earlier attachment is still pending.

The existing opt-in synthetic desktop journey passed on macOS arm64 with Electron
39.5.1 / Chromium 142.0.7444.265. Its production worker and native Bento surfaces
verified initial waiting, invalid-result retention, same-path image replacement, late
result rejection, execution-time readonly, absence of a preview save route, unchanged
canonical content, and preservation of the canonical instance and undo/redo history.
Evidence: `/tmp/folio-t14-native-wQrRQ1/evidence/source-preview-result.json`; the complete
existing design journey also passed in that directory's `result.json`.

A separate existing ElectronHarness probe exercised the real Session UI and trusted
source-path IPC: manual open, external authoring-file writes, manual refresh, invalid
refresh retention, returning to the same canonical editor and undoing its earlier edit.
An actual wheel zoom changed the preview viewport while leaving document bytes and
readonly state unchanged. Evidence: `/tmp/folio-t14-ui-jtEogW/result.json` and
`preview-surface.png`. Both probes isolate application and user data and use only
synthetic content; no captured user or Agent transcript is committed.

Native investigation found that `HTMLImageElement.decode()` could remain pending in
the hidden Chromium surface after image loading completed. Readiness now uses image
load/error signals and dimensions, including SVG image references. The candidate
surface receives a positive viewport while attached and hidden before publication.

Repository formatting, the full check, production build and documentation checks pass.
This evidence covers the development desktop on macOS; packaged and other-platform
runs, automatic watching, import/adoption and paid Agent execution were not tested.
Matching observations and successful rendering make no author-completion claim.

Integration retained the pre-existing permission isolation and save-before-close
rules omitted while compressing the source-level instructions. Design service
contracts now live in `apps/electron/src/main/services/AGENTS.md`, with an explicit
trigger in the parent covering views, IPC, renderer consumers and execution flush.
This changes instruction placement, not product behavior.
The parent decreased from 8,183 to 7,233 bytes. Counting each ancestor once, an
unrelated renderer path decreased from 23,857 to 22,907 bytes; a design service
path reads 24,191 bytes including the 1,284-byte child. Design IPC callers read
that child conditionally through the parent trigger, rather than through ancestry.
