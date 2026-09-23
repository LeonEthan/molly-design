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

[Sidebar relationship rationale](../../../../.agents/docs/components-sidebar-session-tree.md)
explains why exact opener navigation and root-row indentation use separate ids.
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
