# `@molly/components`: why the shared-UI rules read the way they do

Scope: `packages/components`. The binding rules live in
[that package's AGENTS.md](../../packages/components/AGENTS.md) and its child scopes;
this page keeps the reasoning that would otherwise crowd them out.

## Crash surfaces

Recovery and diagnostic contracts, including callers outside `lib/`, are owned by
[the helper rules](../../packages/components/src/lib/AGENTS.md#crash-recovery-and-diagnostics).

A crash the user cannot read or copy is a crash we never hear about, which is why the
`ErrorBoundary` fallback shows the real error text and offers a one-click copy of the
full report on every build rather than only in development.

Automatic recovery is deliberately bounded. A crash screen that reloads or resets by
itself can loop forever on a deterministic error, so `resetKeys` recovery stops after
`MAX_AUTOMATIC_RESETS` for a repeating error and hands control back to the user.

Both cache-recovery levels defer their asynchronous deletes to the next boot because
`deleteDatabase()` blocks while the runtime still holds a connection; synchronous
storage is cleared first so the boot flag is never written over a half-cleared state.
The localStorage sweep is an explicit DELETE list rather than a keep-allowlist so that
the failure mode of forgetting a key is a surviving cache entry, not a wiped user
preference.

The report carries the tail of `lib/session-render-trace.ts` because a React #185
(nested update limit) report names the fiber where the limit tripped, not the loop that
drove it. The trace is diagnostics only, and its surface mount/unmount lines are written
from a layout effect because passive effects may never flush inside a crashing cascade.

The local desktop crash screen offers retry, renderer reload, diagnostic copy
and the public issue tracker. The inherited broad `lody*` cache wipe and
sign-out reset are retired: deleting local-only data or another app's browser
state cannot be treated as a recoverable cloud cache clear.

## Session state after deletion

`atomFamily` retains its parameter-to-atom index after all consumers unmount.
The shared `docMetaSubscriptionAtom` retires the deleted Session's metadata,
relationships, presence and legacy Role-selection cache when the repo reports
explicit deletion. Local UI and daemon-observed deletion use the same boundary;
temporary missing metadata and archival are not deletion. A later authoritative
restore reads fresh metadata; retired Role choices are not rehydrated by the
product composer. Repo tombstones and artwork files are unaffected.
See the [retirement decision](../notes/implemented/bug-fix/2026-09-22-session-atom-retirement.zh.md).

The pinned `loro-repo` patch also releases cached field-row metadata after deletion
and avoids repopulating it during reads/listing. Flock retains metadata and deletion
history; restored documents rehydrate from it. Legacy whole-object rows retain their
previous snapshot because metadata events need it to report removed fields.

Router scroll restoration keeps TanStack's existing keys and positions. The pinned
router-core patch records their native `NavigationHistoryEntry.id` owners and retires
only owners absent from `navigation.entries()`, after rendering. The owner index is
persisted beside scroll positions for reloads. Custom restoration keys, unsupported
Navigation API hosts and unmapped pre-upgrade entries keep the original behavior.
The native `router:resources` probe covers browser eviction, traversal, replace,
branching and reload without creating model sessions. See the
[follow-up memory decision](../notes/implemented/bug-fix/2026-09-22-history-metadata-retirement.zh.md).

## File preview versus Code Collab

File routing, cache, and caller contracts live in
[the helper rules](../../packages/components/src/lib/AGENTS.md#file-preview-and-code-collab).
[File identity background](components-file-paths.md) explains path provenance,
cache aliases, and the existing inspection gaps.

Opening a file to look at it is not a collaboration session. File Preview v3 answers with
a plain read — no workspace watch, no All Changes recompute, no Flock publish — which is
why the file index is only a hint there: a path the index has never seen (an
agent-produced temporary file, say) is still worth sending to the machine, and "too large
to preview" is mostly a remote verdict rather than a fact about a file on this machine,
since the local IPC path reads to `FILE_PREVIEW_V3_LOCAL_LIMITS` derived from the 16 MiB
local response cap.

Preview reads a wider path set than `save-text` writes, which stay inside the session
workspace. Without forcing `external: true` results readonly the editor would show a Save
button for a file the machine will refuse, and the user would lose the edit at save time.

## Theming and fields

`--input` is the theme's raw `input.background` and doubles as a muted chip/composer
slab, so in a light theme it can sit below the page color and read as a disabled field.
`--input-field` is derived in `lib/vscode-theme/vscode-theme-css.ts` as the lighter of
the field and page colors, which keeps a dark theme's raised fill and lifts a light
theme's field onto the page. Keeping gray exclusively for `disabled:bg-muted` is what
makes disabled state legible at all.

The current chrome radius ladder is 8/10/12/16/24px for small controls,
controls, cards, menus and composers. The base and unlayered host rebinds in
`tailwind/index.css` agree; validate their computed values in Electron. UI operation/status
icons use the editable SVG catalog in `packages/shared/src/ui-icons/svg` and the
React facade in `src/ui/icons.tsx`. Exact `lucide-react` aliases cover inherited
imports in desktop, Storybook and tests. The isolated Bento dock, selection toolbar
and zoom controls render the same generated geometry with a 1.5 stroke;
artwork and provider assets keep their own styling. See the
[first visual-refresh slice](../notes/implemented/feature/2026-09-22-seede-ui-style-direction.zh.md).

Keyboard focus uses the shared inset fallback or a control's own `focus-visible`
ring. The former global `!important` reset of Tailwind ring variables erased the
explicit indicator on buttons, tabs and settings actions, so it has been removed.
Hover-only sidebar actions also reveal themselves on their own keyboard focus;
their overlapping status/tree glyphs yield the same slot while that focus is visible.

## Emoji picker dataset

`frimousse` fetches its dataset from a public CDN by default, which leaves the picker
spinning forever in an offline desktop or mobile app. The bundled dataset is a URL
contract rather than an import: the library builds `${emojibaseUrl}/${locale}/…` paths at
runtime, so a hashed `?url` asset cannot satisfy it and a host that forgets the Vite
plugin ships an empty picker. Anchoring on `document.baseURI` fails for the same class of
reason — the router uses browser history, so a deep route resolves the dataset path
against the route and the dev server answers with the SPA fallback HTML.

## Codex reset forecast

`SessionUsagePopover` is mounted per open tab and side chat, hidden ones included, and
`ProviderRow` per provider, so a mount-time fetch of the third-party forecast was a
request storm. Loading only when a user opens a surface, coalescing concurrent callers
onto one in-flight request, and clamping the served `Cache-Control: max-age` to 1m–5m
(the endpoint's CDN-shaped 4h is wrong for someone who just opened the panel) keep it to
roughly one 304 per interaction. An always-visible composer band was rejected because it
would have to load in the background to know whether to render at all.

## First design session and image settings

Desktop settings shares the softer surface and outline-icon treatment described in
the [Seede direction note](../notes/implemented/feature/2026-09-22-seede-ui-style-direction.zh.md).
Its local tabs use a 208px navigation column, a subtle selected-row tint and
24px section corners. `CompactSection` / `CompactRow` and the editors' `Section` /
`Field` own spacing and typography; normal rows keep content-sized controls and
readable helper text. The Agents tab has a visible page title. Model, image, MCP
forms retain their existing validation, persistence and capability rules.

Agents settings now mounts the encrypted `ModelConnectionSetting` independently of
machine management. `AgentEngineCatalog` explains model selection and lists only
names of this machine's legacy configs and pending setups as retired/read-only.
It neither deletes those records nor mounts their authentication, installation or
retry controls. Device monitoring remains in the separate Machines branch; its
historical provider section uses the same read-only inventory. Onboarding also
uses the model-connection form and explicit local Molly selection, with no legacy
CLI prefetch, installation or sign-in. Persisted setup tasks stay retired rather
than being promoted to runnable configs; an old first-task selection returns to
model setup. These entry changes are not completion of the
[embedded-harness migration](../../specs/molly-embedded-pi-harness.zh.md).

Agents settings also mounts `BundledCapabilitiesSetting`. Its read-only IPC uses the
same bundled CLI entry resolver as execution, then verifies fixed extension manifest
and license resources. The public result includes engine/build and extension versions;
neither renderer nor host imports the Pi SDK or acquires credentials for this read.
The UI distinguishes loading, unknown and included-with-activation-conditions. Inclusion
does not prove a live session negotiated question UI or that native acceptance passed.
The current question extension excludes terminal UI and grill-me; command mapping
remains open. Storybook covers narrow loading, unavailable and included states.

Role selection, management, migration and mention expansion are retired. Legacy
settings links resolve to Preferences, and the renderer writer rejects all Role
mutations while keeping historical rows readable. New MCP creates reject Role
arguments; accepted operations recover their frozen payloads. See the
[Role retirement decision](../notes/implemented/simplification/2026-09-23-retire-agent-roles.zh.md).

Local onboarding keeps its capability-selected steps and optional exploration exit.
Its first task exposes the published connection/model and model-specific thinking
choices, validates saved selections against the authoritative catalog, and freezes
the selection before navigation. Missing or stale choices permit exploration only;
they never select another model automatically.
The first-task screen uses the same canvas create/save and durable Session acceptance
as the landing composer. Before leaving onboarding it puts the prompt and reserved
canvas ID in the landing draft, sharing the existing submitting state across the
route transition. Failed creation restores an editable draft; successful acceptance
clears only the matching draft and leaves the accepted Session in history. Settings
remain the single home for model, MCP and machine image connection configuration.
The image form uses the shared endpoint validator, requires the user's model and keeps
stored keys out of rendered inputs. Image connection readiness affects generation and
editing tools, never existing artwork editing, saving or export. See the
[decision record](../notes/implemented/feature/2026-09-11-first-design-onboarding.md).
