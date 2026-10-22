---
name: design-replication
description: 'Use when reproducing a chosen design option or a supplied reference image as faithful editable layers in a Molly YAML artwork: extracting background plates and foreground objects with the image model, measuring geometry, comparing renders, or reconstructing a reference.'
metadata:
  short-description: Reproduce designs as faithful editable layers
---

# Design Replication

Reproducing a chosen design — an option the user picked or a prescribed
reference — as faithful, independently editable layers. The `graphic-design`
skill owns branches and reporting; this skill owns fidelity: extract, never
re-create. Copy treatment (native text vs image lettering) belongs to
`design-text`.

## Reproduce, do not reinterpret

The chosen design is the target; the editable project should look like it.
Every raster layer comes from the chosen design's own pixels through
`molly_image` `edit`, with the design as the first image. Never `generate` a
layer for an element the design already shows. A layer the model re-imagined is
a failed layer: re-extract it or report the departure. When no image-editing
tool is available, use tight crops from the design and report the holes and
merged objects this leaves.

Plan layers by what a person would edit independently: usually a background
plate, the main subject, a few secondary objects and the copy. Make the plate
by editing the chosen design to remove the foreground objects and all text,
keeping every other pixel as it is. Extract each foreground object exactly as
it appears, completing only genuinely hidden parts, with real alpha, at no
fewer pixels than it occupies on the canvas. When the user requires a supplied
face, product or logo to stay exact and the design altered it, extract it from
the source instead and place it where the design has it. Use native shapes for
flat geometry, keep unaffected existing layers, inspect each layer and report
missing parts.

The full recipe — measuring, plate and object extraction prompts, layer checks,
positioning and stacking, and render comparison — is
[references/layered-workflow.md](references/layered-workflow.md). For a reconstruction from a supplied reference image, read
[references/replication.md](references/replication.md).

Field shapes for `design.yaml` copy from
[examples/minimal/design.yaml](examples/minimal/design.yaml) and the layered
[examples/layered/design.yaml](examples/layered/design.yaml); the admitted
fields are listed in the `graphic-design` skill's `references/artwork-format.md`.

## Reference pack

Optional PNG helpers run from this skill's directory:

```sh
node scripts/reference-pack.mjs pack <image> <out-dir>      # meta, grid, bands, palette
node scripts/reference-pack.mjs crop <image> <x,y,w,h> <out.png>
node scripts/reference-pack.mjs alpha <layer.png>           # real transparency check
node scripts/reference-pack.mjs trim <layer.png> <out.png>  # drop transparent padding
node scripts/reference-pack.mjs compare <a.png> <b.png> <out-dir>
node scripts/reference-pack.mjs measure <image> <x,y,w,h>    # text line metrics
```

Supported non-interlaced 8-bit gray/RGB/RGBA/palette PNG is decoded via
`node:zlib`; JPEG/GIF/BMP/WEBP report dimensions but raster artifacts require
PNG. These are optional inspection aids, never gates.

Batch independent measurements: compute several crops, bounds or color samples in one script and print a compact summary, instead of one command per measurement. Look at a detail with `molly_view_image` `region` rather than writing and reading a crop file.

Do not brute-force a fit: never sweep fonts, sizes, tracking or positions in a search loop to match pixels. Fit type with the "Fit type" recipe in [references/replication.md](references/replication.md): measure, shortlist, view the candidates once, render once.
