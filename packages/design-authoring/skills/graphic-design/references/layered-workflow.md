# Generative layered workflow

Use this guide when image tools are available and the design needs generated
imagery: a new design from a brief, or a reconstruction of a supplied image. It
turns a brief into an editable artwork whose image layers are complete,
transparent assets stacked in `design.yaml`, and whose type stays editable where
that serves the design.

The stages below are a recommended path, not a checklist. Adapt, reorder, repeat
or skip them to fit the task: a small edit to an existing artwork rarely needs
drafts, and a reconstruction can use the supplied image as its chosen draft.
Molly does not check which stages you ran.

## 1. Understand the intent

Establish what the canvas must do (see [general-poster.md](general-poster.md)):
purpose, audience, medium, canvas size, tone, and the exact copy. Keep supplied
wording verbatim. Read the user's design thinking, inspiration and references
first; identify the direction they establish and any decisions still open.

Sort supplied images into two groups:

- **Delivery assets** must appear as supplied: a logo, a product photo, a
  portrait, a chart. Place them as-is (after any requested edit); do not redraw
  them with the image model.
- **Design references** show a style, mood or layout to learn from. They inform
  prompts and drafts but do not appear in the artwork.

Ask only when a missing fact blocks the work; otherwise state your assumptions.

## 2. Resolve inspiration gaps

Build on the supplied direction. When inspiration is absent or insufficient to
support a design decision, actively research design sites such as Pinterest
(see [browser-research.md](browser-research.md)). Choose queries for the open
question: composition, palette, type treatment or image style. Use what you find
to fill that gap while keeping the user's direction. When the supplied material
already supports those decisions, proceed with it. Save an image only when it
will be an edit reference. Borrow ideas, not someone else's artwork, marks or
photographs.

## 3. Generate composition drafts

Write a prompt for the whole canvas: subject, composition, style, palette,
lighting and where the copy will sit. Generate several drafts with
`molly_generate_image` that differ in composition or concept, not just in
detail. Choose a `size` whose aspect ratio matches the canvas (see the imagegen
skill for size rules); matching pixel dimensions makes later comparison easier.

Read every draft with an image-reading tool. Choose one draft and say why:
message, hierarchy, room for type, and how well it will split into layers. Tell
the user which draft you chose; they can ask for another. A draft is a
reference for the next stages. It never becomes the artwork or its background.

Rendered text inside drafts is usually approximate. Plan the real copy as
editable text (stage 6) unless lettering is part of the imagery.

## 4. Decompose into complete layers

Plan the layers by independent editing value: what a person would want to move,
resize, recolor or replace on its own. A typical poster has an opaque
background, one main subject, a few secondary objects and effects. Keep things
together that always move together (an object and its contact shadow), and
split things a user would adjust separately. The grouping of shadows, steam,
glow and similar effects is a judgment call; note the choice.

Regenerate each element from the chosen draft instead of cropping it. A crop
keeps holes where other objects overlapped; a regenerated layer is complete.
For each foreground layer, call `molly_edit_image` with the draft as the first
image and:

- a prompt that names only this element, asks for it to match the draft's
  appearance, and asks for the complete element including parts hidden behind
  other objects, isolated on a transparent background;
- `background: "transparent"` and `output_format: "png"`.

For the background, edit the draft into the empty scene with every foreground
element removed, as an opaque image at the canvas ratio. Add supplied delivery
assets or earlier layers as extra `images` when they help the model keep style
or scale consistent.

Read each result. Useful checks with the optional helper (paths relative to this
skill's directory):

```sh
node scripts/reference-pack.mjs alpha <layer.png>
node scripts/reference-pack.mjs trim <layer.png> <project>/media/<name>.png
```

`alpha` reports whether the layer has real transparency and where its visible
pixels are. A layer with no transparent pixels, or with a painted checkerboard,
did not come back transparent; edit or regenerate it. `trim` removes fully
transparent padding without changing any kept pixel and reports the crop offset,
which keeps click targets close to the visible object. Faint alpha pixels can
keep the bounds large. `alpha --threshold N` shows where more solid pixels sit,
and `trim --alpha-above N --margin M` keeps only that region plus a margin; it
drops faint pixels outside it, so check soft effects afterwards.

Generated solids can have alpha 253–254 rather than 255, so they stay slightly
see-through when stacked. Judge this in a render.

## 5. Recompose in YAML

Read [artwork-format.md](artwork-format.md) for the YAML structure and
[../examples/minimal/design.yaml](../examples/minimal/design.yaml) for a complete
image-and-text project. From this skill directory, `node scripts/format.mjs kind
image` and `node scripts/format.mjs kind text` list admitted element fields;
the format guide's text example shows the nested paragraph and run structure.

Write one `image` element per layer, with array order as stacking order: the
background first, then back to front. To change stacking, reorder the array;
an explicit `zIndex` alone did not change render order in testing.

Generated layers drift: expect each one to come back at a different size or
position than in the draft, sometimes by a large factor. Place each layer from
the draft, not from the coordinates in your prompt. Measure the element in the
draft (the `pack` grid helps), then set `bounds` so the visible object lands
there, keeping the asset's aspect ratio (`fit: contain`, or bounds with the
asset's ratio). Record the scale you apply.

## 6. Decide how text is represented

For each piece of copy, choose native `text`, a raster layer or a vector shape.
Editable text is usually right for headlines, dates, prices and body copy; it
stays correct, sharp and editable. Lettering that is part of the illustration
(a sign inside a scene, stylised title art) can stay in the image. Check the
fonts you name are available (see [artwork-format.md](artwork-format.md)).

## 7. Review the whole composition

Render with `molly_render_preview` and read the PNG. Compare it with the chosen
draft: position, scale, overlap, color, hierarchy and type fit. For a closer
look at two same-size images (for example the draft and a render, or two
versions of a layer):

```sh
node scripts/reference-pack.mjs compare <a.png> <b.png> <work>/compare
```

This writes a side-by-side sheet over a checkerboard, a 50% overlay, and each
image over white and black, which shows halos, fringes and faint pixels. For a
local detail, `crop` the same box from both images first and compare the crops.

Fix what you find: adjust `bounds` or order in YAML, or edit or regenerate the
layer with the image model. Render again when you need to judge a change.

## 8. Check consistency

Compare the artwork with the brief and supplied materials: every required fact
and piece of copy present and spelled exactly, delivery assets used as supplied,
brand colors and requested style kept, and nothing invented (logos, claims,
marks). Correct deviations with the image model or by editing the artwork.

## 9. Polish and deliver

Make the final refinements, render and read the result once more, and make
sure `design.yaml` is saved in the design authoring directory. In your reply,
summarise the result: the chosen draft, the layers, text choices, remaining
deviations and anything you could not check. Human judgment decides whether the
design is good; your review is advisory.

## Tool errors and paid calls

Image tool failures come back to you as ordinary tool errors. Read the error and
decide what to do: change the prompt or parameters, use a different approach,
or tell the user. An error saying the outcome is unknown means the request may
have run and been billed; do not assume it did nothing. Each image call may cost
the user money, so make each one count, but there is no fixed limit.

Unused drafts and layers can stay in `media/`; only assets referenced from
`design.yaml` enter the artwork.
