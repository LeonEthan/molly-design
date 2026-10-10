# Reconstructing a design from a reference image

Read this when the user supplies an image and asks for a reconstruction. The goal
is a high-fidelity editable rebuild, not a promise of pixel identity, and never
the source image pasted back as a background. The reconstruction branch and
research rule are in [the main Skill](../SKILL.md#required-workflow); the
reference serves as the selected composition. Use
[layered-workflow.md](layered-workflow.md) for complete raster layers and
[artwork-format.md](artwork-format.md#what-is-editable-today) for which element
kinds to use.

## Establish reference geometry

Read the reference's pixel dimensions first. Set canvas `size` to those pixels
unless the user asks for a different output. If a dimension exceeds 4096, scale
proportionally and report the change; never upscale past the limit or substitute
a habitual preset.

## Reference analysis helpers

Use whatever image-reading and analysis tools suit the reference. The optional
reference pack supplies dimensions, a coordinate grid, enlarged bands and palette
swatches. From this skill's directory:

```sh
node scripts/reference-pack.mjs pack <reference-image> <work>/inspect
node scripts/reference-pack.mjs crop <reference-image> <x,y,w,h> <project>/media/<name>.png
```

The pack writes `meta.json`, `grid.png`, `bands.png` and `palette.png`; crops check
image bounds and re-encode the region as PNG. The script handles non-interlaced
8-bit gray/RGB/RGBA/palette PNG; for JPEG/GIF/BMP/WEBP it reports dimensions only,
so make a PNG analysis copy or use your other image tools. Keep the original asset.

Unclear wording, unavailable fonts, hidden geometry and ambiguous layers are
fidelity limits: preserve what you know and report consequential assumptions.

## Reconstruct as editable objects

- Rebuild legible text as `kind: text`.
- Redraw flat blocks, rules and simple geometry as `shape` or `line`.
- Rebuild real tables as `table`, real data graphics as `chart` and simple
  symbols as `icon` when the offline set has a match.
- Rebuild photographs, product shots, textures and scenes as separate image
  layers. With image tools, extract each object from the reference via `edit`,
  exactly as it appears, completing only genuinely hidden parts; a crop keeps
  holes where other objects overlapped it. Without them,
  use tight crops and report the holes and merged objects this leaves.
- Use a separately supplied delivery asset (logo, product photo) as supplied.
- Keep raster aspect ratios faithful.

Rebuild ordinary text as native text. Artistic lettering in the reference
(calligraphy, 3D or illustrated type) may become an image lettering layer, as
the main Skill's stage 6 describes. Never use a large crop or layer that bundles
ordinary text or flat graphics together to fake editability. If something cannot be rebuilt with the kinds available, report
it.

## Fidelity targets

Match the observable reference as closely as the evidence permits:

- canvas ratio, margins, element bounds, alignment and z-order;
- sampled colors, palette roles and background treatment;
- type scale, weight, alignment, case, line breaks and density;
- image selection, crop, subject scale and placement relative to text;
- borders, shadows, radii and paths.

A faithful reconstruction follows the reference, even where it departs from the
[design defaults](../SKILL.md#design-defaults). Do not invent off-style decoration
to fill uncertain regions. In review, look for stretching, blur, clipping, crop
drift, unreadable text and missing objects, and keep a short record of material
deviations for the report.
