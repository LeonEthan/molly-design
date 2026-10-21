# Design options

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
Varying the inspiration images between options is one way to get there. View
the options together with `molly_view_image` `paths` before showing them.
Regenerate one that
fails the design defaults in [the design-research Skill](../SKILL.md), drops a delivery asset
or reads as an inspiration image with new copy; show the user only options you
would be willing to build.

Image models often misspell copy, especially Chinese, Japanese or Korean.
Wrong copy in an option is acceptable when the layout and style are right,
because the editable version sets the exact copy; mention it when you show the
options.
