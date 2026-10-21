# Design skill split: decentralized skills and a faster flow

Status: implemented
Translation: pending

## Abstract

The single ~24 KB `graphic-design` skill became a family of four: a slim core
(branches, recommended flow, reporting, boundaries) plus `design-research`,
`design-replication` and `design-text` siblings that an agent loads only when
the task reaches their ground, so a bounded edit reads ~10 KB instead of ~63 KB
of prose. The nine-stage "Required workflow" became a four-step recommended
flow; research and offered options are explicitly conditional on the branch
(the #139 gate is preserved where a new direction is set); review, consistency
and polish merged into one render-and-read pass. CLI materialization of the new
skill list is a separate follow-up; this change ships only the skill content.

## Decision

Date: 2026-10-20
Issue: https://github.com/LeonEthan/molly-design/issues/199 (part 1: skill content)

The single ~24 KB `graphic-design` skill becomes a family of four skills under
`packages/design-authoring/skills/`:

- `graphic-design` (core, ~9.7 KB) — definition, task branches with per-branch
  depth, a four-step recommended flow, the artwork-format pointer, reporting
  and boundaries. Keeps the format reference, examples pointer, and the
  artwork-level scripts (`finalize`, `render-preview`, `format`,
  `migrate-two-file` + `scripts/lib/molly-authoring.mjs`).
- `design-research` (~11 KB) — intent, bounded website research and its gate,
  image-model design options, design defaults, rejection handling. Owns
  `browser-research.md` and `general-poster.md`.
- `design-replication` (~3.4 KB) — faithful reproduction of a chosen design or
  reference as editable layers. Owns `layered-workflow.md`, `replication.md`,
  `reference-pack.mjs` and both examples.
- `design-text` (~3.6 KB) — native text vs image lettering, `textCopy`, custom
  fonts and CJK. Owns `font-preparation.md` and `font-prepare.mjs` (with its
  own copy of the bundled lib, so every materialized directory stays
  self-contained).

An agent loads the core plus only the siblings its branch needs: a bounded edit
reads ~10 KB instead of ~63 KB of prose; the options path adds research and
replication only when a new direction is actually being set.

## Why this split (evidence)

Each sibling's content is used by a distinct, nameable branch or step of the
existing workflow, and unused together:

- Research/options/design-defaults/rejection are exercised only by the
  new-design and redesign branches; the branch table already exempts
  prescribed templates, reconstructions and bounded edits.
- Layered reproduction and the reference pack are exercised only after a chosen
  design exists (reproduce or reconstruct), never during research.
- Text representation and font preparation are exercised only when composing or
  checking copy, independent of where the design came from.

A finer split (e.g. separating lettering from fonts, or options from research)
was rejected: lettering extraction and font registration share the copy
decision, and options prompting shares the research outputs; splitting those
would force agents to load two skills for one step.

## Speed-up measures (issue goal 2)

- "Required workflow" → "Recommended flow" of four steps (baseline, layers,
  compose, render-and-read). Per the Spec, skills recommend and the app
  enforces structure/assets/versions only, so no app change is needed.
- Research and offered options are explicitly conditional on the branch;
  bounded edits and clear briefs skip direction words, `ask_user_question`,
  research and options. The #139 research gate's intent is preserved verbatim
  in `design-research` where a new direction is set.
- Review + consistency + polish merge into one render-and-read pass, halving
  the review loop for small changes.

The workflow baseline in
`.agents/notes/proposed/testing/2026-10-20-agent-workflow-baseline-199.md`
(draft PR #218) showed the split alone does not set pace: a poster from an open
brief spent about 21 minutes on browser research and image options before the
first `design.yaml` and hit the 40-minute cap still reviewing, with one sitemap
probe running 6.5 minutes in a single call, while a bounded text edit finished
in 12 seconds reading only the core skill. So the same texts now bound the
work they describe: the research gate and research reference cap the pass at a
few searches on one site with no site crawling or sitemap probing, and say to
stop and create options once two or three kept references answer the direction
words; the compose step aims for a first renderable draft before refining; and
the render-and-read and assemble-and-compare passes stop when the render
matches or the remaining difference can be named, rather than re-rendering to
look again for more flaws. All of it stays recommended guidance; the app
enforces nothing.

## Boundaries kept

- The approved nine-stage generative-layered Spec is unchanged: it defines the
  generative path for open briefs, which `design-research` +
  `design-replication` still carry; the skill family reorganizes presentation
  and makes conditionality explicit, which the same Spec's branch rules already
  allow. Spec stays `draft`-unaffected (no intent change).
- The app still enforces nothing creative; helper scripts stay optional.
- `apps/cli` materialization (`DEFAULT_DESIGN_SKILLS`, pointer line, tests) is
  a separate follow-up session; this change only ships the new directories.

## Verification

- `pnpm --filter @molly/design-authoring build + test`: 157 tests pass,
  including repointed skill-script tests and live-fingerprint guards.
- Link/anchor sweep across all skill markdown resolves; single-owner check for
  research rule/gate, asking, reporting, design defaults and rejection holds.
