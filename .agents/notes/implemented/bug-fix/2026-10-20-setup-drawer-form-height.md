# Setup drawer form keeps the card height

Status: implemented
Translation: pending
PR: https://github.com/LeonEthan/molly-design/pull/194

## Abstract

Product acceptance of the setup drawer failed because an empty connection list
still grew and pushed the first form into the lower half of the card, and
editing one saved connection among several left the form with only a 12rem
basis while the rows kept their content height. An empty or idle list does
not flex-grow, so it keeps its natural height and the first form starts at
the top. While a panel editor is open, each neighbouring row list is capped
and scrolls, and the editor grows into the remaining height with its action
row pinned. The settings section outside the drawer is unchanged.

## Decision

The idle and empty list uses `min-h-0 overflow-y-auto` and does not
flex-grow. An empty list therefore has no height, and the first form, which
is `flex-1`, starts at the top of the card and fills it.
Add and edit lists use `max-h-16 shrink-0 overflow-y-auto` instead of a
content-sized basis. The panel editor slot uses `grow shrink-0 basis-0`, so
free space goes to the form and the capped lists cannot shrink it away. The
footer stays `shrink-0` outside the scrolling form body.

A second drawer component was not added. The same `ModelConnectionSetting`
panel variant and `PanelCard` column own the layout.

## Verification

jsdom asserts an empty list has no `flex-1` and sits directly before the
first form, that an idle list does not grow, and that six saved rows sit in
capped scroll lists while Cancel, Save, and Delete stay outside them. Pixel
fit at 1478×840 and 620×600 is recorded from the rendered onboarding drawer,
not from jsdom.
