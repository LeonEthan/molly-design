# Conversation surface: read receipts, Copy as Markdown, file paths, message list

`session-chat-interface.tsx` and the message-list renderer it drives.

Scope: `packages/components/src/components/sessions`. Binding rules and the
pointer to this page live in
[that directory's AGENTS.md](../../packages/components/src/components/sessions/AGENTS.md);
this page is the full text of the rules summarised there.

- `session-chat-interface.tsx` — conversation surface (draft variant:
  `draft-session-chat-interface.tsx`).
  **Read receipts are gated on VISIBILITY, not on being mounted.** Every child
  tab and side chat stays mounted behind the active one, so the mark-as-read
  effect takes an explicit `isVisible` prop (`../../lib/session-read-receipt.ts`)
  that `session-detail.tsx` derives per surface — top tabs `isActive`, side chats
  `isActive && isSidebarOpen` (a collapsed panel is only `invisible`). Dropping
  that prop silently marks every sub-session read the moment the parent opens.
  A manual Mark as unread moves `lastReadAt` behind the latest message while a
  surface may already be visible; that receipt gets no new opportunity until a
  new message arrives or the user leaves and reopens the surface.
  "Copy as Markdown" renders through `@molly/shared`
  `buildConversationMarkdown` (`packages/shared/src/conversation-markdown.ts`),
  NOT `buildReplayPromptFromHistory` — that one is the agent-facing replay
  prompt and its budget behaviour is load-bearing for CLI resume; keep the two
  separate. The copy targets ~20k estimated tokens AND 50k characters (both
  bounds, because CJK is ~1 token/char) and gets there by degrading tool
  output, terminal output, then thinking, oldest turns first.
  **Message text is never trimmed** — a conversation whose prose alone exceeds
  the budget returns `overBudget` instead of cutting it. Whatever was trimmed
  must reach the toast (`describeCopiedConversation`); silent truncation reads
  as "I copied everything".
  `SessionHeaderMenu` retains Copy Path through `session-workspace-path.ts`.
  The visible toolbar wires Current artwork to the existing canvas reveal callback.
  IDE launchers and native discovery are retired. File actions retain the OS default
  handler and file-manager reveal through the owning machine's resolved path.
  ACP selectors on existing sessions and child-tab drafts must go through
  `useSessionAcpSelectorContext()`. Session UI that reads ACP capabilities must
  use `useResolvedMachineMeta()` so machine Flock capability rows override
  legacy machine meta; never read `acpCapabilities` from the raw machine atom.
  The composer is controlled and must not recompute ACP selector options itself.
- **The message-list renderer is `../ai-gui/view.tsx`** (markdown/tool calls/terminal);
  most rendering changes land there, not here. `chat_failed` system notices render
  as compact left-aligned Coding Agent errors with no divider or persistent card;
  raw details live in a whole-row hover/focus tooltip, and the trigger uses a subtle
  error-tinted hover background. Keep the dedicated `SessionChatStream` story aligned
  with production. Its outer Virtua `VList` is vertical-only (`overflow-x-hidden`):
  wide markdown, tool output, and user content own their nested horizontal scrollers
  and must never make the whole conversation pane pan sideways.

The runtime uses `ConversationView` over the shared session-data reader. Opening imports
the document and builds its shallow directory; visible ranges acquire body leases.
The default retained tail is 20 turns, body cache 200. Design receipts and provider
identity remain observable outside the body window. Export/replay explicitly read the
authoritative history. See [reader invariants](../../packages/components/src/lib/conversation-view/AGENTS.md).

The existing background coordinator admits 20 automatic candidates, one at a time.
Error boundaries preserve diagnostics until explicit recovery. OS open/reveal accepts
absolute or parent paths only on the trusted local host; preview/attachment authorization
remains separate. Dispatch pause and unknown delivery are execution facts, not timers.
