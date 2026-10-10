# Image lettering textCopy: rewordable lettering layers

Status: implemented
Translation: current

[中文](2026-10-10-lettering-text-copy.zh.md)

## Abstract

Image lettering layers (pictures of copy a font cannot reproduce) now carry a
`textCopy` field with the exact wording they show. The canvas selection toolbar
offers "Edit wording" on such layers, which sends the new wording to the Agent
as an ordinary regeneration prompt; the picture never becomes a text element.
The Skill requires the field, forbids merging separate copy pieces into one
layer, and reports lettering as rewordable instead of frozen.

## Problem and evidence

In a 2026-10-10 test run of the Nobel poster case, the three display headlines
(诺贝尔文学奖 / 安妮·卡森 / ANNE CARSON) came back as image layers isolated from
the chosen design. The lettering-layer rule did its job for fidelity, but the
result read to the person as text "stuck" inside pictures: the layers could be
moved and scaled but not reworded, and the canvas gave no sign the pictures
carried copy at all. The Skill already required reporting the limit in prose,
but prose in a chat reply does not follow the layer; a week later nobody can
tell a lettering PNG from a photo without re-reading pixels.

## Decision

Image elements gain an optional `textCopy` field carrying the exact wording the
picture shows. Its presence marks the image as rendered lettering; ordinary
photos and textures never carry it.

- **Canonical format.** `BentoImageElementV4.textCopy?: string` (1–2000
  characters), admitted in the v4 closed-world field table and validated by the
  kernel's `createElement` payload check. The frozen capability matrix keeps
  its hash gate; `textCopy` is a Molly extension recorded here rather than a
  retroactive matrix row, matching how the matrix is evidence, not the live
  schema.
- **YAML projection.** `design.yaml` admits `textCopy` on image elements;
  roundtrip preserves it exactly like any other canonical field.
- **Selection.** The canvas selection summary carries `textCopy` for image
  elements, so the shell and toolbar can see it without new document IPC.
- **Editor.** Selecting a single image with `textCopy` shows an "Edit wording"
  entry in the selection toolbar. It opens a small popup prefilled with the
  current wording; submitting sends the new wording as a `edit-wording`
  selection action, which lands in the ordinary composer as a prompt asking the
  Agent to regenerate only that layer, replace the image asset and update
  `textCopy`. The picture never becomes a text element; rewording is a
  regeneration the Agent performs, keeping the serial turn contract untouched.
- **Skill.** Stage 6 and the lettering reference require `textCopy` on every
  lettering layer, forbid merging separate lines or unrelated pieces into one
  layer, and describe lettering as rewordable rather than frozen when
  reporting.

## Alternatives considered

- **ALT text only, no editor action:** screen-reader style metadata without a
  rewording path leaves the original complaint — the copy is still stuck.
- **Convert lettering to native text on demand:** the whole point of a
  lettering layer is that a font cannot reproduce it; converting would destroy
  the design the field exists to preserve.
- **A separate `editable` flag:** rejected as redundant. Presence of `textCopy`
  is the marker; a boolean would only add a way for the two to disagree.

## Limits

- Rewording quality is bounded by the image model: regenerated lettering may
  differ in stroke detail from the original even when the copy is right. The
  prompt asks for the same style, and the review stages still apply.
- `textCopy` is authoring-time truth. Nothing verifies that the pixels still
  match the string after manual image replacement; a replaced image keeps its
  `textCopy` until the Agent or the person updates it.
- The frozen capability matrix does not list `image.textCopy`; adding a row
  requires re-running the matrix hash flow, which is a separate decision.

## Evidence

- `pnpm check` (type, lint, i18n, boundary guards) passes.
- design-authoring: 156 tests pass, including the new intake cases (admits
  `textCopy`, rejects non-string and empty values) and roundtrip coverage of
  an `image-lettering` fixture element.
- design-shared selection schema tests cover `textCopy` bounds and the
  `edit-wording` toolbar request shape.
- `pnpm --dir packages/design-bento build` assembles the editor bundle with
  the toolbar change.
- A Codex CLI review (`gpt-6-astra`, high) found that Enter during an active
  IME composition submitted the wording popup early; the handler now ignores
  composing Enter events (`isComposing` / keyCode 229), and the toolbar test
  suite carries the deterministic regression case.
