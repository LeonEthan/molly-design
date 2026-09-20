# Settings surfaces

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Parent `AGENTS.md` files also apply.

Settings owns model connections and workspace catalog surfaces (MCP servers, Agent
Roles). The catalog's durability rule — a local Flock write is durable, and the
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

## Agent Roles

Roles are read and written from Settings, mentioned from the composer, and
resolved by CLI MCP creation, so these are cross-surface rules rather than
component details.

Explicit migration offers only the same machine's built-in Molly and requires an
explicit model. Clear old CLI model, reasoning and permission controls; preserve
the immutable source backup on later edits. Saving neither starts a Session nor
changes accepted Operations. Shared migration rules: `packages/shared/AGENTS.md`.
New and embedded Role edits offer only published Molly targets without launch
overrides, and validate the model/thinking against a current authoritative catalog.
Legacy Roles are view-only until explicit migration; do not save them through the
ordinary editor or infer a replacement model. Missing catalog/choices explain why
Save is unavailable.

- Agent Roles are one `agentRole` row family in the same workspace Flock document, not a
  private and a shared catalog: sharing is an ordinary update of `visibility` on the row.
  A Role stores no secret — no API key, MCP selection, or memory — and
  `isSensitiveAgentRoleConfigOptionKey` is applied on read as well as on write,
  because a workspace row reaches every member's client. It DOES pin the permission
  mode, as `runConfig.modeId` for legacy ACP modes or the agent's own `_permission`
  option: permission is a run-config value the agent publishes, not a secret, and a
  Role that left it out would not be the whole configuration it claims to be. So the
  composer drops its separate permission button while such a Role is selected. A Role
  may therefore pin a warning-tone mode (full access / skip permissions), which every
  surface that hides the permission control must keep visibly marked; what stays out
  of scope is a Role-level auto-approval POLICY. Settings and mention discovery use
  `canReadAgentRole`/`canManageAgentRole`; MCP creation resolves an explicit Role id from
  the workspace catalog without requiring a mention-scoped authorization record.
- A Role never falls back. `machineId + agentConfigId` bind the execution site exactly;
  when the machine, config, or a stored model/mode is unavailable the Role stays listed
  with the precise reason and stops being mentionable. MCP creation resolves the current
  workspace catalog row by `agentRoleId` before Operation acceptance; the canonical Prompt,
  target, Role revision, and dispatch config are frozen into the accepted Operation so a
  later edit or delete cannot change its recovery or retry. `SessionMeta.agentRoleId` /
  `agentRoleRevision` record where a Session came from and are display-only.

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
