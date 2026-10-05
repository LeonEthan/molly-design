# CLI Code Collab — Index

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Historical rewrite: specs/code-collab-v2.md. Current product scope follows
specs/graphic-design-platform.zh.md. The old v1
host/runtime/CRDT capture implementation has been removed from this directory.
File-by-file responsibilities: [README.md](README.md).

## Invariants

- Do not reintroduce per-session Code Collab host runtimes, host handles,
  bootstrap secrets, synced text CRDT documents, ACP diff evidence collectors,
  per-turn snapshot writes, or automatic Git/All Changes summaries. ACP tool
  history and file locations remain on the existing history pipeline.
- `code-collab-v2-diff-store.ts` exposes legacy snapshot reads and existing
  retention/GC only. Preserve the stored format and production
  `turn-diff-store-worker.ts` for those reads; do not migrate, replace, or
  newly populate the historical store. Its calibrated retention clock stays
  injected through `getServerNow()`.
- The Files index uses owner-session Flock stream
  `<workspace-id>:fi:<master-session-id>` (one row per path). Successful index
  changes or targeted repairs advance `<workspace-id>:fis:<master-session-id>`;
  the bridge in `../loro/doc.ts` lets Electron invalidate its Machine RPC
  snapshot. Preserve 180-day TTL, content dedupe and scoped publication repair;
  publish no new `diffStats` or change rows. Root activation, watcher and terminal
  turn refresh all reuse the full Files scan without reading snapshots or
  computing Git diffs.
- A file-index row whose path key carries U+FFFD came from a byte stream decoded
  across a chunk boundary, not from a scan; it is its own LWW key, so a correct
  republish cannot overwrite it. The shared helpers hide it on read and delete it on
  the next write — do not "restore" such rows.
- Only Code Collab RPC use extends `WorkspaceWatchCoordinator` idle ownership.
  Startup/restart/coverage gaps trigger authoritative full refresh; there is no
  per-directory fallback. Verify worker changes with the emitted
  `dist/code-collab-watch-worker.js` handshake/shutdown smoke. Its credential-safe env
  allowlist must preserve `ELECTRON_RUN_AS_NODE`: packaged Electron uses `Lody Helper`
  as Node, and dropping the flag launches a second GUI app instead of the worker.
- `save-text` never throws on a changed file: if the disk content is too large,
  binary, or invalid UTF-8 it returns a `digest_mismatch` conflict (with the disk
  digest via streaming when the file is too large to read) instead of an error, so
  the guest's unsaved edits survive. See `readDiskStateForSave`.
- In Git worktrees, scanning prefers `git ls-files` only for recursive scans and
  synthesizes lazy parent directories; non-recursive directory refresh stays on FS
  scanning because Git does not record empty directories. Fallback FS scanning is
  path-only and must not read file contents to classify text/binary/size. Root
  init/full/turn refresh should use the worker `full-state` path when available so
  file listing and fileIndex building stay off the main thread.
- Machine RPC is the integration boundary. Local/Electron direct transport can be
  added below that RPC abstraction, but file operations still route to the single CLI
  service. In particular, local `code-collab/get-file-index` scans/builds the initial
  Files snapshot without awaiting Flock publication, then queues a
  force-reconcile of that fresh in-memory state without delaying the response. This
  repairs a durable file-index Flock that became stale while the CLI was stopped;
  Flock remains the durable replication path for remote consumers and local renderer
  invalidation after that initial snapshot.
- Non-Git All Changes reconstruction is bounded before SQLite decompresses a snapshot:
  at most four paths run concurrently, one request retains at most 8 MiB of raw cached
  snapshots by default, and over-limit paths are returned as deferred for single-file
  loading. Never restore an unbounded candidate array or reconstruct deferred paths twice.
- File RPCs canonicalize an absolute request path to a workspace-relative path only
  when the target machine resolves it inside the session workspace root. Absolute
  paths outside that root remain `invalid_path`; never rely on frontend path stripping
  as the filesystem access boundary.
- Native `fs.watch` handles must stay in `workspace-watch-worker-core.ts`; the main CLI
  Worker owns only subscriptions, refresh timers, scans, file-index state,
  and Flock publication. The child receives canonical roots over private IPC only and
  exits on IPC disconnect. Do not restore direct or per-directory watches in the service.
- Child sessions resolve file operations against the parent session host/worktree when
  the session metadata has a parent.
- Shared file-index publishing is content-deduped. Do not publish full rows or advance the
  `<workspace-id>:fis:<master-session-id>` signal only to bump `updatedAtMs`; unchanged
  rows must not wake file surfaces. Transport/Meta reconnects are not dirty signals and
  must not rescan known owners. Initial activation reconciles only that owner. A failed
  write/flush/post-sync/signal transaction schedules bounded exponential-backoff repair
  only for the affected owner, serialized with its local refresh publication and using
  the latest in-memory state. Keep a failed signal pending even when the FI repair already
  landed so the targeted repair cannot mistake the transaction for complete.
- Machine RPC now dispatches handlers concurrently (see
  `packages/loro-streams-rpc/AGENTS.md`), so handlers cannot assume serial execution.
  `save-text` keeps its read-check-write atomic via `serializeByAbsolutePath`
  (per-file write chain) so two concurrent saves to the same path can't both pass the
  base-digest check and clobber each other; different paths still save in parallel.
  Pure reads (open/refresh/diff) stay lock-free.
