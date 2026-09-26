# Layered design techniques

Use these methods for composition drafts, complete raster layers and visual
comparison. Follow [the main Skill workflow](../SKILL.md#required-workflow) for
stage order, task branches, research and completion. This reference supplies
techniques for those stages.

## Composition prompts and draft comparison

Write a prompt for the whole canvas: subject, composition, style, palette,
lighting and where the copy will sit. Use `molly_generate_image` for
composition drafts; vary composition or concept, not just surface detail. Choose
a `size` whose aspect ratio matches the canvas (see the imagegen skill for size
rules); matching pixel dimensions makes later comparison easier.

Read every draft with an image-reading tool. Choose one draft and say why:
message, hierarchy, room for type, and how well it will split into layers. Tell
the user which draft you chose; they can ask for another. A draft is a
reference for the next stages. It never becomes the artwork or its background.

Rendered text inside drafts is usually approximate. Plan the real copy as
editable text unless lettering is part of the imagery.

## Complete objects and independent layers

Plan the layers by independent editing value: what a person would want to move,
resize, recolor or replace on its own. A typical poster has an opaque
background, one main subject, a few secondary objects and effects. Keep things
together that always move together (an object and its contact shadow), and
split things a user would adjust separately. The grouping of shadows, steam,
glow and similar effects is a judgment call; note the choice.

For raster objects that need reconstruction, regenerate the complete object
from the chosen draft. A crop keeps holes where other objects overlapped.
Keep separately supplied delivery assets as supplied, use supported native
primitives for flat geometry, and preserve unaffected layers in local edits.
For a foreground object that needs transparent isolation, call `molly_edit_image`
with the draft as the first image and:

- a prompt that names only this element, asks for it to match the draft's
  appearance, and asks for the complete element including parts hidden behind
  other objects, isolated on a transparent background;
- `background: "transparent"` and `output_format: "png"`.

For a generated background, edit the draft into the empty scene with every
foreground element removed, as an opaque image at the canvas ratio. Add supplied
delivery assets or earlier layers as extra `images` when they help the model
keep style or scale consistent.

Read each result. Useful checks with the optional helper (paths relative to this
skill's directory):

```sh
node scripts/reference-pack.mjs alpha <layer.png>
node scripts/reference-pack.mjs trim <layer.png> <project>/media/<name>.png
```

`alpha` reports whether the layer has real transparency and where its visible
pixels are. An isolated foreground with no transparent pixels, or a painted
checkerboard, did not come back transparent; correct it within the user's budget
or report the limitation. An intentionally opaque background needs no transparent
pixels. `trim` removes fully transparent padding without changing any kept pixel
and reports the crop offset,
which keeps click targets close to the visible object. Faint alpha pixels can
keep the bounds large. `alpha --threshold N` shows where more solid pixels sit,
and `trim --alpha-above N --margin M` keeps only that region plus a margin; it
drops faint pixels outside it, so check soft effects afterwards.

Generated solids can have alpha 253–254 rather than 255, so they stay slightly
see-through when stacked. Judge this in a render.

## Positioning and stacking

Write one `image` element per layer, with array order as stacking order: the
background first, then back to front. To change stacking, reorder the array;
an explicit `zIndex` alone did not change render order in testing.

Generated layers drift: expect each one to come back at a different size or
position than in the draft, sometimes by a large factor. Place each layer from
the draft, not from the coordinates in your prompt. Measure the element in the
draft (the `pack` grid helps), then set `bounds` so the visible object lands
there, keeping the asset's aspect ratio (`fit: contain`, or bounds with the
asset's ratio). Record the scale you apply.

## Text and illustration lettering

For each piece of copy, choose native `text`, a raster layer or a vector shape.
Editable text is usually right for headlines, dates, prices and body copy; it
stays correct, sharp and editable. Lettering that is part of the illustration
(a sign inside a scene, stylised title art) can stay in the image. Check the
fonts you name are available (see [artwork-format.md](artwork-format.md)).

## Comparing native previews

Compare the current native preview with the chosen composition: position, scale,
overlap, color, hierarchy and type fit. For a closer look at two same-size images
(for example the draft and a render, or two versions of a layer):

```sh
node scripts/reference-pack.mjs compare <a.png> <b.png> <work>/compare
```

This writes a side-by-side sheet over a checkerboard, a 50% overlay, and each
image over white and black, which shows halos, fringes and faint pixels. For a
local detail, `crop` the same box from both images first and compare the crops.

Fix what you find: adjust `bounds` or order in YAML, or edit or regenerate the
layer with the image model. Return to native review after visual changes, as
required by the main workflow.

Unused drafts and layers can stay in `media/`; only assets referenced from
`design.yaml` enter the artwork. Image inputs, budget and uncertain paid outcomes
are described in the `imagegen` Skill.
