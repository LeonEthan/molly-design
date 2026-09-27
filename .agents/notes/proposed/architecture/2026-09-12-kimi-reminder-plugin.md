# Prepared Kimi read reminder plugin

Status: proposed
Translation: pending

## Abstract

A small native Kimi plugin is prepared for review without installing it into user
configuration. Its public UserPromptSubmit hook emits Molly Design's shared read reminder
only when the existing design-launch marker is present. The exact managed runtime
received the reminder on initial and continuation prompts in an isolated synthetic
home, while ordinary sessions received none. The artifact was registered in the actual user's Kimi home on
2026-09-12 under explicit user approval; real-session reminder delivery remains
observable behavior on new Kimi processes, not a new acceptance claim.

## Scope and artifact

This follows the approved [reminder design](../simplification/2026-09-12-noninvasive-design-hooks.zh.md)
and the [scoped loading audit](2026-09-12-kimi-read-reminder-loading.md). Native
per-user plugin registration is a possible user-approved alternative to the
missing session overlay. No runtime patch, shadow home, authentication copying,
read/generation ledger, mandatory tool or new service is introduced. Independent
PPTD saves and final schema, replay, assets and versions remain separate.

The [preparation script](../../../../apps/cli/scripts/prepare-kimi-read-reminder.ts)
imports the existing shared reminder and writes exactly two files to a new,
explicit absolute output directory. It refuses an existing destination and does
not read or write Kimi settings. From the repository root:

```sh
apps/cli/node_modules/.bin/tsx apps/cli/scripts/prepare-kimi-read-reminder.ts /absolute/new/plugin-directory
```

`kimi.plugin.json` declares `molly-read-before-edit@0.1.0` with one
UserPromptSubmit command and a five-second native timeout. `reminder.mjs` prints
the shared literal only when `MOLLY_DESIGN_LAUNCH_ID` is nonempty after trimming.
Otherwise it emits no stdout. It reads no files, uses no network and makes no
mutation. The manifest records the preparing process's safely quoted absolute
Node executable, avoiding a PATH-selected interpreter. Kimi runs plugin hooks
with the plugin root as cwd, so the sibling script remains valid after the native
installer copies the directory. Regenerate/review the artifact if that Node
installation moves; this is not an automatic runtime-management mechanism.

Root's integrated Session code at `c683038` includes built-in Kimi in the existing
design-launch registration and sets `MOLLY_DESIGN_LAUNCH_ID` for that launch.
It clears the marker for ordinary launches. This was read directly from the
integrated source; this preparation commit adds no Session wiring. The marker is
an output selector, not authentication, read evidence or commit authority.

The review artifact for this run is `/tmp/folio-kimi-reminder-review-20260912/`.
Review artifact SHA256 values are
`9a81279c7bb7395d2f009b5985f1d060eab5635d005bbceed90c14696d68957d`
for the manifest and
`88033c6b909be6c80c33689dcb920cd70a8a373f13035f18d1c817fcf5f494fa`
for the script. The preparation source is committed; generated files and native
captures remain outside Git. No artifact was installed into the actual user's Kimi home.

## Public installation and exact registration location

The pinned source's [plugin documentation](https://github.com/LodyAI/acp-extension-kimi/blob/f255222661c9cc2842901858fd28e554d7796a51/docs/en/customization/plugins.md)
describes this native TUI command:

```text
/plugins install /absolute/reviewed/plugin-directory
```

It installs per-user, across projects. The public implementation copies the
reviewed files to `<KIMI_CODE_HOME>/plugins/managed/molly-read-before-edit` and
preserves the other plugin records while registering this one in
`<KIMI_CODE_HOME>/plugins/installed.json`. When no explicit Kimi home is set,
that root defaults to `~/.kimi-code`. Those are target locations, not permission
to modify them. A future approval should identify the actual active Kimi home,
the reviewed plugin bytes and this single registration; preserve existing
records/configuration. Existing processes must reload plugins or be restarted
through their ordinary lifecycle. This audit verified the ACP loader, not the
TUI install command in the managed package; do not claim that the
managed `acp` CLI offers a plugin-install flag.

For clarity, the version-1 registration record consumed by the loader has this
shape; the native manager also records `updatedAt` and `originalSource` when
installing. This is a reference, not an executed global configuration change:

```json
{
  "id": "molly-read-before-edit",
  "root": "/absolute/kimi-home/plugins/managed/molly-read-before-edit",
  "source": "local-path",
  "enabled": true,
  "installedAt": "<installation timestamp>"
}
```

The containing document is `{ "version": 1, "plugins": [...] }`; never replace
its existing array with only this record. Disable/remove via the native plugin
manager if the user later chooses to stop these reminders.

## Native verification and limits

The same checksummed `0.39.1-lody.f255222661c9` artifact documented in the earlier
audits loaded the generated native manifest from two separate synthetic homes.
Only those temporary `plugins/installed.json` files were seeded. Each process
used synthetic loopback model responses and telemetry-disabled test provider
settings. No Electron, paid provider, real-user configuration or runtime source
was changed.

| Launch | Initial model request | Explicit continuation |
| --- | --- | --- |
| Synthetic Molly Design marker present | Exact shared reminder present | Exact shared reminder present |
| Ordinary launch, marker absent | Reminder absent | Reminder absent |

All four ACP prompts ended naturally. The shared string was emitted by the
registered hook, not included in the test prompt or a static skill. This proves
native plugin loading, environment inheritance and context delivery, not semantic
obedience, universal read-before-write enforcement or final design acceptance.
The previous fail-open hook behavior remains native behavior. Missing/failed
reminders are not commit evidence failures under the revised contract.

Probe scripts/logs are `/tmp/folio-t19-audit/probe-plugin-design.mjs` and
`probe-plugin-ordinary.mjs` with adjacent `.log` files. The tests use existing
headless ACP and loopback-provider facilities; no live user transcripts are committed.
Those initial headless probes did not establish packaged launch, real-user
registration, process-restart resume, cancellation or Windows execution. The later
normal-package `folio-t28-kimi-current-IovONp` round establishes scoped plugin
loading, current-file reads, permissioned writes and formal commit; see the
[later installed evidence](2026-09-12-kimi-read-reminder-loading.md#later-installed-evidence-and-user-setup).
Personal registration was executed on 2026-09-12 under explicit user
approval; see the registration section below. It is not
a technical acceptance requirement to modify the user's global configuration;
the supported combination requires an explicitly registered plugin. The native
TUI installation command itself has not been verified.

## Repository verification

Full `corepack pnpm check` passed, including type checks, lint, tests and
platform/public boundaries. The preparation script additionally passed a direct
`tsgo --noEmit` check with Node types and bundler module resolution.
`corepack pnpm format`, `corepack pnpm run docs check` and `git diff --check`
passed. Child checks stripped inherited `ANTHROPIC_*` and `CLAUDE_CODE_USE_*`
values without reading or printing them. This note remains proposed and
translation pending; preparation is not installation approval.

## Real-user registration (2026-09-12)

The user approved and executed the personal registration described above.
`KIMI_CODE_HOME` was unset, so the active home was the default
`~/.kimi-code`. The review artifact at
`/tmp/folio-kimi-reminder-review-20260912/` still matched both recorded
SHA256 values before copying, and the manifest's pinned Node path existed.
The two files were copied to
`~/.kimi-code/plugins/managed/molly-read-before-edit/` and verified
byte-identical after copying (same two SHA256 values). No `plugins/`
directory existed beforehand, so registration created a new
`~/.kimi-code/plugins/installed.json` (mode 0600) containing exactly the
documented version-1 record with `installedAt`/`updatedAt`
`2026-09-12T15:19:53Z` and `originalSource` pointing at the review
directory; no existing records or other configuration were displaced.

The hook loads when a Kimi process loads its plugins: already-running
processes pick it up only after their ordinary restart/reload, and the
reminder still fires only in Molly Design design launches carrying
`MOLLY_DESIGN_LAUNCH_ID`. This registration used the documented record
shape directly; the native TUI install command remains unverified. It is a
configuration fact, not new evidence of reminder delivery in real sessions.
