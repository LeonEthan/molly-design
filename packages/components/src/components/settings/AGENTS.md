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

- Website accounts and onboarding share `BrowserAccountImportDialog`: explain access
  before listing; Open Settings attempts metadata access, then opens the fixed main-owned
  pane only on denial. Use the app name. Denial guides; focus/foreground
  and explicit recheck only list profiles, never import cookies. Distinguish empty catalogs.
  One profile shows its name; several require a pick. Keep cancellation/results.
- The shared website catalog starts collapsed and fully selected. Settings keep one line,
  Import, Clear and per-site counts. Clear covers all Molly website data; preserve
  takeover/MFA and native surface coverage. Keychain failures retain separate reasons.
- Compatible models declare bounded row metadata; explain protocol, capabilities and missing
  tools. Saving probes nothing, selects no model, estimates no price. Native presets use SDK
  catalogs. Discovery uses `GET /models` at the typed/stored destination (Gemini paginates); filters non-chat
  rows, fills drafts from responses/packaged models.dev; saved declarations win. Reset discovery
  and discovered drafts on endpoint/key changes; reject late results. Manual rows cover unlistable
  services. Only Responses/Gemini require keys. Omission retains keys. Changed destinations
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
- Forms share one grouped picker (plan sign-ins, API keys, Custom) and SDK-checked `PROVIDER_PRESET_DEFAULT_BASE_URLS`
  and names; preserve input, show destinations. Sign-in binds ID/revision. Rows show custom
  endpoints. On/Off saves immediately; credential forms keep Save. Confirm deletion.
  OpenAI sign-out retains a disabled reconnectable row; refresh snapshots, block checks/enabling,
  report unconfirmed revocation. Delete forgets its registration.
- Responses/Gemini checks are explicit, may cost, and require visible text.
  Other checks auto-settle and validate keys/list models for free, without
  model or DashScope requests. Typed keys target the shown
  destination; saved keys target their saved provider/endpoint. Native connections offer
  All or a chosen `models` list under Advanced with the endpoint and name; listed
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
- Image forms validate the endpoint contract before Save or check.
  A typed key follows its saved protocol and the address committed on blur.
  Private IP HTTP is image-only; explain unencrypted transport. Invalid endpoints show
  field errors, not storage failures.
- A settings row (`compact-layout.tsx`) is one grid: the label column takes the
  remaining space and the control column hugs its content. Never size either column
  from a viewport breakpoint — settings render in a panel far narrower than the window,
  and the panel clips its overflow, so a `md:`-width label column silently hides the
  control.
- Onboarding reuses the model, image and browser-import forms as `panel` variants;
  neither onboarding nor settings mounts
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
