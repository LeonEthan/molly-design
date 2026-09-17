# Product surfaces

Binding rules live in [AGENTS.md](AGENTS.md); this index explains ownership.
Child directories such as `sessions/` and `chat/` own their scoped rules.

## Sidebar and session rows

The sidebar spans `loro-sidebar.tsx`, `loro-app-sidebar.tsx`, `session-list.tsx`, and
`sidebar-*.tsx`. `sessions/session-list-rows.ts` resolves row relationships, while
`lib/session-opened-by-tree.ts` builds the presentation tree.
The desktop filter only reorganizes rows by Workspace or Updated; the archive and
sidebar always include permitted local Sessions, including older author IDs.

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
