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

Image settings reuse the shared image endpoint contract for field validation,
save, free discovery and protected run metadata. It permits HTTPS, loopback HTTP
and literal RFC1918 IPv4 HTTP for trusted local image services; the help tip explains
that HTTP sends keys and images without TLS. Public HTTP and named LAN HTTP fail
at the address field. Model, OAuth and MCP endpoint restrictions are unchanged.

## Settings explanations

General settings name concrete actions and keep privacy/data destinations beside
personal memory. Queue/guide choices use a full-width row that can wrap inside a
narrow panel. Notification status distinguishes system denial, an unrequested
permission, platform unavailability and Molly's own off switch.

Advanced settings keep plain-language capability descriptions visible and move
package/version/license/build metadata under Technical details. Website accounts,
the Browser menu and the Pinterest setup chip share `BrowserAccountImportDialog`.
It adapts existing Dialog, Select, Checkbox and Collapsible primitives: browser
and profile share one picker; the curated design/commerce website list starts
collapsed and fully selected. One Import action reads and writes without a preview
step. Source errors, pending authorization, cancellation and retained/skipped
counts remain in this dialog. `PublicBrowserSurface` hides under covering dialogs.
Cookie counts describe local data, not verified sign-in; with cookies present the
Pinterest chip says "Imported · open Pinterest to check" and stays unticked, and
clicking it reopens the same import dialog. Human takeover and MFA
remain available on ordinary pages; the dedicated sign-in dialog is retired.
A browser-file access denial returns the dialog to its ready state silently,
keeping the browser, profile and website selections for an explicit retry.

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
