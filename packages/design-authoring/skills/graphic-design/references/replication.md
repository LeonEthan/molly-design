# Reconstructing a design from a reference image

Read this reference only when the user supplies an image and asks for a
reconstruction. The goal is a high-fidelity editable reconstruction within the
platform's Active Profile, not an unconditional promise of pixel identity, and
never the source image pasted back as a background.

Also use [general-poster.md](general-poster.md) for composition judgment and
[graphic-canvas-profile.md](graphic-canvas-profile.md) before choosing native
element semantics. When image tools are available, follow
[layered-workflow.md](layered-workflow.md) with the supplied image as the chosen
draft: skip draft generation and regenerate its raster objects as complete
layers.

## Establish reference geometry

Read the reference's pixel dimensions first. Set canvas `size` to those pixels and
keep the same aspect ratio unless the user requests a different output. Every
element's closed rectangle stays inside that canvas: a block flush with the bottom
edge uses `y = canvasH - h`. Molly admits dimensions from 1 through 4096
inclusive. If the exact dimensions exceed that limit, rescale proportionally and
report the change; never upscale a reference past the limit or substitute a habitual
preset.

## Reference analysis helpers

Choose available image-reading and analysis methods to suit the reference. The
optional reference pack can supply dimensions, a coordinate grid, enlarged bands,
and palette swatches. From this skill's directory:

```sh
node scripts/reference-pack.mjs pack <reference-image> <work>/inspect
node scripts/reference-pack.mjs crop <reference-image> <x,y,w,h> <project>/media/<name>.png
```

The pack writes `meta.json`, `grid.png`, `bands.png`, and `palette.png` for
supported PNG input. Crops check image bounds and re-encode the selected region as
PNG. These are aids; neither their use nor a particular number of inspections is
required. Further measurement, sampling, or cropping may be useful at any point.

This dependency-free script supports non-interlaced 8-bit gray/RGB/RGBA/palette
PNG raster operations. JPEG/GIF/BMP/WEBP report dimensions only; other PNG
encodings or formats may require a supported analysis copy for
grid/bands/palette/crop. This script's limits do not limit the Agent's other image
tools. Keep original assets and use other available tools directly when useful;
report consequential uncertainty.

Unclear wording, unavailable fonts, hidden geometry, and ambiguous layers are
fidelity limits: preserve known content and report consequential assumptions.

## Reconstruct as editable objects

Map each visible object to a semantic element only when the Active Profile
declares the needed render behavior and edit level:

- rebuild legible text as `kind: text`; use separate elements only where the
  active text model requires it;
- redraw flat blocks, rules, and simple geometry with supported editable
  primitives (`kind: shape` or `kind: line`);
- rebuild photographs, product shots, textures, scenes, and other genuinely
  raster objects as separate image layers under `media/`. With image tools,
  regenerate each object completely from the reference (see
  [layered-workflow.md](layered-workflow.md)), because a crop keeps holes where
  other objects overlapped it. Without them, extract tight crops and report the
  holes and merged objects this leaves;
- use a supplied delivery asset (a logo or product photo provided separately)
  as supplied rather than regenerating it;
- keep raster aspect ratios faithful and use supported `fit` or `crop` behavior;
- do not claim native icons, tables, charts, masks, or other compound semantics
  merely because some external catalogue documents them.

A layer may contain photographic content. Do not use a large crop or layer
containing rebuildable text or flat graphics to simulate editability. If the required
semantic element is not Active, choose an explicitly supported editable
decomposition or report the limitation.

## Fidelity targets

Match the observable reference as closely as the evidence and Active Profile
permit:

- canvas ratio, margins, element bounds, alignment, and z-order;
- sampled colors, repeated palette roles, and background treatment;
- type scale, weight, alignment, case, line breaks, and density;
- image selection, crop, subject scale, and placement relative to text;
- borders, shadows, radii, paths, and other effects only where supported end to
  end.

Do not invent off-style decoration to fill uncertain regions. Keep a concise
record of material deviations that affect fidelity or editability.

## Visual fidelity

The optional `scripts/finalize.mjs` helper checks syntax; it does not establish
visual fidelity. When rendering with `molly_render_preview`, open the resulting
PNG with an actual image-reading tool. Useful questions include:

- Is there unintended stretching, blur, clipping, or crop drift?
- Is text readable, with key subjects, logos, and facts visible?
- Are alignment, spacing, layering, and color consistent with the reference?
- Are missing objects and material fidelity differences understood?

Choose review depth and iterations according to the task. View updated renders
when needed to judge edits; no fixed review count or analysis sequence applies.
If `molly_render_preview` is absent, only that tool is unavailable; assess other
image-reading and rendering capabilities actually available to your Agent.
Report actual inspection and remaining source-evidence or capability limits
honestly.
