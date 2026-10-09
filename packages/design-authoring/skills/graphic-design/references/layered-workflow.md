# Layered design techniques

Techniques for composition drafts, complete raster layers and visual comparison.
[The main Skill workflow](../SKILL.md#required-workflow) owns stage order, task
branches, research, review and reporting.

## Blockouts, prompts and draft comparison

Text alone describes layout, proportion and texture poorly, so draw drafts from
an image plus text. For each composition you want to try:

1. **Block it out.** `molly_render_preview` renders only the authoring
   directory's `design.yaml`, so the blockout lives there for now. If an
   artwork is already there, copy `design.yaml` to the session workspace first.
   At the canvas size, write native rectangles or ellipses for the subject and
   secondary objects at their intended size, placeholder headline and detail
   text where the copy will sit, and fills in the palette taken from the
   references. Supplied delivery assets can go in as `image` elements. Render it
   and copy the PNG to the session workspace; this costs no image call and also
   shows early whether fonts load. Replace the blockout with the real
   composition (or the restored artwork) before the turn ends, because Molly
   collects whatever `design.yaml` holds then.
2. **Prompt.** Describe the whole canvas: subject, concept, style, palette,
   lighting, texture and the qualities you took from the references. Say that
   the input image is a layout guide only (where things sit and how large they
   are), not a style to copy, that shapes become the described objects, and that
   placeholder text areas stay calm for copy added later.
3. **Edit.** Call `molly_image` `edit` with the rendered blockout as the first
   image and supplied delivery assets after it, within the provider's input
   limits. Never pass found references such as other designers' work.

Vary the blockouts, not just the prompt wording, so drafts differ in
composition or concept. If the configured model cannot edit or rejects the
inputs, fall back to `generate` with the same prompt plus a written layout, and
report that the drafts came from text alone. Without `molly_render_preview`
there is no blockout render: use `edit` with the delivery assets alone if there
are any, otherwise `generate`. A flat blockout can make drafts
look stiff; if it does, loosen the prompt's layout wording rather than adding
more shapes.

Choose a `size` whose aspect ratio matches the canvas (the imagegen skill has the
size rules); matching pixel dimensions makes later comparison easier.

## Redesign with preserved subjects

When a user asks to redesign a poster but keep its spokesperson, products or
logo, the source gives you those subjects and the copy; the composition is new.

1. **Isolate the subjects first.** Call `edit` with the source poster as the
   first image and a prompt that isolates one subject exactly as it appears
   (same face, pose, clothing, product, label) on a transparent background.
   Compare each result with the source at full size; a changed face or label is a
   failed isolation. These isolations are the delivery assets for every later
   step.
2. **Block out new compositions with them.** Put the isolated subjects in each
   blockout as `image` elements at their new size and position, with shapes for
   the background, stage or props and placeholder copy. Make the blockouts
   genuinely different: subject scale, side, crop, where the headline sits.
3. **Draft from each blockout.** `edit` with the rendered blockout first and the
   isolated subjects after it, asking for a finished poster with this layout,
   the brand palette and the new light and atmosphere. The draft may redraw the
   face approximately; that is expected and does not reach the artwork.
4. **Choose one draft and rebuild it.** Generate the background, stage, light
   and decorative layers from the chosen draft as for any composition, with the
   subjects removed. Place the isolated subjects where the draft has them, and
   match the draft's light with a shadow, glow or scrim rather than by redrawing
   the subject. A display headline drawn in the draft may become image lettering
   (main Skill stage 6).
5. **Compare the render with the chosen draft**, not only with the source.

This takes the isolation calls plus one call per draft and per generated layer;
plan it against the user's budget before starting.

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
