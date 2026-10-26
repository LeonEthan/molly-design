# Layout-first path

The user shapes the composition before any image is made: you draw regions on
the canvas, the user adjusts them, then one design is generated from the
confirmed layout and reproduced in editable layers. The layout is ordinary
elements in `design.yaml`; there is no separate layout format.

## Turn 1: draw the layout

After the style question and research, write `design.yaml` at the final
canvas size:

- **Image regions.** One `shape` (`rect`) per thing the image will show — a
  subject, an object, a scene area — with a translucent fill (`#RRGGBB26`) and
  a 2 px border of the same color, plus a `text` label inside its top-left
  corner naming the content in the user's language ("蓝色机器人"). Give the
  pair one `groupId` and ids starting with `layout-` (`layout-robot`,
  `layout-robot-label`). Use a few distinct colors so neighbouring regions
  read apart. Describe the backdrop with one label, `layout-background-label`.
- **Copy.** Headline, subtitle and other copy are final `text` elements with
  the brief's exact wording at the intended size, weight and color, with
  ordinary ids (`headline`). They stay in the delivered artwork.
- **Delivery assets.** Place a supplied logo or product photo as its final
  `image` element with an ordinary id.
- Keep `background` plain and light; draw no imagery, texture or decoration.

Render it, check that labels are legible and regions follow the design
defaults, report the layout draft as the `graphic-design` Reporting section
describes, and end the turn. Make no `molly_image` call in this turn. Copy the
kept inspiration images into the session workspace for the next turn. When
the user replies with layout changes rather than a go-ahead, make them and end
the turn again.

## Turn 2: generate from the confirmed layout

Read the current `design.yaml` first: the user may have moved, resized,
added, deleted or relabelled regions and edited copy. A duplicated box keeps
a `layout-` id; read its label.

1. Render the artwork as it stands and keep a copy of the render in the
   session workspace as the layout guide.
2. List each region's label and bounds as canvas percentages (left, top,
   width, height), and each copy element's wording and bounds the same way.
3. Call `molly_image` `edit` once at the canvas ratio: the layout guide first,
   then delivery assets, then one or two inspiration images within the
   connection's input limit (drop inspiration first). Ask for a finished
   poster in the direction words where each labelled content fills its box at
   that position and size, the copy is drawn in its boxes, the backdrop
   follows its label, and no boxes, outlines or labels appear. Name what each
   inspiration image contributes, as for design options.
4. View the result beside the layout guide in one `molly_view_image` `paths`
   call. Regenerate once when a region's content is missing or clearly outside
   its box; otherwise continue and report the departure.
5. Reproduce it with the `design-replication` skill, taking appearance from
   the generated design and position and size from the layout: the plate is
   the generated design without objects and text; each extracted object is
   scaled to fit its region's box, keeping its proportions; copy elements keep
   their layout bounds and wording and may take color, weight or font from the
   generated design. Delete every `layout-` element before the final render.
6. For a whole-image delivery, place the generated design as one covering
   `image` and delete the `layout-` elements and the copy elements it draws.

Keep the layout guide and region list in the session workspace: "generate
again" reuses them with one new `edit` call. The confirmed layout also stays
in the artwork's design history.
