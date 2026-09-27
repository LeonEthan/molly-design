# Transparent-margin crop regression

[Issue #15](https://github.com/LeonEthan/molly-design/issues/15) requires removing
only transparent margins to preserve visible sampling when image-to-canvas
coordinates are compensated. This focused native regression records the original failure and now passes
with the assembled rendering fix at native DPR 2. It is opt-in, outside the active
Cucumber journeys and default smoke gate. It does not mark the issue complete.

## Run

Prepare the documented ACP core/DSH submodules and root dependencies, then:

```sh
pnpm e2e:build
pnpm --filter @molly/e2e exec tsx src/support/transparent-margin-probe.ts
```

The probe consumes that build without rebuilding. Unset installed-executable
harness overrides: this command records local build hashes, not package identity.
Each run creates a new ignored `e2e/artifacts/transparent-margin/run-*` directory.
Exit codes are 0 for exact pixel invariance, 1 for a measured pixel mismatch, and
2 for setup, assertion, evidence, or teardown failure. A known failure is never
converted into success or a skipped assertion.

The existing ElectronHarness launches the real desktop with isolated data and
endpoint ownership. Fixture setup calls the bundled CLI design worker. The normal
renderer IPC invokes `design.export`, including the production storage read,
Bento projection, native capture, resize, and PNG encoding. The save dialog alone
is redirected to the run's output path and restored in `finally`. No export
function is copied, extracted, or replaced; no provider/model is needed.

Synthetic source pixels use the issue's pattern and crop rectangles. NativeImage
encodes the BGRA bitmap as PNG without resizing. The fixture unit test verifies
both crops against the full bitmap. The original 512×624 scene retains the three
issue comparisons; separate scenes repeat it, align the crop origin to [16,20],
and replace the middle comparison with 50% scaling. Two additional scenes use
soft edges with alpha values starting at 1, at both crop origins. The other rows
remain present; a non-background alpha-1 edge pixel must survive export.

Every scene compares all RGBA channels at a 256-pixel column offset, split into
three 208-pixel rows. A blank or incorrectly sized export cannot pass. Creation
must preserve fixture elements and assets; export must preserve canonical data,
YAML, and projected assets. Repeat export bytes must match. The device scale is
observed inside the actual export window, alongside the primary display scale.

## Recorded failure before a fix

[Baseline metrics](fixtures/transparent-margin-baseline.json) contain synthetic
measurements, source checkout, actual build hashes, and runtime versions from the
local macOS arm64 build. The checkout ID is source context, not a packaged-build
claim. The renderer hash matches the issue's reported editor hash.

| Comparison at observed DPR 2 | Differing pixels | Maximum channel difference |
| ---------------------------- | ---------------: | -------------------------: |
| 1:1                          |                0 |                          0 |
| 75%, crop origin [17,21]     |             4777 |                         75 |
| 75%, crop origin [16,20]     |                0 |                          0 |
| 50%                          |                0 |                          0 |
| 623/858, crop origin [17,21] |             4529 |                         90 |
| 623/858, crop origin [16,20] |             4331 |                         37 |

The baseline is historical evidence, not the oracle: the test always requires
zero differences. Updating a baseline cannot make a failing test pass. Run
artifacts retain fixture JSON, exported PNGs, a report/failure status, desktop
screenshot, trace, CLI backlog, process/memory snapshot, and harness diagnostics.
Only synthetic metrics are tracked; runtime logs and transcripts remain ignored.

This baseline establishes the failing native reproduction, not repair or
installed-package/human acceptance. The separate
[mechanism investigation](../packages/design-bento/IMAGE-SAMPLING.md) isolates
HTML destination snapping with a minimal diagnostic. Other physical device scales, shadows, rotations and human acceptance remain
unverified. The rendering change and its limits are recorded in that document.

## Implementation verification

[Implementation measurements](fixtures/transparent-margin-implementation.json)
record a separate passing build: all 18 row comparisons have zero differing
pixels, with original/repeat identity, alpha-1 visibility and unchanged storage.
This is a native macOS arm64/DPR-2 result. The original baseline remains unchanged.
Cover/rounded-frame clipping and the remaining acceptance matrix are not covered
by this fill-mode fixture; see the renderer investigation before broadening claims.

## Expanded acceptance

Use `--acceptance` to add contain/cover, soft-edge drop shadows and compensated
15°/360° rotations at both crop origins. All 48 row comparisons remain exact;
a pixel beyond the unshadowed subject must darken to prove the shadow rendered.
`--editing` additionally attaches the real editable canvas, selects/drags the
first image through native pointer input, closes it, and checks the saved bounds
and unchanged assets. This intentional edit occurs after that scene's export
invariance checks. The requested motion avoids the main snap guides; persisted
coordinates are compared with the observed movement, including native snapping.

`MOLLY_CROP_DEVICE_SCALE=1` or `3` passes Chromium's scale override at process
launch. The probe requires the requested scale to be observed in each actual
export window. An unsupported override fails setup; it cannot count as coverage.
These are forced-scale runs on a DPR-2 display, not additional physical displays.
See the [acceptance record](TRANSPARENT-MARGIN-ACCEPTANCE.md) for commands,
results, source identity, and remaining review.
