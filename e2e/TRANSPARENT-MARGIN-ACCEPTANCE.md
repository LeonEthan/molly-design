# Issue #15: step-4 acceptance

The synthetic native matrix passes with exact pixels at native DPR 2 and forced
Chromium DPR 1/3 on macOS arm64. There is no accepted nonzero tolerance. This is
built-desktop technical evidence. The maintainer accepted the synthetic native
visual review on 2026-09-27 (UTC), completing Step 4 within the recorded scope.
Repository closeout and issue closure remain open.
[Recorded measurements](fixtures/transparent-margin-acceptance.json) include
runtime/build identity, every row result, pointer-edit evidence and source hashes.

## Run

After the documented dependency/submodule setup, build once:

```sh
pnpm e2e:build
pnpm --filter @molly/e2e exec tsx src/support/transparent-margin-probe.ts --acceptance --editing
MOLLY_CROP_DEVICE_SCALE=1 pnpm --filter @molly/e2e exec tsx src/support/transparent-margin-probe.ts --acceptance
MOLLY_CROP_DEVICE_SCALE=3 pnpm --filter @molly/e2e exec tsx src/support/transparent-margin-probe.ts --acceptance
apps/electron/node_modules/.bin/electron packages/design-bento/scripts/test-image-sampling.cjs
pnpm e2e:check
pnpm e2e:smoke
```

Run desktop probes serially. Each owns its profile, data, endpoint and evidence.
The native probe uses normal desktop export; it does not replace capture or resize.
The helper test checks rendering geometry and encoding preservation separately.

## Coverage and results

Each scale runs 16 scenes × 3 rows = 48 exact comparisons. Scenes include the
original and repeat, aligned crop, 50% middle row, both soft-edge crop origins,
contain and cover at both origins, soft-edge shadows at both origins, and both
15° and 360° rotations at both origins. The rotation fixture compensates about
the original source center; a fixture test checks its source-to-canvas mapping.

| Runtime configuration | Row comparisons | Differing pixels | Max channel difference |
| --------------------- | --------------: | ---------------: | ---------------------: |
| Native DPR 2          |              48 |                0 |                      0 |
| Forced Chromium DPR 1 |              48 |                0 |                      0 |
| Forced Chromium DPR 3 |              48 |                0 |                      0 |

Every export retains canonical bounds, YAML and assets, and repeat PNGs are
byte-identical. Alpha-1 visibility and a shadow pixel outside the source subject
are asserted independently of the pair comparison, so omitting both edges or both
shadows cannot masquerade as invariance. Scale overrides are verified inside the
actual export window. A first attempt to change the switch after app launch did
not change DPR and failed setup; it supplies no scale coverage.

The native pointer test selects the visible image, drags it, and closes the canvas
through desktop IPC. The saved position matches its observed screen movement;
dimensions remain 128×128 and source assets are unchanged. Bento snapping is
active: requested and observed movement are recorded separately. The helper also
checks nine live frames across fill/contain/cover, clipping after resizing, rounded
frame clipping, alpha 1, and original animated/16-bit/gamma-tagged/empty encodings.
Actual pointer resizing is not covered by the drag test.

## Repairs discovered during acceptance

- **Cover clip:** the aligned fractional case had 476 differing pixels, maximum
  delta 2. Its visible content was wholly inside the frame. Recomputing whether
  a clip can affect visible content removes this unnecessary clip while retaining
  edge/overflow/radius clips. Both crop origins now pass.
- **Rotation origin:** 15° rotation at 623/858 had 832 differing pixels, maximum
  delta 1. The default percentage origin depends on layout-rounded frame sizes.
  Supplying the center from numeric document dimensions removes this additional
  geometry quantization. Both crop origins now pass.
- **DPR-3 painting:** fractional unrotated exports retained 4 differing pixels,
  or 8 with soft edges, maximum delta 1. An isolated diagnostic measured 28 raw
  device pixels at delta 1 before resizing, versus 4 afterward for the opaque
  fixture. Thus resizing was not the first source of the residual. A separate
  transform layer for each normalized image eliminated the raw discrepancy in
  that diagnostic and all discrepancies in the native matrix. This establishes
  the tested compositing remedy, not an identification of a specific Chromium
  floating-point instruction. Compositing layers may consume additional GPU
  memory; large-document performance has not been measured here.

All changes stay in Molly's temporary build adaptations. Pinned vendor bytes,
source assets, canonical coordinates and document intent are unchanged. The
historical baseline and step-3 evidence remain separate from this acceptance run.

## Gates and remaining closeout

The renderer build/resource verification, focused native helper test, E2E checks,
three desktop smoke scenarios (18 steps), scoped lint/format, documentation checks
and public-boundary check are recorded separately from visual acceptance. Full
repository `pnpm check` and `pnpm format` also passed during closeout on
2026-09-27 (UTC), before the commit and draft PR.

The maintainer reviewed and accepted the synthetic native exports on 2026-09-27
(UTC). This human acceptance covers the reviewed Step-4 visuals and does not
expand the tested platform, encoding or interaction scope. DPR 1/3 were forced Chromium settings on
the DPR-2 machine, not other physical displays. Profiled/high-bit-depth/animated
inputs retain their source encoding, but crop invariance for them is not proven.
Arbitrary rotations beyond 15°/360°, image borders/internal crop pipelines,
rounded-frame visual comparisons, installed-package acceptance and large-document
performance are outside this matrix. Issue #15 remains open pending repository closeout.
