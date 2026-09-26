# Shared UI helpers and file surfaces

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
These rules also bind callers changing crash recovery, localStorage caches, file
surfaces, or Electron IPC typing. Read the relevant sections before those changes.

## Electron IPC types

- `app-platform.ts` rejects explicit cloud builds before the shared product shell
  renders; do not use a cloud value as a fallback for missing local capability.

- `electron-ipc-client.ts` may import `ElectronIpcServices` from main-process
  registration with `import type` only. Browser/mobile bundles must erase the edge;
  never add an Electron runtime/package dependency or allow Node APIs in shared UI.
- Keep `experimentalDecorators` and the direct catalog-pinned `@types/node` dependency
  for the source declarations. Service classes and their single constructor list own
  invoke signatures; never duplicate them in a handwritten contract, spec, or one-for-one
  platform port. Fix resolution/erasure at this boundary or reconsider caller ownership.
  Push events and one-way sends stay in `@molly/shared/electron-ipc`.

## Crash recovery and diagnostics

- `ErrorBoundary`'s `error-boundary-fallback.tsx` displays the real error and one-click
  full-report copy on every build. Details default visible (`showErrorDetails` opts out);
  `lib/error-boundary-report.ts` is the pure copy builder.
- Crash screens never reload/restart/reset by themselves. `resetKeys` recovery stops at
  `MAX_AUTOMATIC_RESETS` per repeating error; the fallback reports that retrying stopped,
  stays visible, and waits for a button press.
- The local desktop crash screen may reload its renderer and copy a diagnostic
  report. It must not scan or wipe inherited `lody*` browser databases,
  localStorage, caches, cookies, or service workers. A scoped Molly data
  reset requires a separately reviewed ownership boundary.
- Include the tail of `lib/session-render-trace.ts` in copied reports. Its module-level
  ring records render/mount/navigation, collapsing consecutive duplicates into ×N.
  Writers append one compact diagnostic line, never drive behavior from the trace;
  surface mount/unmount uses a layout effect.

## File Preview and Code Collab

- Remote file surfaces read the owner-session file-index Flock. Local Electron targets
  load initial file trees and All Changes from the local `code-collab/get-file-index`
  Machine RPC snapshot without awaiting Flock, then subscribe to local Flock events.
  Subscription delay/failure cannot block IPC or trigger cloud fallback. Allow stale
  join events to converge with the CLI's asynchronous snapshot reconciliation.
  Machine RPC also serves exact content, save, LSP, and diff requests.
- `openFile` uses File Preview v3 plain reads: no workspace watch, All Changes recompute,
  or Flock publish. Local Electron uses IPC-only `file/resolve-local`, negotiated via
  `localFileResources`; unresolved routes never fall back to Streams RPC. Electron
  serves local file resources; remote targets retain restricted, bounded `file/preview`.
- Small local text may enter the full-document editor/cache. `paged-text` is a separate
  readonly snapshot with bounded random reads; never seed the save cache, executable
  HTML, rendered Markdown/SVG, or full-document copy/download from it. Hidden paged
  viewers abort reads; virtual rows and one page bound memory independently of file size.
  Binary local previews carry resource URLs, never base64. Binary results, local or
  remote, never enter the text-open cache.
- The index is a hint, never an open gate: send unindexed paths to the machine, and
  leave `unavailableReason` unset for `binary` entries. Force `external: true` results
  readonly regardless of the index; saves stay inside the session workspace.
- Validate file-index rows with shared Zod helpers; preserve structured lazy-directory
  entries so `@file` completion initializes directories before refreshing results.
- Turn-scoped diffs come only from the CLI-local evidence store, never current disk,
  All Changes, or the removed v1 capture. File/diff reads retain cross-render in-flight
  limits; active requests release slots only on settlement.

## File identity, caching, and errors

- `session-file-open-target.ts` alone owns path normalization. Canonical workspace-relative
  paths (tree, quick open, mobile browser, LSP) travel verbatim. Only Markdown hrefs
  are URL-decoded and stripped of `:<line>` / `#L<line>` suffixes, absolute host
  roots, and `.../worktrees/<uuid>/` prefixes.
  Line anchors travel as fields, not inside paths.
- Cache resolved opens under BOTH `response.path` (the save identity) and the requested
  path (viewer/change-check identity). After save, refresh EVERY `cacheKeys` alias.
  Preview reads are case-tolerant; `save-text` writes are case-exact.
- Before reason mapping in `session-file-error-state.tsx`, classify "outside the workspace"
  as a policy rejection, not filesystem "Access denied"; CLI keeps that exact phrase.
  Classify "owner session mismatch" as a startup race and advise "try again".
- When repairing skipped entries, distinguish directory read failures and account for
  `openFile` retaining index `readonly`; an openable result must not become uneditable.

## ACP dispatch

- Display every provider-supplied rate-limit window name with localized duration via
  `formatAgentRateLimitWindowLabel`, even when duration/utilization/reset match.
- Before creating top-level or child sessions, call `filterAcpSessionConfigOptionValues()`
  so cached values outside the current selector schema are neither dispatched nor persisted.

## Product settings compatibility

- Use `product-storage.ts` and `atom-with-product-storage.ts` for renamed settings.
  Read the exact legacy key only when the Molly key is absent; write Molly only.
  Explicit reset removes both keys. Never enumerate or import another app’s storage.
