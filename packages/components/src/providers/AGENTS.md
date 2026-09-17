# Workspace provider guidelines

`CLAUDE.md` is a symlink to this file. Parent `AGENTS.md` files also apply.

## Mirrors over synced docs tolerate unknown root keys

Every `new Mirror(...)` over a doc that syncs between clients must pass
`ignoreUnknownProperties: true`. Peers on a newer schema write root keys this
build does not declare; without the flag loro-mirror rejects the entire state
with `Unknown property: <key>`, so the older client can never write to that doc
again. Contract test: `packages/shared/tests/session-doc-forward-compat.test.ts`.

Session Mirrors temporarily use `validateUpdates: false` to avoid blocking writes
on incompatible old history. Keep external parsers; this is not malformed-input
safety. Removal requires a reviewed replacement write boundary (PR #460).

## Local Machine RPC

- Session controls, file previews and Machine monitoring use Electron IPC for the
  local Machine. An unresolved target returns an error; it never constructs a
  product-cloud RPC client.
- Release one-shot document handles and subscriptions that the workspace
  runtime does not already own.

## Workspace switching

- The `$workspaceName` route owns the render-time target slug. Workspace-scoped UI
  requires the route target, active runtime, and runtime-owned doc-meta snapshot to
  agree before reading singleton caches. A mismatch yields an empty local projection.

## Workspace runtime

- `create-workspace-runtime.ts` maintains one Repo view.
  `WorkspaceTargetRouter` checks historical session owner assertions and routes
  every room locally. Do not restore a second writer or a
  proxy-authoring/write-intent mirror.
- Every room uses the local transport. Session owner assertions remain checked
  for historical readback, but do not select a transport or authorize remote RPC.
- The local renderer identity comes atomically from the Electron local-platform snapshot
  and uses the CLI catalog's persistent `local:*` id. Do not substitute a constant or
  temporary user.
- Controls for a machine resolved as local use Electron local session control,
  independent of cloud-token or sync state. A failed local bridge is an error; never
  fall back to a remote RPC path.
- The local desktop waits for the first CLI startup setting snapshot before creating
  its workspace runtime. It mounts the local data plane only.
- Workspace-level rooms, including Task rooms and the Task Index, mount on the
  local transport even when metadata has no machine owner.
- Presence from the local daemon is authoritative, including absence. The local
  presence feed is considered synced when it produces its first snapshot.
- Doc-metadata bootstrap and the live repo watch overlap by design: merge per field with
  live winning (`mergeBootstrapMetaCache`), never letting the snapshot undo an archive
  already applied live.
