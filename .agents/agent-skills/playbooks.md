# Task playbooks

Standard action sequences for the three recurring task shapes. Match the task,
then follow the steps in order; a step you skip gets a one-line reason in your
report. These sequences bind alongside the repository rules they cite and never
replace reading the scoped `AGENTS.md` chain for the paths you touch.

## Bug fix

Own the task end to end: reproduce, diagnose, fix, verify. Every shipped line
traces to runtime evidence; a change that "might help" is a hypothesis, not a
fix, and does not ship.

1. **Reproduce on the real surface first.** Drive the actual CLI or app the
   report concerns (see the owning package README for run commands). If it
   will not reproduce, synthesize the trigger, tighten conditions, or
   instrument until it fires. Ask the human to reproduce only with a stated
   reason the surface cannot reach the target.
2. **Binary-search the cause.** Form candidate hypotheses — seed them with
   regression history (`git log -S`, `git blame`, `gh pr view`) and the
   subsystem's owning docs — then rule them out with runtime evidence, cutting
   the most remaining problem space each pass. When program state is unclear,
   add instrumentation and read it as the code runs. Do not guess. Two
   failures sharing one premise: stop and **attack-the-premise** — write the
   premise down, census the actors holding the imbalance, and reconsider
   before attempting a third fix.
3. **Fix the mechanism, not the symptom.** A guard that silences a crash is a
   symptom fix. The smallest change the evidence justifies ships; revert what
   refuted hypotheses motivated. Check for the pattern, not just the instance.
4. **Verify on the same surface.** The original repro now passes;
   "inconclusive" or a different surface is not a pass. Unit tests show branch
   behavior, not bug absence — see [verification](verification.md).
5. **Order the commits repro-first.** When the bug has a cheap local test
   path, the failing test lands before the fix in git history. Skip when the
   test would be expensive or integration-heavy, and say why in the PR.
6. **Report** what was broken, the root cause, the fix, and how it was
   verified, with verbatim failing-then-passing output. Non-trivial fixes add
   an Agent Note per the [note rules](../notes/AGENTS.md#when-to-write).

## Read-only investigation

For "how does X work", "why was Y built this way", "are we sure about Z". The
deliverable is a cited answer, not a diff.

1. Read the `AGENTS.md` chain for the touched paths, then the relevant Specs,
   active notes, `.agents/docs/` topics, and module READMEs. Search note
   archives for history; past decisions are not current authority.
2. Ground every claim: a `file:line`, a Spec section, a note, or a commit.
   Distinguish a bug, a stale doc, and an unimplemented intent with evidence —
   never rewrite intent to fit the code.
3. Label confidence per claim: directly evidenced, inferred, or unknown. An
   absence of evidence is itself a finding; report it as such.
4. Write nothing. "The docs are wrong here" is a report line, not permission
   to edit; documentation changes are their own task.

## Shipping a PR

Opening or driving a pull request to merge-ready. Planning and review never
authorize implementation or publication on their own; merge decisions belong
to humans.

1. Work from a clean tree; preserve unrelated changes. Run
   `pnpm run docs status` when the work touched Specs, notes, or `.agents/`.
2. Before commit: `pnpm check` and `pnpm format`; docs-affecting work also
   runs `pnpm run docs check`. Composition changes add
   `pnpm check:public-boundary` per the root rules. If tests are skipped,
   report the type/build/static checks that did run. Manifest changes update
   `pnpm-lock.yaml`.
3. Commits are Conventional Commits; AI commits end with
   `Model: <runtime-model-id>`. Small ordered commits that each pass their own
   check beat one large blob.
4. The PR body is a briefing for the maintainer: what changes for the user
   and for the next owner of the code, evidence for behavior claims (commands
   and verbatim output, per [verification](verification.md)), checks run, and
   open limits. Link the owning Agent Note; design-only work links its
   recorded conclusions.
5. Reviewing instead? The [code review rules](../../.github/codex-review.md)
   apply: P0/P1 only, security first; react 👍 when no P0/P1 remains.
6. Address review feedback by re-verifying, not by conceding: each accepted
   change gets the same reproduce-and-verify treatment before it ships.
