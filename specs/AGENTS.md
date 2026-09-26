# Human-reviewed Specs

This directory contains only publicly shareable client behavior, architecture,
and protocol Specs. Exclude private implementation, operator configuration and
internal records. Use public evidence and identify what this repository cannot
establish. Keep explanatory material in the owning tracked README or PR body;
local-only `.agents/` records are optional background.

English and Chinese translations may follow asynchronously. `current` means the
counterparts express the same intent; mark an older translation `stale` when
meaning changes. A translation never grants approval. Registered SHA protection
is reviewed through `pnpm run docs status` and `pnpm run docs check`.

Specs express human intent and help people understand the system. Start with a
scenario, then the responsibilities and important interactions. Be concise; omit
incidental implementation detail. Deliberate abstraction is allowed, but do not
make permissions, data ownership, durability, or other important guarantees mean
opposite things to different readers. Name unresolved questions rather than guess.

Use `Status: draft | approved | outdated` and `Translation: pending | current | stale`
as separate metadata. `approved` requires a link to explicit human approval of the
relevant revision. Changed intent or guarantees return to draft; editorial changes
retain approval only when the approved meaning is unchanged. Translation status
does not assert behavioral correctness. A translated draft remains a draft.

Keep evidence paths in a short final section, separate from the explanation.
Distinguish intended behavior, inspected implementation, and executed validation.
When they disagree, record the gap; do not silently turn a bug into a requirement.

Existing documents enter review as outdated, not automatically approved. Migrate
one topic when useful; do not bulk-import or bulk-mark unrelated documentation.
Refer to existing scoped `AGENTS.md` invariants instead of creating a parallel list.
