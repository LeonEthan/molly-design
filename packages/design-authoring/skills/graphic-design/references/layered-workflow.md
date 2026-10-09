# Layered design techniques

Techniques for composition drafts, complete raster layers and visual comparison.
[The main Skill workflow](../SKILL.md#required-workflow) owns stage order, task
branches, research, review and reporting.

## Composition prompts and draft comparison

Write a prompt for the whole canvas: subject, composition, style, palette,
lighting and where the copy will sit. Use `molly_image` `generate` for
composition drafts and vary composition or concept, not just surface detail.
Choose a `size` whose aspect ratio matches the canvas (the imagegen skill has the
size rules); matching pixel dimensions makes later comparison easier.

Read every draft with an image-reading tool and choose one for its message,
hierarchy, room for type and how well it will split into layers. Leave room for
the copy the [design defaults](../SKILL.md#design-defaults) expect: a calm area
for the headline, clear of the subject's face or key detail. How to show drafts
to the user is in [Reporting](../SKILL.md#reporting).

Text rendered inside drafts is usually approximate. Decide per piece of copy
whether it becomes native text or an image lettering layer (main Skill stage 6),
and leave the draft's text out of background and object layers either way.

## Complete objects and independent layers

Plan layers by independent editing value: what a person would want to move,
resize, recolor or replace on its own. A typical poster has an opaque background,
one main subject, a few secondary objects and effects. Keep together what always
moves together (an object and its contact shadow) and split what a user would
adjust separately. Grouping shadows, steam, glow and similar effects is a
judgment call; note the choice.

Regenerate each raster object completely from the chosen draft; a crop keeps
holes where other objects overlapped it. For a foreground object that needs
transparent isolation, call `molly_image` `edit` with the draft as the first image
and:

- a prompt that names only this element, asks it to match the draft's appearance,
  and asks for the complete element, including parts hidden behind other objects,
  isolated on a transparent background;
- `background: "transparent"` and `output_format: "png"`.

For a generated background, edit the draft into the empty scene with every
foreground element removed, as an opaque image at the canvas ratio. Add supplied
delivery assets or earlier layers as extra `images` when they help the model keep
style or scale consistent.

Read each result. Useful optional checks (paths relative to this skill's
directory):

```sh
node scripts/reference-pack.mjs alpha <layer.png>
node scripts/reference-pack.mjs trim <layer.png> <project>/media/<name>.png
```

`alpha` reports whether the layer has real transparency and where its visible
pixels are. An isolated foreground with no transparent pixels, or a painted
checkerboard, did not come back transparent: correct it within budget or report
it. `trim` removes fully transparent padding without changing kept pixels and
reports the crop offset, keeping click targets close to the visible object. Faint
alpha pixels can keep the bounds large: `alpha --threshold N` shows where more
solid pixels sit, and `trim --alpha-above N --margin M` keeps only that region plus
a margin, dropping faint pixels outside it, so check soft effects afterwards.

Generated solids can have alpha 253–254 rather than 255 and stay slightly
see-through when stacked. Judge this in a render.

## Lettering layers

Generate each piece of artistic lettering as its own transparent layer, so it
can be moved, resized and replaced without touching the scene:

- Call `molly_image` `generate`, or `edit` with the chosen draft as the first
  image when the lettering must match it, with `background: "transparent"` and
  `output_format: "png"`.
- Put the exact copy in the prompt in quotation marks and ask for it verbatim,
  with no extra characters. Describe the style (material, stroke, dimension,
  color, lighting) and say that nothing else should appear. Spell unusual words
  letter by letter; for Chinese, Japanese or Korean, list the exact characters.
- Request enough pixels for the size it will be displayed at; lettering scaled
  up past its pixel size turns soft.
- Read the result and compare it with the copy character by character. Image
  models often drop, add, swap or invent characters, especially in CJK. A
  wrong character is a failed layer: regenerate within the user's budget, or
  set that copy as native text and report the change.
- Check alpha and trim as for any foreground layer, then place it like other
  layers. Give it an `id` that names the copy, such as `title-lettering`.

If lettering must sit on a surface in the scene (a shop sign, a label), it can
stay in that object's image instead; it is then part of the picture and its
wording cannot change separately.

## Positioning and stacking

Write one `image` element per layer, with array order as stacking order: the
background first, then back to front. To change stacking, reorder the array; an
explicit `zIndex` alone did not change render order in testing.
[examples/layered/design.yaml](../examples/layered/design.yaml) shows the
background, a transparent subject, a scrim and grouped copy in order.

Generated layers drift: expect each to come back at a different size or position
than in the draft, sometimes by a large factor. Place each layer from the draft,
not from the coordinates in your prompt. Measure the element in the draft (the
`pack` grid helps), then set `bounds` so the visible object lands there, keeping
the asset's aspect ratio (`fit: contain`, or bounds with the asset's ratio).

## Comparing native previews

Compare the current native preview with the chosen composition: position, scale,
overlap, color, hierarchy and type fit. For a closer look at two same-size images
(the draft and a render, or two versions of a layer):

```sh
node scripts/reference-pack.mjs compare <a.png> <b.png> <work>/compare
```

This writes a side-by-side sheet over a checkerboard, a 50% overlay, and each image
over white and black, which shows halos, fringes and faint pixels. For a local
detail, `crop` the same box from both images first and compare the crops.

Fix what you find by adjusting `bounds` or order in YAML, or by editing or
regenerating the layer. Unused drafts and layers can stay in `media/`; only assets
referenced from `design.yaml` enter the artwork.
