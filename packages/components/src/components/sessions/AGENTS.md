# components/sessions

Edit `AGENTS.md`; `CLAUDE.md` links here.

Files: [README.md](README.md). Scopes:
[components/](components/AGENTS.md), [message-queue/](message-queue/AGENTS.md).

## [Tabs and `?tab` routing](../../../../../.agents/docs/sessions-tabs-routing.md)

- Desktop chrome is ONE merged `SessionTabBar` row: traffic-light insets gated
  on `!useElectronFullscreen()`, pill/card geometry (y=8 line, `mt-0.5`,
  button centering) re-derived and MEASURED, never eyeballed.
- Keep the surface ladder canvas → inactive → active in both themes and MEASURE
  it; never give inactive tabs more chrome than the active one, and never use
  `--tab-active`/`--tab-inactive` (both collapse onto `--background` in dark).
- One leading status slot per tab, `waiting > working > unread > agent icon`;
  test `isWaiting` first, and never drop unread from a tab renderer.
- `?tab` is the single source of truth for the active tab: derive it from route
  search, navigate instead of setting state, never reintroduce mirrored state or
  URL↔state sync effects (#193), and never rewrite the URL from observed data.
- `Change owner` writes the OWNER `SessionMeta.userId`, never sharing/visibility;
  they stay separate actions.

## [Shell, side panel, side chats](../../../../../.agents/docs/sessions-side-panel.md)

- Desktop file/diff/browser surfaces are closeable right-panel tabs, never split
  conversations. `sidePanelTabs` owns strip order and each close's fallback neighbour.
- Human forks share the workspace; no Git probe/new-worktree menu. Keep recovery
  for previously accepted worktree forks.
- Keep one canvas, with Save version and direct history switching. Active Agent
  drafts replace its display only when valid; execution/processing owns readonly.
- A Side Chat is a durable child Session (`childSessionPlacement: 'side-panel'`):
  no top tab/sidebar row; rolls up into its parent. Mount lazily; only tab `X` deletes it.
- `SessionMeta.openedBySessionId` is presentation-only provenance: never
  `parentSessionId`, never rolled into the opener, never filtered out of the
  list. Navigation carries root + exact tab ids.
- The collapsed side panel stays mounted: anything polling or connected in it
  must take an on-screen prop and pause itself.
- Panel mount is not preview ownership — never release an endpoint or revoke a
  tunnel from component cleanup.

## [Browser and Managed Preview](../../../../../.agents/docs/sessions-browser.md)

- The engine split is the agent machine's own LOOPBACK (Managed Preview) vs.
  everything else, LAN included (public browser capability). Never fall back from
  a missing public engine to iframe, system browser, CLI, or gateway.
- INVARIANT: a managed preview is never a pivot; approval cannot make a LAN
  target safe. Agent-authored navigation (`fromPageContent`) never opens a
  private-LAN destination — only the address bar may.
- Static HTML runs `allow-scripts`-only from a policy-owned `srcdoc`; truncated
  documents are never executable and static frames die with their tab.
- Preview comment writes go through `runtime.writer.mutatePreviewVisualComments`, never the store's `setState`.

- Keep Stop reachable during permissions/questions. Gate paused Retry Stop/Continue
  on `sessionStopControl: 1`; unknown steer has no resend. Only execution/artifact
  completion releases canvas.

## [Conversation surface](../../../../../.agents/docs/sessions-surface.md)

- Read receipts are gated on VISIBILITY, not on being mounted: keep the
  per-surface `isVisible` prop.
- "Copy as Markdown" uses `buildConversationMarkdown`, never
  `buildReplayPromptFromHistory`; message text is never trimmed and what was
  trimmed must reach the toast.
- Read ACP capabilities via `useResolvedMachineMeta()` and selectors via
  `useSessionAcpSelectorContext()`; the controlled composer must not recompute
  selector options.
- Most rendering changes belong in `../ai-gui/view.tsx`; the conversation
  `VList` is vertical-only and wide content owns its own scroller.

## [Run config and Agent Roles](../../../../../.agents/docs/sessions-run-config.md)

- A Role never falls back: `machineId + agentConfigId` are exact. Keep unavailable
  Roles listed and disabled with reasons. Drafts authorize the whole Role;
  sessions apply only its run config.
- A Role owns all config. Other knobs are inert; pinned permission hides
  `DesktopPermissionModeButton`. Changing another knob unnames the Role without
  clearing values.
- Derive selection with `useAcpSessionConfigSelectionState`; never store or
  effect-reconcile it (#185).
- Idle design Agent switching uses the same-machine catalog without an Agent-type
  list; execution or an active Turn blocks it.
- Freeze `agentRoleId` + `agentRoleRevision` into the Turn `inputConfig` on send;
  `SessionMeta.agentRoleId` is creation provenance and is never rewritten.
- Two durable authorities: the latest accepted/queued Turn `inputConfig`, and
  `SessionDoc.acpRuntimeConfig` fenced by `userTurnId`. Apply that baseline only
  to unedited composer fields, never infer runtime config from a permission
  click, and freeze a non-Plan mode for explicit execution actions.
- `AgentRoleDetailPane` is the ONE pane that reads a Role and shows only what it
  pins; `AgentRoleEditorDialog` is the one editor.

## [Live status and dispatch](../../../../../.agents/docs/sessions-live-status.md)

- Live working/waiting UI uses presence, never `SessionMeta.status`,
  `lastRunningSeen`, or the CLI dispatch pointers.
- The only frontend-derived activity state is the dispatched-but-not-started
  window; anchor on the turn's durable timestamp and stop at 30s.
- Submission routing has one conservative exception: queue behind an unfinished
  transcript when presence is absent. That barrier never relights Working UI.

## [Composer info bar](../../../../../.agents/docs/sessions-info-bar.md)

- Canonical cluster in CONSTANT order + exactly one staged item; no items hides
  the bar (unless syncing) and the stage never empties or relayouts on click.
- The stage icon is inert, colour is reserved for genuine status, and nothing
  in the bar pulses or relayouts.
- The Open preview chip stays gated on a real reported preview target, and
  repository actions are priority-ordered and never duplicated below the reply.

## [Auto review, status slot](../../../../../.agents/docs/sessions-auto-review.md)

- PR panels and automatic code review are retired; never mount their polls or
  write legacy review settings. Preserve generic file/tool output and history.
- One priority-ordered status slot (browser-offline > machine-removed >
  machine-offline): states hand off, never stack; machine-offline never blocks
  sends; doc-stream degradation is never re-added.

## [Render cost](../../../../../.agents/docs/sessions-render-cost.md)

- Never subscribe page-level `activeSession` or message rows to Code Collab
  file-index Flock state or full `sessionMetaAtomFamily`; select what a row uses.
- Session-switch reset stays in the render-phase branch of `session-detail.tsx`;
  no second sessionId effect.
- Restored panels must not animate: bump `sidebarRestoreSeq` with every non-user
  `isSidebarOpen` write.
- "Current branch" copy uses `SessionMeta.branchName` only.

## [File surfaces](../../../../../.agents/docs/sessions-file-surfaces.md)

- File actions use `hooks/use-session-file-actions.ts` + `lib/session-file-actions.ts`;
  never expose host actions on an incapable surface. Explicit OS open/reveal accepts
  absolute/parent paths only on the trusted local machine. Preview/attachment/tool
  read authorization stays separate.
- Viewers are intentionally NOT code-split; never reintroduce
  `lazy(() => import())` for them. v2 semantics: `specs/code-collab-v2.md`.

## [Stories](../../../../../.agents/docs/sessions-stories.md)

- Stories mock data and render real components; appearance belongs in production.
  `SessionConversationPage.stories.tsx` hand-composes leaves and drifts — keep it
  minimal and verify UI changes in the real app.

Canvas previews, receipts and versions follow [README](README.md).
