# Remove the daemon remote-upgrade machinery

Status: implemented
Translation: pending

## Abstract

The machine lifecycle wire protocol carried a `machine/upgrade` action whose
daemon handler wrote an intent file and exited with reserved code 43, upon which
the Supervisor watchdog ran `npm install lody@<version>` and respawned — a
self-upgrade that installs and executes a third-party npm package Molly does not
control. The renderer half was already unreachable (the token mint and version
lookup were stubs), but the daemon handler was live for any crafted local
control message. This change excises the full stack — wire schemas, RPC
client/server, renderer API and settings UI, daemon handler, supervisor handoff,
and exit code 43 — rather than capability-gating it. Restart (`machine/restart`,
exit code 42) is unchanged.

## Problem

An OSS local-only product has no release-verify endpoint and no organization
account, yet it shipped a remote code-install path pointed at the npm `lody`
package, which belongs to a third party. A capability gate (the earlier minimal
closure) left the daemon-side handler, the Supervisor respawn branch, and the
wire surface in place: dead weight at best, an executable foreign-code path at
worst. The machinery also spanned seven packages and two locale files, so every
lifecycle change paid its maintenance cost.

## Decision

Remove the upgrade action end to end in one change:

- **Wire protocol** (`packages/shared`): `MachineUpgradeRequest/Response`,
  `canRemoteUpgrade`, the `invalid_target`/`unsupported_install` dispositions,
  and the `unsupported_install` unsupported reason are deleted from the message
  types, Zod schemas, and the local session-control guards (`.ts` and `.cjs`
  twins together).
- **Machine RPC** (`packages/loro-streams-rpc`): the `machine/upgrade` control
  method, client `requestMachineUpgrade`, server `upgradeMachine` dependency,
  and `targetVersion` lifecycle context are removed; restart ACK delivery keeps
  its own tests.
- **Daemon** (`apps/cli`): `handleMachineUpgrade`, `prepareMachineUpgrade`, and
  the intent-file write are deleted; the Supervisor loses the exit-43 respawn
  branch and the npm-install handoff. Exit code 43 is retired with a comment
  forbidding reuse, so a future code cannot alias the removed meaning.
- **Renderer** (`packages/components`): the workspace-runtime upgrade registry,
  `machine-lifecycle-api.ts` version probes (npm registry fetch included), the
  settings update banner/menu item, and the seven `upgrade*` locale keys per
  language are removed. `mintMachineLifecycleRequestToken` remains as the
  explicit unavailable stub so no caller can distinguish "absent" from "broken".
- **Spec**: `specs/machine-lifecycle-ack.md` (already draft) now documents the
  restart-only contract and records why the npm path was removed.

## Alternatives considered

- **Capability-gate only** (the earlier state): keeps the daemon handler and
  Supervisor branch alive behind an unadvertised capability. Rejected — the
  handler is the dangerous half, and a gate does not reduce the wire surface.
- **Repoint the upgrade at a Molly-owned package**: no such package or verify
  endpoint exists for the OSS local profile, and building an update channel is a
  product decision beyond this cleanup. Desktop updates already flow through the
  release/download path, not in-app npm installs.

## Verification

- Targeted vitest: machine lifecycle ×3, daemon/registration ×13, local session
  control ×30, RPC ×105, machine settings panes ×6 — all pass; the deleted
  upgrade-specific suites (`machine-lifecycle-upgrade.test.ts`,
  `machine-lifecycle-api.test.ts`) are removed with the code.
- Typecheck passes for shared, cli, components, and loro-streams-rpc;
  `check:public-boundary` passes.
- Grep confirms no live reference to `machine/upgrade`, `canRemoteUpgrade`,
  `MachineUpgrade*`, or exit code 43 outside historical notes.

## Limits

- The wire-compat `lody/supervisor-shutdown` marker and the restart action keep
  their existing names per `specs/lody-upstream-adoption.md`.
- `agents.authentication.machineUpgradeRequired` locale copy stays: it is a
  generic hint in a legacy ACP panel, not part of the removed path.
- Old daemons that still speak `machine/upgrade` get a schema rejection from new
  renderers and vice versa; the protocol never negotiated this capability, so
  mixed-version behavior is fail-closed by construction.
