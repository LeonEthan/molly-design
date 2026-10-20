# Setup drawer form keeps the card height

Status: implemented
Translation: pending
PR: https://github.com/LeonEthan/molly-design/pull/194

## Abstract

Product acceptance of the setup drawer failed because an empty connection list
still grew and pushed the first form into the lower half of the card, and
editing one saved connection among several left the form with no usable
height. An empty or short list sizes to its rows, and a longer idle list
scrolls inside the card; the first-run form itself does not grow, so its
action row follows its fields instead of floating to the card bottom. While a
panel editor is open, each neighbouring row list is capped and the editor
keeps a 12rem floor, then fills the remaining height with its action row
pinned. The settings section outside the drawer is unchanged.

## Decision

The idle and empty list uses `min-h-0 max-h-full shrink overflow-y-auto` and
does not flex-grow. An empty list therefore has no height, and the first form
starts at the top of the card; a long idle list stops at the card and
scrolls. The first-run form also opts out of growth (`grow={false}`), so
short content keeps Cancel/Connect directly below the last field while a tall
form still scrolls its body above the pinned footer.
Add and edit lists use `max-h-16 shrink-0 overflow-y-auto`. The panel editor
slot uses `min-h-48 grow shrink-0 basis-0`: the 12rem floor is the usable
minimum, and free space still goes to the form. The footer stays `shrink-0`
outside the scrolling form body.

A second drawer component was not added. The same `ModelConnectionSetting`
panel variant and `PanelCard` column own the layout.

## Verification

jsdom asserts an empty or idle list has no `flex-1` and caps at the card,
that the empty list sits directly before the first form, that the first-run
form carries no `flex-1`/`grow`/`h-full` through provider picks, and that six
saved rows sit in capped scroll lists while the editor slot keeps `min-h-48`
with `basis-0` and Cancel, Save, and Delete stay outside the lists. Pixel
fit at 1478×840 and 620×600 is recorded from the rendered onboarding drawer,
not from jsdom.
