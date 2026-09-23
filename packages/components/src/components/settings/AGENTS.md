# Settings surfaces

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Parent `AGENTS.md` files also apply.

Settings owns model connections and the workspace MCP catalog. The catalog's durability rule — a local Flock write is durable, and the
upload that follows it is not something a settings surface waits on, reports, or
rolls back — is in the root [AGENTS.md](../../../../../AGENTS.md).

MCP credential saves encrypt through main before persisting a public reference in
the catalog. A failed catalog write retains that saved reference for explicit retry;
never roll the vault back over a possible concurrent rotation. New values replace
the complete credential set. Clearing requires an explicit action; submission clears
input fields and a failed save requires re-entry, not an implicit no-auth retry.
Legacy history may retain plaintext. Saving does not attest authenticated execution.

## Layout and components

- Advanced compatible models use explicit bounded metadata on the connection row.
  Explain protocol/declared capabilities and missing tool support; saving is not a
  probe, model selection or price estimate. Native presets retain SDK catalogs.

- Bundled capability inventory describes shipped resources and conditional activation,
  not live-session enablement. Failed reads stay unknown; no default plugin claim,
  runtime launch, installation or capability toggle follows opening settings.

- Agents settings mounts the local encrypted model-connection form and a read-only
  legacy inventory. Preserve old config/setup rows without mounting provider login,
  installation, retry, refresh, editing or automatic config migration. Device
  management retains monitoring independently of this inventory.
- A settings row (`compact-layout.tsx`) is one grid: the label column takes the
  remaining space and the control column hugs its content. Never size either column
  from a viewport breakpoint — settings render in a panel far narrower than the window,
  and the panel clips its overflow, so a `md:`-width label column silently hides the
  control.
- Onboarding reuses `ModelConnectionSetting`; neither onboarding nor settings
  mounts `AgentConfigDialog`. Remaining legacy stories are not runtime support.
- Keep optional three.js/R3F usage behind the lazy usage-calendar module so lightweight
  and SSR consumers do not evaluate its renderer graph.
- Interface and terminal font choices exclude the known symbol families in
  `lib/local-fonts.ts`; persisted selections use the same filter. Font option names
  use the default interface font so they remain readable.
- The Codex reset forecast chip in the provider row must not fetch on mount and must
  pass `nestedInDialog` for its dialog: [../codex-reset/AGENTS.md](../codex-reset/AGENTS.md).

## Retired Agent Roles

Role management and migration are retired. Preserve stored rows and historical
provenance; the legacy settings route/tab resolves to Preferences. Do not mount
Role editors or catalog subscriptions. The writer rejects Role mutations; the
cross-surface contract is in `packages/shared/AGENTS.md`.

## Design product scope

Hosted account, workspace ownership, member and billing settings are retired. Settings
navigation starts at Preferences, and legacy hosted tab requests resolve there.
The authenticated workspace route must not preload billing data or mount hosted
subscriptions. GitHub connection and automatic code-review
configuration are also retired; existing worktree configuration remains until its
independent consumer migration. Model credentials use the encrypted connection form;
settings does not expose legacy Agent CLI authentication.

## Legacy workspace configuration

Worktree setup/cleanup scripts remain editable for existing Session and CLI
consumers. Repository status is queried only by mounted project settings, never
preloaded by the settings root. IDE launcher settings and probes are retired.

Title defaults do not persist an inferred model. Existing title model overrides,
including values equal to the displayed current model, remain explicit on save.
