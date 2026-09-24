# Named engineering principles and task playbooks for agent work

Status: implemented
Translation: current
PR: https://github.com/LeonEthan/molly-design/pull/3

English | [中文](2026-09-24-engineering-skills-vocabulary-playbooks.zh.md)

## Abstract

Repository rules bound agent behavior but had no names, so a human could not
steer in-flight work by citing a short principle, and recurring task shapes
had no standard action sequence. After evaluating the MIT-licensed pstack
skill pack from the cursor/plugins repository, we adopted four
`.agents/agent-skills/` documents adapted to this repository: a principle
vocabulary that mostly names existing constraints, three task playbooks, a
verification standard, and a lightweight decision log. Two maintainer-requested
conventions joined the same change: a named first-principles design rule and a
scoped ban on local comments. pstack's autonomy-oriented elements were rejected
because planning here never authorizes implementation or publication. The
documents landed with PR #3; their steering value remains unmeasured until used
on real tasks.

## Problem

- Root rules are unnamed prose. A maintainer redirecting an agent mid-task
  must quote or paraphrase a rule; there is no shared short vocabulary ("use
  subtract-first") with a defined meaning.
- Recurring task shapes — bug fix, read-only investigation, shipping a PR —
  each re-derive their action sequence from scattered rules. Sequencing
  knowledge like "reproduce before fixing" and "the failing check lands before
  the fix in git history" was unwritten.
- The evidence rule ("report outcomes, evidence and limits") says *that*
  claims need evidence, not *how* to verify different change types.
- Root `AGENTS.md` sat at 7803 of 8192 bytes, leaving no room to point at new
  material without restructuring.

## Evaluation of pstack

pstack bundles 23 named one-rule principles, 23 task playbooks behind a
routing mode, and supporting skills (MIT). First-hand reading found:

- Direct equivalents of existing rules: laziness-protocol /
  subtract-before-you-add ≈ "question requirements, delete unnecessary
  mechanisms"; test-behavior-not-implementation ≈ the mock/sleep test rules;
  prove-it-works ≈ "report outcomes, evidence and limits". Importing these
  wholesale would have duplicated mechanisms, against the subtract-first rule
  itself.
- Genuinely missing and tool-agnostic: the named-principle vocabulary for
  steering; per-task action sequences (repro-first, hypothesis bisection,
  repro-commit-before-fix); attack-the-premise; the blast-radius "prove the
  one safety fact" procedure; the match-the-check-to-the-change verification
  table; an append-only decision TSV.
- Conflicting or non-portable: never-block-on-the-human and overnight autonomy
  grants conflict with "planning/review does not authorize runtime
  implementation or publication"; the anti-planning stance conflicts with Spec
  governance; model routing, the sticky mode, `/loop`, cloud agents, and the
  PR watcher are Cursor-runtime-specific.

## Decisions

Adopt four leaves under `.agents/agent-skills/`, following the existing
issue-tracker/domain pattern (plain Markdown, linked from root `AGENTS.md`,
tool-neutral):

- `engineering-principles.md`: the vocabulary. Six principles name existing
  rules (index only, no rule change); seven adopted principles add new
  guidance — five with mechanics in the other leaves (falsifiable-done,
  repro-before-fix, attack-the-premise, prove-on-the-real-surface,
  name-the-safety-fact), plus `first-principles` and `names-over-comments`
  covered below.
- `playbooks.md`: bug fix, read-only investigation, shipping a PR — sequences
  built from this repository's tooling (`pnpm check`, `docs check`, `gh`,
  Conventional Commits, note rules, P0/P1 review rules).
- `verification.md`: change-type-to-proof table plus the blast-radius
  procedure with its confidence ladder.
- `decision-log.md`: append-only TSV for long or unattended tasks; explicitly
  subordinate to Agent Notes and local-only by default (no transcripts
  committed).

Two maintainer-requested conventions joined the same change. Root `AGENTS.md`
gained "From first principles:" on the design-principles rule — the existing
question → delete → simplify order already mirrors the first three steps of
the design algorithm popularized by SpaceX's Raptor program, so the change
names the method and adds a delete test ("a design iteration that deleted
nothing is not done") rather than a new mechanism — and "No local comments:
rename, extract, or retype; external constraints cite the issue/Spec" in
contribution rules. The vocabulary names them `first-principles` and
`names-over-comments`. The comment rule scopes to function bodies: API doc
comments and tool directives (lint suppressions, `@ts-expect-error`) are out
of scope, external constraints (upstream bugs, Spec quirks) are cited rather
than explained inline, and the rule applies to new and touched code — a
cleanup of historical comments would be a separate scoped task. The Raptor 3
exemplar stays in this note rather than in binding text: cultural references
age, and rationale belongs to notes.

The root "Agent skills" section was compressed (the triage label list and
constraints duplicated in owning leaves were shortened) to fit the four new
pointers; the verification and decision-log pointers were then merged into one
line to fund the two rules above: 8129 of 8192 bytes after all changes.

## Alternatives considered

- **Import pstack as-is under `.claude/skills/`**: rejected. It duplicates
  existing rules, pulls in Cursor-runtime dependencies, conflicts with the
  publication and image-budget rules, and its persona style is not this
  repository's voice.
- **Claude Code native skills (`.claude/skills/`)**: rejected for now. The
  `.agents/agent-skills/` pattern is established, tool-neutral, and covered by
  `docs check`; nothing adopted here needs model-invocation frontmatter.
- **One combined file instead of four**: rejected. The four concerns trigger
  on different cues (steering vocabulary vs task start vs pre-done vs long
  tasks); separate leaves keep each read conditional and short.

## Trade-offs and limits

- More documents to maintain; mitigated because the principle table links
  owning rules instead of copying them, and each adopted mechanic lives in
  exactly one leaf.
- The triage label names left the root section; discovery now depends on the
  "triage: labels" pointer. Labels remain defined in `triage-labels.md`.
- Root `AGENTS.md` headroom is 63 bytes after the change; the next addition
  there needs its own compression or relocation.
- Steering value (humans citing names, agents following playbooks) is an
  expectation, unverified until used on real tasks.
- The pstack evaluation reflects the pack as cloned on 2026-09-24; upstream
  changes are untracked.

## Verification

- Byte counts measured: root `AGENTS.md` 7803 → 8129 (gate 8192) after the two
  new rules and the pointer merge.
- Docs-only change. `pnpm run docs check` errors [] and `pnpm check` exit 0,
  both run 2026-09-24 before commit. (Correction: the proposed revision said
  the full check was not run; it ran before commit.)
- Implemented via PR #3, merged 2026-09-24 (ff495327).

## Source

- pstack: <https://github.com/cursor/plugins/tree/main/pstack> (MIT),
  evaluated from a local sparse clone on 2026-09-24.
