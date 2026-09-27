# Export captures use bounded offscreen paint

Status: implemented
Translation: pending

## Abstract

The earlier pixel-inversion handshake prevented stale hidden-window exports for
the observed opaque poster, but its bitmap relation rejects valid transparent
and semi-transparent PNG content. `renderSavedDesign` now uses Electron's
offscreen `paint` path, keeps painting stopped while the editor loads and the
saved stage is prepared, then captures a bounded explicitly requested repaint.
This removes the pixel-format assumption; installed full-Bento regression of
the changed render path remains required before T29 can pass.

## Problem and correction

The original failure and its retained evidence are recorded in
[Export captures prove the frame is current](2026-09-12-export-capture-frame-verification.md).
That decision compared `NativeImage.toBitmap()` bytes before and after a CSS
`invert(1)` filter. It passed 18/18 exports of the opaque poster in the corrected
source build, but that evidence did not cover the Spec's PNG transparency
contract.

The relation is invalid for transparent output. A fully transparent frame has
no visible inverted color and therefore cannot satisfy a content challenge. On
Electron 39.5.1, the frame subscriber installs captured pixels as premultiplied
N32 Skia bitmaps; for a semi-transparent pixel the original and inverted RGB
bytes sum approximately to alpha, rather than 255. The deterministic command
below exercised the actual comparator with a 50% alpha premultiplied pair and
failed as expected:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --input-type=module -e "import assert from 'node:assert/strict'; import { frameIsInversionOf } from './src/main/services/design-render-frame-core.ts'; const a=128; const p=Uint8Array.from([50,75,100,a]); const q=Uint8Array.from([78,53,28,a]); assert.equal(frameIsInversionOf(p,q),true)"
```

Electron also documents `toBitmap()` as platform-dependent raw bytes, so a
channel-layout-dependent comparison is not a portable product contract. The
relevant pinned source is Electron 39.5.1's
[frame subscriber](https://github.com/electron/electron/blob/v39.5.1/shell/browser/api/frame_subscriber.cc).

## Decision

`renderSavedDesign` still creates one isolated render-only window per output,
loads the same trusted Bento editor surface, waits for fonts and images, moves
the exact saved stage to the 0,0 viewport, resizes to the logical canvas size,
and encodes with the existing native PNG/JPEG methods. The window now enables
Electron offscreen rendering and stops painting immediately after construction,
before navigation. The saved stage is therefore loaded and prepared while
painting is stopped.

After preparation, `capturePresentedFrame` installs one `paint` listener,
starts painting, and calls `invalidate()`. The first non-empty paint may be a
queued frame when a stopped renderer resumes; the helper discards it and asks
Electron for another full repaint, returning the next non-empty frame. This is
a bounded workaround for the observed queue behavior, not a claimed mapping
between a paint callback and a DOM mutation: Electron exposes neither a
mutation token nor a presentation sequence to JavaScript. A 30-second abort
removes the listener and stops painting; `renderSavedDesign` then destroys the
window and disposes the isolated surface on every outcome.

The implementation never reads or transforms pixel channels and applies no CSS
challenge to the artwork. It adds no scheduler, storage, IPC, Agent lifecycle,
repair, or retry protocol. Export, Agent preview, and verification rendering
continue to share `renderSavedDesign`.

## Alternatives and evidence

Adding alpha-aware arithmetic to the inversion check was rejected because it
still cannot verify a fully transparent valid canvas and would retain a
platform-dependent bitmap contract. A headed-window
`beginFrameSubscription` probe returned the expected premultiplied frame, but a
second run missed the post-mutation callback; Electron implements that API with
a frame-sink video capturer and exposes no mutation sequence. Fixed sleeps and
byte stability remain unsuitable because the stale splash was already stable.

Two isolated Electron 39.5.1 probes exercised the selected native raster path
without a model, network request, or user profile. A 120×80 window produced a
240×160 Retina offscreen frame with semi-transparent center BGRA
`[25,50,100,128]`, and a fully transparent frame with `[0,0,0,0]`. A stopped
renderer also exposed the queued first-frame behavior that motivates the extra
repaint. These probes establish alpha preservation and the selected event path,
not the complete Bento export regression.

`design-render-frame-core.test.mjs` covers fresh-frame selection, empty-image
retry, abort cleanup, pre-aborted calls, and setup/repaint failure without
timers. Together with `design-leave-drain-core.test.mjs`, 11 focused tests pass;
the Electron node TypeScript project also passes direct `tsgo`. A rebuilt
package must still rerun the retained poster stale-frame reproduction and
exercise real Bento PNG transparency, JPEG white fill, exact dimensions, and
failure cleanup before this correction can close T29.

The integrated repository `pnpm check` and `pnpm format` pass after this
correction and the preserved leave-loading follow-up. The combined check includes
typechecking, tests and public-boundary validation; it does not run the pending
installed Bento export regression.

## Later correction

The installed package disproved this paint-sequence decision, and Electron's
OSR source confirms that `invalidate()` can recomposite cached backing. The
replacement and retained failure evidence are recorded in
[Export captures use Chromium forced redraw snapshots](2026-09-12-devtools-forced-redraw-export-capture.md).
