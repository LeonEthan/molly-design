# Whole-image or editable-layer delivery

Status: implemented
Translation: current

[中文](2026-10-26-whole-image-delivery.zh.md)

## Abstract

Every new design or redesign used to end in layer reproduction: plate and object extraction with paid image edits, recomposition and fit work, even when the user only wanted the chosen poster. The owner decided on 2026-10-26 that the user picks the delivery form before layer reproduction starts. The design options reply now asks, together with the option choice, whether to deliver the chosen design as editable layers (the default) or as one whole image placed as a single covering `image` element; templates, reconstructions and bounded edits are not asked. The workflow Spec returned to draft for this revision, and no Agent run has yet verified the new branch.

## Problem

- This extends the [user-chosen designs](2026-10-09-user-chosen-designs.md) decision, whose faithful reproduction remains the default.
- The approved workflow Spec and the core Skill promised a layered artwork for every new direction. The only user stop was the option choice, so a user who wanted the image as drawn still paid for extraction and waited for reproduction.
- A choice made after the layered result arrives saves nothing, so the question has to come before stage 4.

## Decision

1. **Where to ask.** In the existing design options reply, beside "choose A, B or C"; no extra turn and no `ask_user_question` call, which the research skill already forbids for the option choice. A brief that names the form is not asked again; no answer means editable layers.
2. **You-choose path.** No stop; editable layers unless the brief asks for a whole image.
3. **Not asked.** Prescribed templates and reconstructions exist to produce editable layers, and bounded edits keep the current structure.
4. **Whole-image result.** The chosen option is copied into `media/` and placed as the only `image` element covering the canvas. `design-replication` is skipped. Its copy is still checked letter by letter against the brief, and the reply names every wrong or missing line and says the wording and layout are not editable and can be split into layers on request. Render and read still apply.
5. **Single owner.** The rule lives in the core `graphic-design` Skill ("Delivery form"); `design-research` and the reporting bullets refer to it.

## Alternatives

- **Deliver the whole image first, split into layers on request.** Removes the question entirely but changes the default deliverable from editable to flat; rejected as the larger intent change.
- **A separate `ask_user_question` before reproduction.** Adds a round trip after the option choice; rejected.

## Limits

No format or code change: a single full-canvas `image` element is already admitted. The CLI structure test checks links and headings, not wording, so it does not establish that Agents follow the new branch; an end-to-end run choosing the whole-image form is still owed.
