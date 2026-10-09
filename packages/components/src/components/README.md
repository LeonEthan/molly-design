# Product surfaces

Binding rules live in [AGENTS.md](AGENTS.md); this index explains ownership.
Child directories such as `sessions/` and `chat/` own their scoped rules.

## Sidebar and session rows

The sidebar spans `loro-sidebar.tsx`, `loro-app-sidebar.tsx`, `session-list.tsx`, and
`sidebar-*.tsx`. `sessions/session-list-rows.ts` resolves row relationships, while
`lib/session-opened-by-tree.ts` builds the presentation tree.
The desktop filter only reorganizes rows by Workspace or Updated; the archive and
sidebar always include permitted local Sessions, including older author IDs.

Desktop session rows use a 36px minimum height and 12px corners, with a 6%
foreground tint when selected and 4% on hover. The shared leading slot preserves
opener/child indentation and extends its tree lines to cover the roomier row.
The sidebar card keeps a light border; footer actions use circular 32px targets.

Exact opener navigation and root-row indentation use separate ids.
A child Tab may open an independent Session: the row sits under the root, but its
navigation must still return to the precise creating Tab.

## Entry points and layout

- Chat landing: `chat/chat-landing.tsx`.
- Desktop update prompt: `sidebar-update-banner.tsx` and
  `update-changelog-dialog.tsx`, driven by the pure selectors in
  `lib/electron-update-banner.ts`.
- Desktop safe areas: `web-workspace-layout.tsx` and
  `getWebWorkspaceLayoutRootClassName`. The composer owns its bottom edge; a
  global bottom inset would double-pad it.

## Shared image viewer

`shared/zoomable-image-viewer.tsx` keeps `PhotoSlider` as the gesture and navigation
owner. Its public toolbar/loading slots use the shared operation icons; scoped CSS
masks replace the built-in navigation paths from the same canonical SVG files.
The close button calls the slider's own close callback. Window-control insets,
hover surfaces, image sizing, keyboard navigation and copy/save remain unchanged.

## Connection settings

`settings/model-connection-setting.tsx` and `settings/image-connection-setting.tsx`
keep their existing save and check contracts. Model connection names and native
catalog filters are under More options; required compatible model fields stay
visible. The service destination is always visible, and changing it still requires
renewed key entry. Image protocol and API-path details use the existing help tips;
model suggestions never select a model automatically. The setup strip distinguishes
saved configuration from a passed key check and labels image and website setup as
optional. See the [Phase 3 record](../../../../.agents/notes/implemented/bug-fix/2026-10-05-connection-form-clarity.md).

## Settings explanations

General settings name concrete actions and keep privacy/data destinations beside
personal memory. Queue/guide choices use a full-width row that can wrap inside a
narrow panel. Notification status distinguishes system denial, an unrequested
permission, platform unavailability and Molly's own off switch.

Advanced settings keep plain-language capability descriptions visible and move
package/version/license/build metadata under Technical details. Website accounts
lead with `WebsiteSignInDialog` (also opened from the session Browser sidebar), which
reuses `PublicBrowserSurface` inside a dialog;
the surface hides only under dialogs opened after its own. Website accounts
keep import failures beside the source picker and name the failed browser profile;
unreadable other browsers are expandable when a usable source is selected. When
no source is usable, the diagnostic remains visible beside the disabled import
action. These disclosures reuse Radix Collapsible and never alter import or
execution support. See the [Phase 4 record](../../../../.agents/notes/implemented/bug-fix/2026-10-05-settings-explanations.md).

Shortcuts settings starts with a fixed canvas reference backed by Bento's existing
keyboard handlers, followed by editable application commands and desktop global
bindings. Canvas guidance states focus, text-editing and Agent read-only limits;
it neither registers nor overrides the editor's shortcuts.

Brand presentation reuses the outlined MollyWordmark: 36px high in navigation,
48px in About, with separate space from editorial headings. Prompt actions and
format labels use the interface font; dimensions and secondary labels use 12px
metadata. Static selection uses ink, reserving the signal colour for focus and
live/changed state. Compact settings rows use 13px labels and 12px vertical padding.
The AtelierInterface stories pair the shipped components with default Inter in
both themes and languages without changing a user's saved font preference.
