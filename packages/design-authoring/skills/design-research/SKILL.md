---
name: design-research
description: 'Use when a Molly design task sets a new visual direction: researching design sites for inspiration, offering image-model design options for the user to choose or drawing a layout first, composition judgment, or responding when the user rejects a direction. Not needed for prescribed templates, reconstructions, or bounded edits that keep the current design.'
metadata:
  short-description: Research, design options and direction handling for new designs
---

# Design Research and Directions

Setting a direction for a new design or redesign: intent, bounded research,
complete design options the user chooses between, and rejection handling. The
`graphic-design` skill owns branches and reporting; this skill owns everything
that happens before a chosen design exists. All of it is recommended method,
never enforced by the application.

## Understand intent

Establish purpose, audience, where the work will be seen and what it competes
with there (a feed, a wall of posters, a product page), the category it belongs
to, the one message it must send, output size, supplied assets and constraints.
Separate verified facts from assumptions. Distinguish **delivery assets** (a
supplied logo or product photo that must appear as supplied) from **design
references** that only guide appearance.

**Canvas size** comes from the brief. Take the first of these that answers it:
a size, ratio or format the user states ("A4", "phone story"); the artwork the
request refers to, so "keep the size" in a redesign means the size of the work
being redesigned, attached or open, and a bounded edit keeps the current
canvas; where the work will be seen (a 4:5 feed post, a 9:16 story, the paper
ratio of a print, a banner slot). An empty canvas with no elements is a
placeholder and its size means nothing. If none of these settles a size that
would change the composition, ask with the question below. State the size you
chose when you show the design options.

**Asking.** For a new design or redesign whose brief leaves a gap that would
change the direction (audience, where it is seen, the message, must-have copy,
an unsettled canvas size), ask with the `ask_user_question` tool when it is
available: one call, one to four questions, each with concrete options and your
recommended default first. One question may offer candidate direction words to
pick or correct. Do not ask when the brief already answers these, for a bounded
edit, or about details you can decide yourself. If the tool is unavailable or
no answer can come, proceed on stated assumptions and report them.

Then write a **direction sentence** (how the piece should feel and what it
should say) and two to four **direction words**, for example "smoky, intimate,
after hours". They are a working note, not a deliverable; research, options and
review measure against them.

Read [references/general-poster.md](references/general-poster.md) before
composing a new design.

## Inspect references and research

**Research rule.** Research exists to set a direction. Before choosing or
creating a composition, inspect relevant design-site visuals such as Pinterest
and other sources. Skip this only when no new direction is being set: the user
told you to follow a concrete template or reference without new inspiration and
you have inspected it, or the request is a bounded edit that keeps the existing
direction. Research anyway when the user asks for it. The same rule applies to
new designs, reconstructions and edits.

| Request                                                     | Research?                |
| ----------------------------------------------------------- | ------------------------ |
| "Reproduce this template, replace only the copy"            | No, after you inspect it |
| "Change the date and make the headline a little smaller"    | No                       |
| "Use this mood but redesign the composition"                | Yes                      |
| "Make the open artwork feel more premium" (a new direction) | Yes                      |
| A topic, style word, logo, product photo or your own idea   | Yes                      |
| An attachment you have not opened                           | Yes                      |

**Research gate.** When research applies, do not create design options until all of these hold:

- you read [references/browser-research.md](references/browser-research.md) in full;
- you researched on one design site that meets the user's source constraints. Use their requested site; otherwise prefer Pinterest when it is allowed and you observe it signed in (references visible without a login overlay), or another accessible allowed design source. Imported cookies alone are not access ([Sign-in](references/browser-research.md#sign-in));
- you did it in **two steps within the research budget** — one site, at most **three searches**:
  1. **Survey.** Look at each search across **two to four screens** with the one-script survey in [browser-research.md](references/browser-research.md#survey-a-search-in-one-script), taking one snapshot for image refs on the screen you pick from. Stop scrolling early only when two clear candidates are already on screen. Judge the thumbnails against the direction words and pick candidates from the grid; do not open detail pages to decide what to drop.
     **Extend.** When the first search shows a promising thread (a strong thumbnail, a recurring designer, style or term), spend the next search following it — the site's related or "more like this" results, that designer, or the term you saw — instead of rephrasing the original query. On a site without a working search, one search is one tag, mood, category or designer page; extend by opening the tag, mood or designer page that a strong thumbnail belongs to. Extending counts as one of the three searches.
  2. **Pick.** Save at most **three** picked images with `save_image` in one `codemode` script, then look at them together with `molly_view_image` `paths` (one contact sheet). Use `path` with `region`, or open one detail page, only for a pick whose thumbnail left a real doubt.
     Do not write scripts that fetch pages in loops, call `curl`/`fetch` on a site, read sitemaps, category listings or API endpoints, or repeat a search that already answered the direction;
- you kept two or three of the saved images as references, each with one named quality (palette, type, crop and light, layout structure) and none taken as literal objects or finished layout. If `save_image` cannot save a pick (including a rejected format), use an equivalent available visual tool to persist the same image to a local path the options can use. When the budget yields fewer than two relevant ones, keep the ones you saved and looked at (at least one) and name the shortfall in the options report; never pad with images you did not look at.

Stop researching as soon as two kept references answer the direction words, even if budget remains; more browsing does not improve the options. If `molly_view_image` is absent, read each saved image with the image-reading tool you have instead.

When the user forbids networking, keep prompts and assets local: report the gap
and stop before any network call, including `molly_image` generation or editing.
When research applies and either the user forbids web research or the browser
or network is unavailable, report the gap and stop: offer no design options and
invent no research from search titles. Fact checks such as event dates are
separate from inspiration research. The user's own direction stays the basis.

## Offer designs and let the user choose

Check each kept reference's quality against the direction words, then create
three complete **design options** (one on the you-choose path below) with the image model, each a finished
poster at the canvas ratio: composition, imagery, light, the headline and key
copy drawn in, and the finish you intend. They are the design, not sketches, so
judge each against the [design defaults](#design-defaults) before showing it,
and regenerate one that fails. Make the options differ in concept or
composition, not just color; when there is room, make one deliberately unlike
the most common look among the references.

Create the options from images and text, not text alone, with `molly_image`
`edit`. Pass the source image first when there is one: the supplied delivery
assets (a product photo, a logo) or the source artwork being redesigned, so the
options keep them. Add one or two inspiration images, chosen by you for that
option: those saved during research and style references the user supplied and
you inspected. Say in the prompt what each contributes ("image 2: its light and
palette") and that its objects, text and logos are not to be copied. Different
options may use different inspiration images. Stay within the connection's
input limit in the `imagegen` Skill. An option that is recognizably one
reference with new copy fails. A rendered blockout can steer an option's layout
when words are not enough. Prompting and option techniques are in [references/design-options.md](references/design-options.md).

Show the options and **end the turn** so the user can choose, as the
`graphic-design` Reporting section describes. Never ask for the choice with
`ask_user_question`; the reply shows the options at full size and also asks
for the delivery form, as the `graphic-design` skill's Delivery form describes.
Do not write or change `design.yaml` in that turn. Continue in the turn where
the user names an option; reproduce it with the `design-replication` skill, or
place it whole when the user chose one whole image. **You-choose path.** When the user tells you to decide or not to stop for a choice ("just pick one", "you choose", "do not ask me to choose", "你来定"), create exactly **one** design option — your recommendation — judge it against the design defaults, regenerate it at most once if it fails, and continue in the same turn by delivering it in the delivery form the `graphic-design` skill sets for this path. Create no alternative options on this path.

**Layout-first path.** When the brief asks for the layout first ("先排版",
"先出布局", "layout first, then generate"), create no design options. Always
ask about style direction with `ask_user_question` (offer candidate direction
words; include any other direction gap in the same call), research as above,
then draw the layout and end the turn as
[references/layout-first.md](references/layout-first.md) describes. In the turn
where the user confirms the layout, generate exactly one design from it and
continue to the editable version in that turn.

For a template, reconstruction or bounded edit, the prescribed artwork is the
chosen design; do not offer options.

## Design defaults

Starting points, not laws: working habits of practising designers plus fixes
for failures seen in real runs. Follow them unless the brief, a prescribed
reference or a stated design reason calls for something else; say so briefly
when you depart from one in a new design. Judge design options against them,
and check the reproduction against them in the render-and-read pass.

- **Focal subject.** One element is clearly largest, and the copy still has its
  own area. If subject and headline compete for the same space, shrink or move
  the subject rather than squeezing the copy.
- **Copy never covers what matters.** Keep text off faces, hands, products and
  logos, and off the subject's key detail. Move or resize the copy or subject
  instead of overlapping them.
- **Margins set the mood.** Keep text and key content clear of the canvas edges
  so nothing feels cut off; beyond that, choose deliberately: tight margins add
  tension and energy, wide margins add calm. Full-bleed imagery may run to the
  edge.
- **Few sizes, strong contrast.** Prefer one or two text sizes with a clear jump
  between them (the large one around twice the small); separate further levels
  with weight before adding a third size. Do not make everything big and bold to
  "shout": contrast and space carry hierarchy. Detail text stays readable at the
  real viewing size and distance.
- **White space is structure.** Use empty space to group, separate and rank
  information, not as whatever is left over. A crowded canvas with no room to
  breathe is a defect even when every element is legible.
- **Text over images.** Place copy on a calm area of the image, or add a scrim (a
  gradient or translucent shape behind the text) or a solid block. Check contrast
  in the render, not by assumption.
- **Alignment.** Choose one alignment axis for a text group and keep its edges on
  it. Group related copy with `groupId` so it moves together.
- **Reading order.** The render should read in the intended order at thumbnail
  size, in the place it will be seen: subject, headline, then details.
- **Every motif has a reason.** A signature device (a reflection, a floating
  product, a shelf arrangement, a gradient backdrop) must connect to the subject
  or message, not appear because it is popular.

Do not apply the golden ratio or rule of thirds as composition rules; place
things by hierarchy, content and space.

## When the user rejects a direction

When the user rejects every option or the finished design, check the rejection
against the direction words before offering new options:

- **The words still hold:** your visual reading of them missed. Keep the words,
  offer new options that interpret them differently, and say what changed.
- **The words no longer hold:** the brief has moved. Return to intent and ask
  what dissatisfies the user, as one question, before writing new words.

Either way the new options must visibly differ from the rejected ones.
