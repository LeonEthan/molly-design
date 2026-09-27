# Export captures prove the frame is current

Status: implemented
Translation: pending

## Abstract

`renderSavedDesign` captured the hidden render window after in-page readiness
(fonts, image decode, double `requestAnimationFrame`) and sometimes shipped a
compositor frame from before `document.body.replaceChildren(stage)` — the boot
splash — while the DOM already showed the finished artwork. The correction
proves freshness per capture: shoot a candidate, apply `invert(1)` to the
document element, shoot again, and require the second frame to be the pixel
inversion of the first. Only a live compositor rendering the current document
can produce that pair. Exhaustion throws instead of shipping; the fix lives in
`renderSavedDesign`, so export, Agent preview, and verification renders share
it.

## Problem and evidence

Diagnostic `12327` (exit 1, cleanup passed, no diagnosticErrors), evidence
`/tmp/folio-t29-export-frame-iUyTLa/evidence`: six alternating PNG/JPEG
exports of one saved poster; the corner-pixel assertion failed on exports 2,
3, and 5 with pixel `[44,28,16]` instead of the artwork `[242,246,247]`.
The same run's `capture-end` records show all six captures with identical
correct同期 DOM — a single `.bento-slide` with the artwork text, stage rect
0,0,1200,1800, no `#bento-splash` — and `export-stage-preparation` resolved
true every time. Raw `capturePage` bytes already bifurcated (three identical
4.6MB frames versus three ~1.1MB frames), so the fault is at capture, not in
PNG/JPEG encoding, and both formats failed. A viewed failing file shows the
deep-blue boot splash with the Bento logo and the Edit tools panel (already
reflecting the loaded 1200x1800 document) — a stale presented surface, not a
wrongly selected stage. The failure is nondeterministic (~30-50% per export),
which rules out a deterministic DOM bug and rules in a compositor race. No
new paid calls were made; the earlier paid bytes were reused.

## Decision

`captureVerifiedArtwork` in `design-service.ts` replaces the single
`capturePage`: candidate, in-page invert plus double RAF, second capture,
un-invert plus double RAF, then `frameIsInversionOf` over the two bitmaps.
The relation is per-pixel arithmetic (`a + b = 255` on three channels, alpha
unchanged), channel-order agnostic, content agnostic, with small raster
tolerances and a 0.99 match fraction. A stale frame cannot equal the inversion
of a stale frame except on a uniformly mid-gray surface, which no surface in
this flow resembles (documented residual in
`design-render-frame-core.ts`). The shipped frame is always the pre-mutation
candidate, so the handshake never alters output pixels. A 30-second bound
throws `Canvas capture did not settle on the saved artwork` — fail-safe like
the existing render timeout, never a fixed sleep that assumes readiness.
Cost is one extra capture per export. No Agent runtime, retry policy, or
process lifecycle changes.

## Verification and limits

The comparator is unit-tested at its own seam
(`design-render-frame-core.test.mjs`, 7 tests: exact inversion, BGRA order,
tolerance, frozen-frame rejection, splash-versus-inverted-artwork rejection,
alpha/shape rejection, fraction boundary). End to end, a minimal native loop
(`/tmp/folio-export-frame-repro.mjs`: import the verified saved poster,
export PNG 6x, assert each corner pixel) went red on the uncorrected installed
`50ddd41` build on its first run and green 18/18 across three runs of the
corrected source build. Those green runs also prove the handshake's premise:
had `invert(1)` rendered as identity or approximately, every export would
have thrown instead of passing. Source tests and static checks do not
establish installed behavior; full installed acceptance of the corrected
build remains pending with the release run.

## Later correction

The 18/18 result above remains evidence for the opaque poster and for this
historical implementation. It did not cover valid transparent or
semi-transparent PNG output: Electron's captured bitmap is premultiplied, and
a fully transparent canvas cannot carry the CSS inversion relation at all.
The pixel challenge was therefore replaced later the same day by
[bounded offscreen paint](2026-09-12-offscreen-paint-export-capture.md). This
note retains the original decision and evidence; it is no longer the current
render-capture design.
