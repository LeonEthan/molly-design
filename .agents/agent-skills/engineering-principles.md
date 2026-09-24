# Engineering principles

A named vocabulary for steering and citation. Each principle is one rule plus
its trigger; the binding constraint stays in its owning document (linked),
never copied here. Cite a principle by name when it changes a decision, and
name the choice it changed. Humans can invoke a name ("use attack-the-premise")
to redirect work precisely. Do not cite a principle you did not apply.

## Naming existing rules

These give names to constraints that already bind. They change nothing.

| Principle | Rule | Apply when | Owning rule |
| --- | --- | --- | --- |
| subtract-first | Question the requirement, delete unnecessary mechanisms, then simplify. Build only what is needed now. | Sizing a diff; tempted to add an abstraction, layer, or setting | [Root rules](../../AGENTS.md) |
| evidence-or-label | Every claim carries its evidence or its label (measured, inferred, guess). Report limits. | Reporting outcomes, review summaries, PR bodies | [Root rules](../../AGENTS.md) |
| behavior-not-mocks | Test observable behavior with explicit signals and deterministic fixtures; no real sleeps, no mock call counts. | Writing or keeping a test | [Root rules](../../AGENTS.md) |
| intent-has-owners | Specs define intent, docs implementation, notes decisions. Distinguish bugs, stale docs, and unimplemented intent with evidence; never rewrite intent to justify bugs. | Code and documents disagree | [Root rules](../../AGENTS.md), [Spec rules](../../specs/AGENTS.md) |
| one-rule-one-home | A binding rule lives in exactly one nearest `AGENTS.md`; everything else links. Never move a binding rule into a note to buy bytes. | Editing or adding constraints | [Document maintenance](../README.md#where-content-goes) |
| read-before-crossing | Before changing a scoped boundary (platform contracts, shared contracts, composition, daemon negotiation), read its owning `AGENTS.md`. | Touching a boundary listed in the root rules | [Root rules](../../AGENTS.md) |

## Adopted principles

These add guidance not previously written down in this repository; their
mechanics live in the linked owner or skill file.

| Principle | Rule | Apply when | Mechanics |
| --- | --- | --- | --- |
| first-principles | Reason up from what must be true, not sideways from what exists. Integrating a requirement means redesigning as if it had been foundational from day one; a design iteration that deleted nothing is not done. | New designs; integrating a requirement into an existing design | [Root rules](../../AGENTS.md) |
| falsifiable-done | Start multi-step or unattended work from a checkable done predicate, not a duration or a feeling. | Scoping a task, delegating, planning phases | [Playbooks](playbooks.md) |
| repro-before-fix | Reproduce the defect on the real surface first; the failing check lands before the fix in git history when a cheap local test path exists. | A reported defect | [Playbooks](playbooks.md#bug-fix) |
| attack-the-premise | When two fixes sharing one premise have failed the same gate, stop. Write the premise down, census which actors hold the imbalance, and question the premise instead of writing a third fix that assumes it. | Debugging that keeps bouncing | [Playbooks](playbooks.md#bug-fix) |
| prove-on-the-real-surface | Verify against the real artifact (run the app, read the stored value, replay real input), not a proxy, a self-report, or "it compiles". | Before declaring done | [Verification](verification.md) |
| name-the-safety-fact | For a small-looking change, name the one fact it is safe because of, then prove that fact by running code. | "Trivial" changes, review sign-off | [Verification](verification.md#blast-radius) |
| names-over-comments | The urge to write a local comment is a signal to rename, extract, or retype; external constraints cite the issue/Spec. API docs and tool directives are out of scope. | Writing or reviewing a function body in first-party code. Does not apply to vendored upstream (`packages/design-bento/bento/`, `packages/design-bento/vendor/`, `vendor/`); when Molly patches upstream and must explain why, cite an issue or note instead of a long inline comment. | [Root rules](../../AGENTS.md) |

## Steering with names

- In a reply or PR body, cite as `name-the-safety-fact: all consumers parse at
  the boundary, proven by <script/test>` — the name plus the choice it changed.
- A recurring correction with no name yet is a gap. First try to encode it in
  structure (a lint, a `docs check` topic, a script); only if it needs judgment,
  propose a new row here with the evidence of recurrence.
- Do not expand this table without a recurring, evidenced need. A vocabulary
  that names everything steers nothing.
