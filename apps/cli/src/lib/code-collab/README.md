# apps/cli/src/lib/code-collab — file responsibilities

Binding rules live in [AGENTS.md](AGENTS.md); this file is the navigation index.
The historical Code Collab rewrite is recorded in `specs/code-collab-v2.md`;
current scope follows the graphic-design platform Spec.

- `code-collab-v2-service.ts` — unified Files service. It resolves owner/child
  workspace roots, enforces path/text/payload limits, handles open/refresh/save
  conflicts, and publishes a Files index. Initial activation, watcher refresh and
  terminal turn refresh reuse the existing full scan and Flock publication path;
  they do not compute All Changes, derive turn diffs, or publish diff summaries.
  Explicit historical turn/current/batched diff RPC reads remain available for
  compatibility and are not scheduled by Files lifecycle events.
- `code-collab-v2-diff-store.ts` / `turn-diff-store-worker.ts` — legacy snapshot
  read adapter and required worker. New turn writes and edit-evidence chaining
  have been removed. Existing schema, snapshot reads, limits and retention/GC
  remain in [packages/turn-diff-store](../../../../../packages/turn-diff-store/AGENTS.md).
- `file-index-scan-worker.ts` / `file-index-scan-pool.ts` — off-main-thread
  directory scanning and Files index construction. Git workspaces reuse
  `git ls-files` for path listing; plain directories reuse the bounded filesystem
  scan. Neither path computes a diff or loads a stored pre-image.
- `workspace-watch-coordinator.ts` / `workspace-watch-worker.ts` /
  `workspace-watch-worker-core.ts` — shared Fleet-level watcher invalidation.
- `code-collab-v2-service.test.ts` — path validation, digest conflicts, file
  refresh and publication, payload limits, historical snapshot reads and
  unsupported LSP responses. Legacy snapshots are seeded through the existing
  package API as synthetic fixtures, then read through the CLI adapter.
- `code-collab-publish-repair.test.ts` — initial Flock reconciliation and
  owner-scoped publication repair/backoff.
- `code-collab-v2-diff-store.test.ts` — existing database reopening, exact legacy
  snapshots, missing/oversized reads, owner scoping and retention behavior.
