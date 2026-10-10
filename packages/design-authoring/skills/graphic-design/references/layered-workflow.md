# Layered design techniques

Techniques for design options, reproducing the chosen design as layers, and
visual comparison.
[The main Skill workflow](../SKILL.md#required-workflow) owns stage order, task
branches, research, review and reporting.

## Design options

Each option is a finished design the user may choose, so prompt for the whole
poster: subject, concept, composition, palette, light, texture, the qualities
taken from the references, and the exact headline and key copy in quotation
marks with where and how large they sit. Choose a `size` whose aspect ratio
matches the canvas (the imagegen skill has the size rules); matching the canvas
pixel dimensions makes later measuring and comparison easier.

Call `molly_image` `edit` with the images in this order:

1. **The source image**, when there is one: the delivery assets (a product photo,
   a logo) or the source poster for a redesign. Say what must stay recognizable
   and what is new.
2. **One or two inspiration images** saved during research, chosen for this
   option. Name each by its position and the quality it contributes ("image 2:
   the warm low light and amber palette; image 3: the condensed type
   treatment"), and say that its objects, people, text and logos must not
   appear. Without a source image they come first, and the prompt states the
   canvas size.
3. **A rendered blockout**, optionally, when words cannot pin down the layout.

The `imagegen` Skill lists each connection's input limit (DashScope accepts at
most three images); drop the blockout or an inspiration image first. If the
connection rejects several images, retry with fewer and say so. If the
configured model cannot edit, `generate` from the prompt and say so.

A blockout is a rough composition in native shapes and placeholder copy at the
canvas size, rendered with `molly_render_preview`. That tool renders only the
authoring directory's `design.yaml`, so copy any existing `design.yaml` to the
session workspace first and restore it before the turn ends; the options turn
leaves the project as it was. In the prompt, call the blockout a layout guide
only, not a style to copy. A flat blockout can make options look stiff; loosen
the layout wording rather than adding shapes.

Make the options genuinely different in concept or composition: subject scale
and position, where the headline sits, the kind of image, the type treatment.
Varying the inspiration images between options is one way to get there. Read
every option with an image-reading tool before showing it. Regenerate one that
fails the [design defaults](../SKILL.md#design-defaults), drops a delivery asset
or reads as an inspiration image with new copy; show the user only options you
would be willing to build.

Image models often misspell copy, especially Chinese, Japanese or Korean.
Wrong copy in an option is acceptable when the layout and style are right,
because the editable version sets the exact copy; mention it when you show the
options.

## Reproducing the chosen design

The chosen design is the target; the editable project should look like it.

1. **Measure it.** Note the canvas position and size of every object and text
   block in the chosen image (the `pack` grid helps), and its colors, type
   weights and alignment.
2. **Background plate.** `edit` the chosen design with a prompt that removes the
   foreground objects and every piece of text and fills what they covered,
   changing nothing else, as an opaque image at the canvas size. Compare it with
   the design: light, color and texture should be unchanged.
3. **Objects.** For each object worth editing on its own, `edit` the chosen
   design to isolate that object exactly as it appears, complete including
   hidden parts, on a transparent background. When the user requires a supplied
   face, product or logo to stay exact and the design altered it, isolate it
   from the source image instead.
4. **Text.** Take the wording from the brief or source, line by line. Set
   copy that a font can reproduce as native text matched to the measurements;
   isolate lettering a font cannot reproduce as an image from the design (see
   [Lettering layers](#lettering-layers)).
5. **Assemble and compare.** Place each layer at its measured position, render,
   and compare the render with the chosen design as described under
   [Comparing native previews](#comparing-native-previews).

## Complete objects and independent layers

Plan layers by independent editing value: what a person would want to move,
resize, recolor or replace on its own. A typical poster has an opaque background,
one main subject, a few secondary objects and effects. Keep together what always
moves together (an object and its contact shadow) and split what a user would
adjust separately. Grouping shadows, steam, glow and similar effects is a
judgment call; note the choice.

Isolate each raster object completely from the chosen design; a crop keeps
holes where other objects overlapped it. For a foreground object that needs
transparent isolation, call `molly_image` `edit` with the design as the first
image and:

- a prompt that names only this element, asks it to match the design's appearance,
  and asks for the complete element, including parts hidden behind other objects,
  isolated on a transparent background;
- `background: "transparent"` and `output_format: "png"`.

For the background plate, edit the design into the empty scene with every
foreground element and all text removed, as an opaque image at the canvas ratio. Add supplied
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

Make each piece of lettering that a font cannot reproduce its own transparent
layer, so it can be moved, resized and replaced without touching the scene. A
product name in drawn letters on a colored badge is lettering even at label
size; a plain font on a flat shape would lose the design.

One layer carries one piece of copy that reads as a unit — a headline, a name,
a label. Never merge separate lines or unrelated pieces (a title plus its date
line, a name plus its Latin transcription) into one image; each piece gets its
own layer so it can be reworded, moved or replaced alone.

Every lettering layer carries `textCopy` with the exact wording the picture
shows:

```yaml
- id: title-lettering
  kind: image
  bounds: [120, 480, 400, 96]
  src: media/title-lettering.png
  fit: contain
  textCopy: '诺贝尔文学奖'
```

`textCopy` is what the editor shows when the person asks to reword the layer
and what a later turn regenerates from; write the exact copy, never a
paraphrase. A wrong or missing `textCopy` is a defect of the layer. A layer
whose picture holds no wording (a photo, a texture) has no `textCopy`.

- Call `molly_image` `edit` with the chosen design as the first image, asking
  for only this lettering exactly as it appears there, together with its badge
  or backing shape when that belongs to it, with `background: "transparent"`
  and `output_format: "png"`. Use `generate` only for new lettering with no
  design to match.
- Put the exact copy in the prompt in quotation marks and ask for it verbatim,
  with no extra characters. Describe the style (material, stroke, dimension,
  color, lighting) and say that nothing else should appear. Spell unusual words
  letter by letter; for Chinese, Japanese or Korean, list the exact characters.
- Request enough pixels for the size it will be displayed at; lettering scaled
  up past its pixel size turns soft.
- Read the result and compare it with the source copy character by character,
  not with what the design drew. Image models often drop, add, swap or invent
  characters, especially in CJK. A wrong character is a failed layer:
  regenerate within the user's budget, or set that copy as native text and
  report the change.
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
than in the design, sometimes by a large factor. Place each layer from the design,
not from the coordinates in your prompt. Measure the element in the design (the
`pack` grid helps), then set `bounds` so the visible object lands there, keeping
the asset's aspect ratio (`fit: contain`, or bounds with the asset's ratio).

## Comparing native previews

Compare the current native preview with the chosen design: position, scale,
overlap, color, hierarchy and type fit. For a closer look at two same-size images
(the chosen design and a render, or two versions of a layer):

```sh
node scripts/reference-pack.mjs compare <a.png> <b.png> <work>/compare
```

This writes a side-by-side sheet over a checkerboard, a 50% overlay, and each image
over white and black, which shows halos, fringes and faint pixels. For a local
detail, `crop` the same box from both images first and compare the crops.

Fix what you find by adjusting `bounds` or order in YAML, or by editing or
regenerating the layer. Unused options and layers can stay in `media/`; only assets
referenced from `design.yaml` enter the artwork.
