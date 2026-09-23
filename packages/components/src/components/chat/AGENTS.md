# components/chat

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Index and rationale: [README.md](README.md).

## Composer and selectors

- `attachment-add-menu.tsx` owns the single composer "+" menu and per-turn MCP
  selection (`ChatComposer mcp` → `AttachmentAddMenuMcp`), never the footer row.
  MCP uses a desktop hover submenu or a touch panel on the same surface with a
  back row. Toggling keeps it open; an empty catalog hides the entry.
- Desktop project pickers use DropdownMenu with local/GitHub projects by recency.
  Pin no-project/add-local/connect-GitHub actions; mount at most 20 rows (most
  recent if empty, first matches from all options if searching). Scope order:
  machine → project. New local design sessions run directly in that directory;
  no branch discovery, worktree preference restore, or branch/worktree controls.
  Existing worktree Sessions keep their runtime semantics. GitHub projects
  are machine-independent. Machine changes filter local projects/configs and clear
  incompatible local projects without replacement.
- Desktop landing footer starts with canvas size beside the attachment entry;
  the remaining footer order is run config → permission → usage. Provider interaction mode
  belongs inside run config; the standalone button is explicit permission mode,
  falling back to legacy ACP modes. Usage reads the selected agent's Machine
  Flock subscription limits; hide it for custom or environment-overridden providers.
- Desktop "Recently used" (`lib/recent-run-configs.ts`) is device-local localStorage
  history per workspace, recorded only on chat START, never on setting changes.
  Rows offer the entire agent/model/config combination, filter by selected machine,
  and exclude the current combination. Apply the agent first; wait for
  `appliedTargetKey` in `use-acp-session-config-selection.ts` to name it before
  applying model/options.
- Every landing branch exposes ONE unfiltered hidden file input and one
  `onAttachmentAddClick`; selected files are split by MIME into the image and file
  draft hooks, exactly like paste and drop.

## Invariants

- Custom canvas dimensions enter both artwork creation and the durable first-turn
  text from one submission snapshot. Auto adds no fixed-size instruction; retries
  rebuild from the untouched draft. Keep automatic titles based on user-authored text.
  Presets use the same custom dimensions; custom popover edits apply only on confirmation.

- The chat-route URL declares selection, never one-shot event nonces. Once it names
  a selection, mirror composer steering through desktop `onSelectionUrlSync` using
  replace (incomplete selection → empty search). Plain `/chat` stays plain; restored
  defaults/auto-selection never rewrite it.
- `use-chat-landing-draft-session.ts` owns the landing's reserved session id, and
  canvas initialization, images, files, ACP preparation, and `startSession({ sessionId }, firstTurn)`
  MUST consume that same identity. Attachment hooks never reset it independently;
  reset only after a full draft clear. Submit blocks while `hasBlockingImages` or
  `hasBlockingFiles`.
- Store reserved session id and attachments in module-level atoms
  (`atoms/chat-landing-draft.ts`, `buildChatLandingDraftKey`) keyed by workspace SLUG,
  not initially unresolved id. Route unmount neither revokes previews nor aborts
  uploads; uploads settle into the atom. Revoke/abort only on removal/full draft
  clear. Local attachment failures stay visible and never fall back to cloud upload.
  No localStorage persistence; app restart may lose attachments.
- Submit immediately hides and disables the visible landing draft but preserves
  its controlled text, attachment resources, and reserved session id until
  `startSession` accepts. Failure must reveal the unchanged draft; only acceptance
  may clear resources or reset the reserved id. The accepted history entry is
  direct-authored into the renderer's own session store.
- Draft ACP preparation uses that same reserved id. It carries no prompt, env, or
  secret-shaped ACP option values; it may include the current sanitized
  mode/model/options. It is debounced/best-effort, replaced when routing or run
  config changes, cancelled on idle, and never awaited by submit. Once the initial
  user turn is locally accepted, submit MUST hand the lease to the durable session
  before clearing the draft or navigating; a successful handoff must not send
  `session/prepare-cancel`.
- `chat-landing-view.tsx` renders `ChatComposer`; stateful loading stays in
  `chat-landing.tsx`, session-mention drop handling in the view. Paint the page-level
  `ConversationDropOverlay` when sidebar drag starts, before `dragenter`.
- Apply `select-none` to composer dropdown/toggle chrome: top/footer selectors,
  bottom bar, ACP booleans, agent/model triggers, and option rows. Keep prompt, pasted-text editor, and picker search
  selectable/editable; they must not inherit broad `select-none`.
- Desktop composer/landing menu selections return focus to the prompt
  (`[data-keyboard-nav="composer"]`), never the trigger. Use `lib/menu-focus.ts`
  through `ui/dropdown-menu` and `OptionSelector`, including keep-open run-config
  selections (`event.preventDefault`).
- Desktop landing's machine/project menus always open upward with collision
  flipping disabled. Their top-row labels and glyphs, share the same neutral foreground level.
- The ACP provider cycle command uses the same single-machine scope as the visible
  provider menu. Never cycle all workspace configs while retaining the old machine id.
- Keep raw local Git, Machine RPC, and Streams failures out of landing status copy;
  retain them for submit blocking, telemetry, logging, and scoped retry. Status copy
  is for actionable validation and selected-machine project guidance.
- Chat Landing must not initiate ACP capability probes: startup refresh lives in
  the workspace runtime and explicit probes in settings/onboarding. Do not render
  their spinner, download progress, or ready state in the landing composer.
