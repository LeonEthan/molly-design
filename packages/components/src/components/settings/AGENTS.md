# Settings surfaces

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Parent `AGENTS.md` files also apply.

Settings owns model connections and the workspace MCP catalog. The catalog's durability
rule — a local Flock write is durable, and the upload that follows is not a settings
concern — is in the root [AGENTS.md](../../../../../AGENTS.md).

MCP credential saves encrypt through main before persisting a public reference in the
catalog. A failed catalog write retains that saved reference for explicit retry; never
roll the vault back over a possible concurrent rotation. New values replace the complete
credential set. Clearing requires an explicit action; submission clears input fields and
a failed save requires re-entry, not an implicit no-auth retry. Legacy history may retain
plaintext. Saving does not attest authenticated execution. MCP tools use native schemas;
do not expose image-specific field mappings. "List tools" runs only on an explicit click
for the saved entry (edited endpoints or credentials, including staged removal, wait for
Save), shows server-declared hints as unverified, stores nothing, and never edits rules
except through the user's "add rule". Failures show their reason, never an empty list.
Preserve historical catalog fields when editing unrelated values.
## Layout and components

- Website accounts lead with signing in on the site's page inside Molly
  (`website-sign-in-dialog.tsx`, Molly's shared website profile); this reads no other
  browser, so it raises no Keychain or Files and Folders prompt. Every sign-in entry
  opens this dialog; main pauses active runs and holds all Agent page work until it
  closes. Name Google sign-in's alternatives. Import stays collapsed and lists browser
  profiles only after the person opens it, never on page load.
- Website-account import shows its pending authorization state and manual retry guidance;
  passwords belong only in the macOS system dialog. Use the shared site contract for
  supported imports; cookie counts do not attest website sign-in. Import offers every
  installed browser profile from `ACCOUNT_IMPORT_BROWSERS`, names unlistable browsers,
  and keeps the button visible with the reason when a build cannot import.
- Advanced compatible models use explicit bounded metadata on the connection row.
  Explain protocol/declared capabilities and missing tool support; saving is not a
  probe, model selection or price estimate. Native presets retain SDK catalogs.
  Discovery is an explicit button: one `GET /models` to the typed or stored destination,
  non-chat models filtered, drafts filled from the response and the packaged models.dev
  snapshot — the saved declaration wins; a manual row covers unlistable services.
- Bundled capability inventory describes shipped resources and conditional activation,
  not live-session enablement. Failed reads stay unknown; no default plugin claim,
  runtime launch, installation or capability toggle follows opening settings. It lists
  Pi and every `MOLLY_PI_PACKAGES` add-on in plain words with package, version, licence.
- Navigation speaks to designers: General, Appearance, AI models, Website accounts,
  Shortcuts, then Advanced and About. Advanced (`advanced-settings.tsx`) holds the
  background service and bundled capability inventory (System), MCP and Projects as
  sub-tabs; their tab ids and legacy paths still resolve. Each card leads with one
  plain sentence; required caveats move behind `InfoTip`, never out of the UI.
- The connection form picks a provider from brand tiles (or an empty-state shortcut)
  and prefills `PROVIDER_PRESET_DEFAULT_BASE_URLS` (checked against the pinned SDK in
  harness-pi) and a provider-named connection, never overwriting a typed endpoint or
  name; the destination stays visible. Rows show only non-default endpoints; a row's
  switch saves On/Off at once without the key. Switches save instantly; only key and
  credential forms keep an explicit Save. Deleting asks first.
- A key is checked for free once it settles (`connection-check.tsx`): a typed key only
  against the shown destination, a saved key only against its own provider and endpoint.
  Checks list models or validate the key, never send a model request or DashScope call,
  and report unsupported services as uncheckable. Native connections offer All or a chosen
  `models` list as a first-class form section (More options keeps only the name); listed
  IDs sort first and keep the not-listed tag, never select. Choose pre-checks the full
  packaged catalog, not the key-check listing, so a one-model key cannot shrink the
  picker. Rows summarize a subset as "N of M".
- AI models (`agents` tab) mounts the design setup strip (`design-readiness.tsx`), the
  local encrypted model-connection form, the image connection, and the read-only legacy
  inventory only when this machine has legacy rows. The strip derives each chip from what
  the sections below report and the Pinterest cookie count; it stores and tests nothing,
  ticks only saved model/image setups, never Pinterest, and leaves unread items empty. Preserve old config/setup rows without mounting login, installation,
  retry, refresh, editing or automatic migration. Device management retains monitoring
  independently.
- A settings row (`compact-layout.tsx`) is one grid: the label column takes the
  remaining space and the control column hugs its content. Never size either column
  from a viewport breakpoint — settings render in a panel far narrower than the window,
  and the panel clips its overflow, so a `md:`-width label column silently hides the
  control.
- Onboarding reuses `ModelConnectionSetting`; neither onboarding nor settings mounts
  `AgentConfigDialog`. Remaining legacy stories are not runtime support.
- Keep optional three.js/R3F usage behind the lazy usage-calendar module so lightweight
  and SSR consumers do not evaluate its renderer graph.
- Interface and terminal font choices exclude the known symbol families in
  `lib/local-fonts.ts`; persisted selections use the same filter. Font option names
  use the default interface font so they remain readable. Conversation font size picks
  from `CONVERSATION_FONT_SIZE_PRESETS`; an earlier custom size stays listed until
  replaced.
- The Codex reset forecast chip in the provider row must not fetch on mount and passes
  `nestedInDialog` to its dialog: [../codex-reset/AGENTS.md](../codex-reset/AGENTS.md).

## Retired Agent Roles

Role management and migration are retired, and their settings/composer UI cluster
is deleted. Preserve stored rows and historical provenance; the legacy settings
route/tab resolves to General. The writer rejects Role mutations; the
cross-surface contract is in `packages/shared/AGENTS.md`.

## Design product scope

Hosted account, workspace ownership, member and billing settings are retired. Settings
navigation starts at General (`preferences`), and legacy hosted tab requests resolve
there. The authenticated workspace route must not preload billing data or mount hosted
subscriptions. GitHub connection and automatic code-review configuration are retired;
existing worktree configuration remains until its independent consumer migration. Model
credentials use the encrypted connection form: an API key, or an OpenAI sign-in whose
tokens stay in the main vault and refresh before a run is granted one. Settings never
exposes legacy Agent CLI auth.

## Legacy workspace configuration

Worktree setup/cleanup scripts remain editable for existing Session and CLI
consumers. Repository status is queried only by mounted project settings, never
  preloaded by the settings root. IDE launcher settings and probes are retired.

Title defaults do not persist an inferred model. Existing title model overrides,
including values equal to the displayed current model, remain explicit on save.

Personal memory controls negotiate the daemon's `personalPreferences` capability. Edits
carry the viewed revision; stale failures require refresh, never implicit retry. A row
offers Save and Cancel only while it differs from the stored text. Explain local storage,
selected-model processing and conversation retention.
