# User-chosen designs, faithfully reproduced

Status: implemented
Translation: current

[中文](2026-10-09-user-chosen-designs.zh.md)

## Abstract

The owner's intent for generative layered design was that the image model creates the design, the user chooses among at least three complete designs, and `design.yaml` only reproduces the chosen design in editable form. The written record said instead that the Agent picks the best "draft" and rebuilds the artwork with the draft as loose guidance, so the Agent redesigned during the rebuild, and eval outputs looked like rearranged cut-outs on templates. This correction makes the Skill offer at least three complete design options, end the turn for the user's choice, and then reproduce the chosen design faithfully: a background plate edited from the design, objects isolated from it, and copy matched to it. The workflow Spec returns to draft for owner approval; whether output quality improves is not yet measured.

## Problem and evidence

- The approved Spec (2026-09-25) said "generate several full-image composition drafts, and let the Agent select the best", and stage 4 regenerated elements "using the selected draft as a reference". The [original proposal](2026-09-24-generative-layered-design-workflow.md) recorded "The Agent picks the best draft; a later 'auto' option may distinguish Agent and user selection." The Skill added "A draft guides the rebuild; it never becomes the artwork or a near-complete background."
- The owner clarified on 2026-10-09 that the image is the design, not a draft; that at least three designs are shown for the user to choose; and that only the chosen design is made editable and fine-tuned.
- Luckin redesign eval runs on the [direction-first Skill](../simplification/2026-10-09-graphic-design-skill-refresh.md) produced cut-outs with white halos and hard edges on generic gradient or bokeh backgrounds, yellow badge labels and default bold type. The owner judged them mediocre, and a further revision that required drafts for redesigns made them worse. Quality was being lost in the language-model rebuild, which the earlier process rules did not touch.
- A turn that leaves `design.yaml` unchanged ends as `no_artifact`, which the conversation shows without a file receipt, so a choice turn needs no product change.

## Decision

With owner approval on 2026-10-09:

1. **Design options.** A new design or redesign gets at least three complete options from the image model: finished posters at the canvas ratio, with the headline and key copy drawn in, differing in concept or composition. Supplied delivery assets (including a source poster being redesigned) may be `edit` inputs; found references never are. A rendered blockout is an optional layout aid. Options are judged against the design defaults before they are shown.
2. **User choice.** The Agent shows every option (A, B, C), recommends one, asks the user to choose and ends the turn without changing the artwork. It continues in the turn where the user names an option, or in the same turn when the user asked it to decide.
3. **Faithful reproduction.** The background plate is edited from the chosen design with foreground objects and text removed; objects are isolated from the design; positions and sizes are measured from it; copy is matched to it with the user's exact wording. A supplied face, product or logo that must stay exact is isolated from the source when the design altered it. Review compares the render with the chosen design side by side and as an overlay.
4. **Redesign branch.** "Redesign", "optimize" or "重新设计" is a new design even with keep-the-face constraints; a bounded edit is a named local change.
5. **Reverted.** The earlier "route redesigns through image-model drafts" commit, its "draft likeness versus final identity" recipe and the "present one chosen direction" reporting rule.

Kept: research, direction words, the question tool, design defaults and the rejected-direction rule, which now applies when the user rejects every option.

The eval runner (local branch, not in the product) treats a turn that commits nothing as a choice turn, replies by choosing the Agent's recommended option, and records the exchange. The owner judges the options and the reproduction separately.

## Alternatives considered

- **Let the Agent choose and keep the rebuild as guidance:** the recorded design, rejected because it put design quality in the language-model rebuild.
- **Ask for the choice with the question tool in the same turn:** rejected by the owner; ending the turn shows the options as full images in the conversation.
- **Deliver the chosen image as one flat layer with text on top:** keeps quality but gives up independent object editing; faithful layered reproduction is the target, with a near-complete plate allowed.

## Limits

- No run has used this workflow yet; fidelity of plates and isolations from a finished design is unverified, and copy drawn by the image model may be wrong.
- A new design now takes two turns and at least three option calls before any layer work.
- The Spec revision is a draft awaiting owner approval.

## Later change

[Inspiration images as inputs, source copy and lettering layers](2026-10-09-inspiration-inputs-and-lettering.md) corrects decision 1: inspiration images the Agent chooses from research may be `edit` inputs. It also takes copy from the source rather than the design and adds lettering layers.
