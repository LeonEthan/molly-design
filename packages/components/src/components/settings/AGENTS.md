# Settings surfaces

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Parent `AGENTS.md` files also apply.

Settings owns model connections and the MCP catalog. Root
[AGENTS.md](../../../../../AGENTS.md) defines local Flock durability; later upload
is outside settings.

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

- Website accounts reuse `BrowserAccountImportDialog` and the shared catalog, collapsed
  and fully selected each opening. Opening discovers installed apps only; Import
  prepares the chosen browser. One profile continues; multiple need explicit selection
  in the same picker. No sign-in wizard or preview/confirm step. Send IDs only.
- Denial keeps choices: a confirmed file-access denial returns to ready silently —
  no error, settings link or auto-retry; other failures show their reason. Show real
  authorization, unavailable reasons, finishing writes, skip counts; passwords stay in
  system prompts, counts prove no sign-in. Clear covers all Molly website data. Keep
  takeover/MFA and native surface coverage.
- Compatible models declare bounded row metadata; explain protocol, capabilities and missing
  tools. Saving probes nothing, selects no model, estimates no price. Native presets use SDK
  catalogs. Discovery sends one `GET /models` to the typed/stored destination; filters non-chat
  rows, fills drafts from responses/packaged models.dev; saved declarations win. Reset discovery
  and discovered drafts on endpoint/key changes; reject late results. Manual rows cover unlistable
  services. Empty compatible keys mean no auth; omission retains keys. Changed destinations
  require explicit input.
- Bundled capability inventory describes shipped resources and conditional activation,
  not live-session enablement. Failed reads stay unknown; no default plugin claim,
  runtime launch, installation or capability toggle follows opening settings. It lists
  Pi and every `MOLLY_PI_PACKAGES` add-on in plain words with package, version, licence.
- Navigation speaks to designers: General, Appearance, AI models, Website accounts,
  Shortcuts, then Advanced and About. Advanced (`advanced-settings.tsx`) holds the
  background service and bundled capability inventory (System), MCP and Projects as
  sub-tabs; their tab ids and legacy paths still resolve. Each card leads with one
  plain sentence; required caveats move behind `InfoTip`, never out of the UI.
- Forms use brand tiles/shortcuts and SDK-checked `PROVIDER_PRESET_DEFAULT_BASE_URLS`
  and names; preserve input, show destinations. Sign-in binds ID/revision. Rows show custom
  endpoints. On/Off saves immediately; credential forms keep Save. Confirm deletion.
  OpenAI sign-out retains a disabled reconnectable row; refresh snapshots, block checks/enabling,
  report unconfirmed revocation. Delete forgets its registration.
- A key is checked for free once it settles (`connection-check.tsx`): a typed key only
  against the shown destination, a saved key only against its own provider and endpoint.
  Checks list models or validate the key, never send a model request or DashScope call,
  and report unsupported services as uncheckable. Native connections offer All or a chosen
  `models` list as a form section (More options keeps only the name); listed
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
- Image forms validate the shared image endpoint contract before enabling Save/check.
  Private IP HTTP is image-only; explain unencrypted transport. Invalid endpoints show
  field errors, not credential-storage failures.
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
