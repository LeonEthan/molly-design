# Spec approval records

This public summary preserves the minimum approval provenance needed by the
Specs. It records owner decisions, not runtime verification. Shared decision
notes live in the tracked `.agents/` tree; historical source conversations are
not included in this repository.

## 2026-09-21 existing Specs

Repository owner `LeonEthan` approved the then-current revisions of 16 Spec
documents at tree `a7a297ae` on 2026-09-21. The decision was originally posted
on PR #52 before the repository history was rebuilt; that PR is no longer
available here. The approved documents were `chat-share-image.md`, the English
and Chinese pairs of `communication-architecture`, `graphic-design-platform`,
`lody-upstream-adoption`, `molly-design-independent-release`,
`molly-embedded-pi-harness`, `session-orchestration`, and
`session-validation-hotfix`, plus `machine-lifecycle-ack.md`. Later revisions
that changed intent returned to draft independently of this historical approval.

## 2026-09-15 and 2026-09-16 design revisions

The owner approved the first-stage single-canvas authoring revision on
2026-09-15 and the Lovart-style canvas revision, including retirement of the
manual canvas-size entry, on 2026-09-16. These are previous approvals recorded
for `graphic-design-platform`; they do not approve its later draft changes.

## 2026-09-25 generative layered design

The owner reviewed the initial English and Chinese generative layered design
Spec and replied “LGTM” on 2026-09-25. The approved revision was introduced by
[PR #17](https://github.com/LeonEthan/molly-design/pull/17) at commit
`1317a809`. Later changes to the workflow need their own approval record.

## 2026-09-26 generative layered design workflow rewrite

The owner approved the revised workflow before implementation. The revision
requires the Agent to follow all nine stages and to research design-site visuals
unless the user explicitly prescribes a concrete template or reference target
to follow without additional inspiration and the inspected target suffices.
It removes blanket permission to skip or freely reorder stages. This approval
covered the English and Chinese workflow Spec revisions.

## 2026-09-26 generative layered design closeout

After reviewing the revised workflow and acceptance summary, the owner explicitly
requested the three closeout actions: commit the work, consolidate acceptance
records, and approve the current English and Chinese layered-design Spec
revisions. This is approval of the stated workflow and boundaries, not proof
that every future design run or distribution configuration will succeed.

## 2026-10-01 native Pi packages without permission checks

The owner approved the current English and Chinese revisions of
`molly-embedded-pi-harness` and `generative-layered-design-workflow` on
2026-10-01, after reviewing [PR #55](https://github.com/LeonEthan/molly-design/pull/55)
and its Codex review fixes. The revisions move the embedded Agent to Pi 0.99.2
with unmodified Pi packages in Molly's own Pi profile, run tools without
permission checks behind the `cc-safety-net` floor, and store selected model keys
in that profile for sub-agents. This approves the stated intent, not runtime
behavior beyond the evidence recorded in the PR.

## 2026-10-09 graphic-design skill refresh

The owner approved the current English and Chinese revisions of
`generative-layered-design-workflow` on 2026-10-09, after reviewing the
graphic-design skill refresh on branch `feat/graphic-design-skill-refresh`
(commits `de0c1e3a` through `1cbda76b`). The revision makes reporting
proportionate, adds breakable design defaults as the review checklist, asks
direction-changing questions once through the structured question tool, writes
direction words as the working yardstick, bounds research and exempts bounded
edits that keep the direction, draws drafts from rendered native blockouts plus
delivery assets rather than found references, and adds the rejected-direction
rule. This approves the stated intent; design-quality evaluation runs are
recorded separately.

## 2026-10-09 user-chosen designs

The owner approved the current English and Chinese revisions of
`generative-layered-design-workflow` on 2026-10-09, after reviewing branch
`feat/graphic-design-skill-refresh` (commits `57a78f1e` through `f737eb3d`).
The revision has the image model create at least three complete design options
that the user chooses between at the end of the turn, then reproduces the chosen
design faithfully as editable layers; treats a redesign as a new design; creates
options from the source image plus a few inspiration images the Agent chose from
research; takes all wording from the brief or source with a line-by-line check
and turns lettering a font cannot reproduce into image layers; and settles the
canvas size from the brief, treating an empty canvas as a placeholder. It
replaces the earlier "draws drafts from rendered native blockouts plus delivery
assets rather than found references" intent. This approves the stated intent;
design-quality evaluation runs are recorded separately.
