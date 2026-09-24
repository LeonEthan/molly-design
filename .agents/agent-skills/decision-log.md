# Decision log

An append-only TSV trail for long, multi-phase, or unattended work — the
in-flight working memory a reviewer can audit. It complements Agent Notes: the
log captures decisions as they happen; the [note rules](../notes/AGENTS.md)
still decide what becomes a permanent cross-session record. The log never
replaces a required note.

## When to keep one

- A task expected to span many turns or phases, run unattended, or be resumed
  by another session.
- Not for small fixes or single-step tasks; the overhead is the point of the
  exemption.

## Format

One TSV per task (for example `.audit/<task-slug>.tsv` or a scratch path
outside the repo), append-only:

```tsv
ts	phase	decision	why	evidence	result
2026-09-24T10:12Z	repro	chose fixture B over live backend	reproduces in 3s without network	out/repro-b.txt	fail confirmed
```

- Log decisions, not actions. One row per hypothesis accepted or reverted,
  approach chosen, or scope changed — never a transcript of commands.
- `evidence` points at an artifact a reviewer can re-run (a script, an output
  file, a commit), per [verification](verification.md).
- Never edit a row. A correction is a new row.

## Lifecycle

- Keep the log local and uncommitted by default. Commit it only when the human
  asks for an auditable trail in the repo, and never include transcript
  content — the repository bans captured transcripts.
- At task end, the permanent record follows the note rules: the log feeds the
  Agent Note; it does not become one.
- Resuming a task? Read the log before re-deriving anything, then verify
  inherited claims against the real artifact before building on them.
