# Codex second opinion

Escalate for a cross-check from the Codex CLI (`gpt-6-astra` at `high`
reasoning) when a task hits one of the three branches below. The value is
independence: each call is a cold-start subprocess with no memory of this
session's reasoning path, so carry the context it needs into the prompt.

Three binding constraints:

- **Advisory only.** The opinion informs; it never applies. Human judgment
  lands the decision — same root rule as Agent review.
- **Read-only runs.** Every call uses the default `read-only` sandbox. Never
  pass `--dangerously-bypass-approvals-and-sandbox`, approval bypasses, or a
  writable sandbox.
- **No silent repair.** The second opinion is reported, its evidence named,
  and disagreements resolved by the human — never silently merged into the
  work.

## Preflight

On first use in a session, verify the tool and model exist:

```sh
command -v codex
codex debug models | grep -E '"slug"|"effort"'
```

If `codex` is missing or `gpt-6-astra` / the `high` level is absent, stop and
say so; do not substitute another model or level silently.

## Branch 1 — Complex tradeoff

A design choice has two or more defensible options and the pick is hard to
reverse: state-machine shape, contract boundary, migration order. Escalate
before committing to one.

```sh
codex exec --ephemeral \
  -m gpt-6-astra -c model_reasoning_effort='"high"' \
  -C "$PWD" "$(cat <<'EOF'
Read <files>. Decision: <question>.
Options: <A ...> vs <B ...>.
Constraints: <rules that bind>.
Give a recommendation with the strongest argument against it.
EOF
)"
```

The prompt must name the exact files to read, the decision, the options, and
the constraints. Demanding the counter-argument is part of the check.

## Branch 2 — Independent review

A diff is ready and you want a second read before the human review.

```sh
codex exec review --uncommitted \
  -m gpt-6-astra -c model_reasoning_effort='"high"'
```

Scope its report against the repository bar (P0/P1 per the root Code Review
Rules). Report its findings labeled as Codex's, alongside your own — do not
merge the two into one unattributed list.

## Branch 3 — Stubborn bug

The playbook's bug-fix loop has produced two failed hypotheses sharing one
premise (the attack-the-premise trigger). Escalate at that point, not before:
the premise, the failed hypotheses, and the evidence against each are the
payload the second opinion needs.

```sh
codex exec --ephemeral \
  -m gpt-6-astra -c model_reasoning_effort='"high"' \
  -C "$PWD" "$(cat <<'EOF'
Bug: <observable symptom and repro>.
Premise under attack: <shared assumption>.
Failed hypotheses and the evidence that refuted each: <list>.
Read <files>. Propose what to check next and why.
EOF
)"
```

## Failure handling

A failed call (nonzero exit, missing CLI, empty output) is reported with its
error; the work continues without the opinion. Never retry automatically and
never work around a missing tool.
