# Transparent-margin sampling investigation

[Issue #15](https://github.com/LeonEthan/molly-design/issues/15) is reproduced by
ordinary HTML images without Bento, storage, or export resizing. On the tested
native DPR 2 configuration, rounding the destination edges before a Canvas2D draw
reproduces every HTML capture pixel, including both reported fractional failures.
The large discrepancy is caused by destination snapping in HTML image painting.
This finding does not establish a repair or change the exact-invariance target.

## Reproduce the mechanism

After the root dependency install, run from the repository root:

```sh
apps/electron/node_modules/.bin/electron packages/design-bento/scripts/probe-image-sampling.cjs
```

This is a standalone Chromium/Electron diagnostic, not application E2E. It needs
no Bento build, model, network, or user assets. The separate
[native application regression](../../e2e/TRANSPARENT-MARGIN-REGRESSION.md) remains
the product failure test; it exercises the actual built Molly export path.

Each diagnostic run creates its own profile and evidence directory under ignored
`e2e/artifacts/transparent-margin-mechanism/run-*`. It saves HTML captures,
unsnapped and snapped canvas controls, runtime versions, script hash, bounds,
observed device scales, and pixel comparisons. Exit 0 means the native snapping
model matched HTML and canvas readbacks matched captures, not that cropping is
fixed. Exit 2 means a diagnostic assertion or execution failed.

The minimized scene is one pair of images on a 512×208 background. It retains the
issue's synthetic pattern, compensated bounds, and 256-pixel column offset; the
original third row is translated upward by 416 integer CSS pixels. Separate runs
cover 1:1, 50%, 75%, the aligned 75% origin, and 623/858. The diagnostic compares:

- HTML images positioned and sized directly in CSS.
- Canvas draws using the original floating-point bounds.
- Canvas draws using measured DOM bounds, without additional rounding.
- Canvas draws with rounded destination edges, in emulated or native pixel space.
- Images at their natural dimensions, positioned and scaled with CSS transforms.

## Confirmed mechanism

At native DPR 2, the full 75% image starts at device coordinate (64,80). The
cropped image's intended origin is (601.5,111.5). Snapping it to (602,112) changes
the relative sampling origin by half a device pixel. Different interior colors
therefore appear even though transparent margins alone were removed. The aligned
crop starts on integer device coordinates and does not acquire that displacement.
At 623/858, independent edge rounding also changes the effective scale of the
two differently sized images.

The bundled Chromium version is 142.0.7444.265. Its
[`ImagePainter::PaintIntoRect`](https://chromium.googlesource.com/chromium/src/+/refs/tags/142.0.7444.265/third_party/blink/renderer/core/paint/image_painter.cc)
converts the destination to a pixel-snapped rectangle and supplies that rectangle
to the drawing operation. The version-matched
[geometry helper](https://chromium.googlesource.com/chromium/src/+/refs/tags/142.0.7444.265/third_party/blink/renderer/core/layout/geometry/physical_rect.h)
rounds the offset and computes the snapped size. This source evidence agrees with
the exact pixel match of the independently constructed snapping model.

Measured native DPR 2 results below count **raw device pixels**, before Molly's
final logical-size resize. Each entry is differing pixels / maximum channel delta.

| Case                | HTML full vs cropped | Rounded model vs HTML | Unsnapped canvas full vs cropped | Transformed images full vs cropped |
| ------------------- | -------------------: | --------------------: | -------------------------------: | ---------------------------------: |
| 1:1                 |                0 / 0 |                 0 / 0 |                            0 / 0 |                              0 / 0 |
| 50%                 |                0 / 0 |                 0 / 0 |                            0 / 0 |                              0 / 0 |
| 75%                 |          16714 / 106 |                 0 / 0 |                            0 / 0 |                              0 / 0 |
| 75%, aligned origin |                0 / 0 |                 0 / 0 |                            0 / 0 |                              0 / 0 |
| 623/858             |          15694 / 127 |                 0 / 0 |                         2256 / 2 |                           1265 / 1 |

The two failing raw HTML comparisons match the earlier native export probe before
resize. Final Molly exports have 4777 / 75 and 4529 / 90 respectively, as recorded
in the application regression baseline. Resizing changes the error's magnitude;
it does not introduce the original discrepancy. Direct Canvas2D pixel readback
and screenshot capture agree exactly for every canvas control in this run.

Layout quantization is separately observable: drawing 623/858 with measured DOM
bounds instead of the requested bounds gives 7840 / 3. That is distinct from the
much larger HTML discrepancy fully reproduced by destination snapping. Remaining
small differences in floating-point canvas draws and transformed images are not
attributed to a specific numerical or sampling implementation by this experiment.

## Device-scale evidence and limits

The physical display was DPR 2. CDP emulation in a normal hidden BrowserWindow
successfully reported DPR 1 and 3, with captures at the corresponding dimensions.
Earlier offscreen emulation crashed; that attempt supplies no coverage. Emulation
does not substitute for different physical displays or Molly offscreen export.

The same 75% HTML pair differs by 4148 / 107 at emulated DPR 1 and 37515 / 126 at
emulated DPR 3. Unsnapped canvas pairs are identical at 75% in all three runs.
However, modeling snapping on the _emulated_ pixel grid does not reproduce HTML;
the native grid still explains most of those captures. Even the native-grid model
has residual differences in some emulated cases, and the 50% HTML control fails
at emulated DPR 1 (978 / 43). Do not generalize the exact native-DPR-2 model match
into a claim that device emulation duplicates physical rasterization.

These step-2 results ruled out transforms or Canvas2D alone: both retained
nonzero differences at 623/858. The implementation below retains the strict
native regression. A proposed nonzero tolerance still requires its cause, scope,
and explicit maintainer acceptance.

## Evidence identity

Executed with Electron 39.5.1 / Chromium 142.0.7444.265, macOS arm64, native DPR 2.
Diagnostic script SHA-256:
`4892da9993c21512e32c965a7f1cefc29d7e63d011c91dd818c15317f4f28eae`.
The versioned Chromium image-painter source fetched for inspection had SHA-256
`68758a55701b5d9251c425a5481375fe38555c5fb2cef6311a2aa7bb44b2425f`.
The mechanism investigation preceded the rendering changes below; its evidence
remains a record of the original implementation.

## Implemented rendering path

`src/image-sampling.ts` adapts ordinary images through the temporary build tree.
The existing explicit crop/shape/border SVG pipeline and pinned vendor bytes are
unchanged. The ordinary-image path now:

1. Decodes the source once per renderer asset. Unprofiled 8-bit static PNGs use a derived bitmap
   containing the nonzero-alpha bounding rectangle plus two transparent pixels
   on each side. The copy is 1:1, without resampling; alpha 1 is retained.
   Animated, high-bit-depth, profile/gamma-tagged PNGs and other formats retain
   their original source. Temporary
   canvases are released after encoding; the renderer caches the derived URI.
2. Paints that bitmap at its natural size, applying the original image-to-frame
   scale and a compensated source offset through transforms. Numeric frame
   bounds supply initial placement. Reading them back from CSS first loses
   decimal precision and reintroduces fractional mismatches.
3. Keeps the editor's left/top/width/height fields intact. Derived margins and
   translation neutralize layout placement; a style observer follows live
   drag/resize changes. Rotation remains on the existing frame transform, with its origin set from
   numeric frame dimensions rather than the layout-rounded box.
4. Removes the inner clip only when the entire nonzero-alpha rectangle is
   strictly inside the frame, the source has transparent edges, and radius is
   zero. This condition is recomputed during resizing, including cover fit.
   Edge-touching/overflowing content and rounded frames retain their clip.
5. Requests a separate transform compositing layer for normalized images.
   This eliminated the measured DPR-3 residual before export resizing. Already
   normalized PNG inputs retain this sampling mode even if encoding produces
   the same URI. Other encodings keep their existing compositing behavior.

Workspace boot prepares referenced image assets sequentially before projection,
so the existing image decode/capture boundary sees the final sampling images.
Newly inserted assets prepare asynchronously in the same renderer cache; failures
surface as rendering errors. No sampling buffer enters BentoDoc, YAML, asset
storage or history, and no source coordinates are rounded or rescaled in storage.

The two-pixel border gives equivalent source samples to the reported crop pair,
including the aligned crop that retains only one transparent pixel at its far
edges. It is a tested rendering choice, not a claim of a universal filter-kernel
bound. Normalization is limited to unprofiled 8-bit PNGs: animation, other bit depths
and profile/gamma chunks retain the original encoded source to avoid silently
converting their color or precision. Crop invariance for those encodings remains
outside this evidence.

## Historical step-3 verification

The real desktop regression now passes all 18 row comparisons at observed native
DPR 2: original, repeat, aligned, 50% middle row, soft edges and aligned soft edges.
The test checks alpha-1 edge visibility, exact pixels, repeated PNG identity and
unchanged canonical data, YAML and assets. The historical baseline is preserved;
[implementation measurements](../../e2e/fixtures/transparent-margin-implementation.json)
identify the successful built renderer separately.

The focused native helper test runs independently of the full desktop:

```sh
apps/electron/node_modules/.bin/electron packages/design-bento/scripts/test-image-sampling.cjs
```

It loads the actual helper in Electron, checking alpha-1 preservation, nine live
frames across fill/contain/cover, and unchanged gamma-tagged, 16-bit, animated and
fully transparent source encodings. This verifies the helper, not app lifecycle.

An additional isolated renderer diagnostic checked live frame updates to
(0,0,64,64), (17.25,21.75,96,48) and (0,0,128,128) in fill, contain and cover.
Paint bounds matched the intended mapping and editable coordinates were preserved.
This was geometry evidence, not an actual pointer-gesture acceptance test.
Fill and contain also retained exact crop pixels in that diagnostic. Cover's
required clip retained the aligned fractional mismatch (476 pixels, delta 2);
the strict native fixture exercises fill and does not waive this limitation.

These were the limits at the end of step 3. The subsequent
[step-4 acceptance record](../../e2e/TRANSPARENT-MARGIN-ACCEPTANCE.md) records the
cover/rotation/compositing repairs, broader native matrix and real pointer save.
Human review, other physical displays and installed-package acceptance remain
separate; this work does not close issue #15.
