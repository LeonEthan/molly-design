# Reconstructing a design from a reference image

Read this when the user supplies an image and asks for a reconstruction. The goal
is a high-fidelity editable rebuild, not a promise of pixel identity, and never
the source image pasted back as a background. The `graphic-design` Skill owns
the reconstruction branch and the `design-research` Skill the research rule; the
reference serves as the selected composition. Use
[layered-workflow.md](layered-workflow.md) for complete raster layers and the
`graphic-design` skill's `references/artwork-format.md` ("What is editable
today") for which element kinds to use.

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

## Fit type

Fit each distinct text style once, with three calls rather than a loop:

1. **Measure.** `node scripts/reference-pack.mjs measure <reference.png> <x,y,w,h>`
   on one line of that style gives its ink box, baseline, x-height,
   cap/ascender height and stroke.
2. **Shortlist.** From the `design-text` skill's directory,
   `node scripts/font-catalog.mjs match --text "<the line as shown>" --width <ink width> --cap <cap height> [--x <x-height>] [--weight <guess>]`
   ranks installed faces and gives each a font size and letter spacing.
3. **Look once.** Pass the top three to five to `molly_view_image` with `fonts`,
   the same `text`, and the reference `path` with `region` set to that line.
   Pick the closest row by eye: letter shapes first, then width and weight.

Register the picked face, set the size and spacing from the shortlist, and
render the artwork once. Correct size or spacing at most twice, by the ratio the
render shows. If no row is close, keep the best one, name the difference in the
report, and consider image lettering only when the `design-text` skill says the
copy cannot be native. If `molly_view_image` lacks `fonts`, use the first
shortlisted face and render once.

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
the `design-text` Skill describes. Never use a large crop or layer that bundles
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
design defaults in the `design-research` Skill. Do not invent off-style decoration
to fill uncertain regions. In review, look for stretching, blur, clipping, crop
drift, unreadable text and missing objects, and keep a short record of material
deviations for the report.
