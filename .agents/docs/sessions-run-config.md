# Composer run config and model menus

The composer footer knobs (Provider/model / Interaction / Reasoning / Permission),
attachments, and the two durable run-config authorities.

Scope: `packages/components/src/components/sessions`. Binding rules and the
pointer to this page live in
[that directory's AGENTS.md](../../packages/components/src/components/sessions/AGENTS.md);
this page is the full text of the rules summarised there.

- `session-chat-input-area.tsx` — composer; `message-queue-display.tsx` — queued turns.
  Child-tab suggestions are shared by draft and persisted child sessions through
  `child-tab-empty-state.tsx`; it uses the same `px-3` + `ConversationColumn` as
  the composer, so its right edge and max width must stay aligned automatically.
  Desktop run knobs are TWO footer buttons from `desktop-run-config-menu.tsx`:
  `DesktopRunConfigMenu` (thin SVG, pill-shaped `[model icon] connection · model · reasoning ⌄`
  face; opens the connection/model list directly, with Reasoning and other
  supported select submenus + Plan/Fast toggle rows below) and
  `DesktopPermissionModeButton` (permission icon + full name; flat permission
  list). Explicit `_permission` config options take precedence over legacy ACP
  modes; provider interaction modes stay inside the run-config dropdown. Both
  are also used by the desktop chat landing; `DesktopRunConfigMenu` receives an
  explicit runtime metadata rather than reading `SessionMeta`. The single Molly
  harness has no Agent switcher. Connection and model identities come from the
  existing published catalog: display its labels and pass opaque option ids
  unchanged through the existing selection controller. Never reconstruct ids
  from display names or fetch a parallel catalog. The unselected sentinel is
  displayed as “Select model” on the button, never offered as a model. An empty
  catalog directs the user to add a model connection in Settings. Reasoning
  continues to use the controller’s model-specific capabilities.
  Builtin DeepSeek Harness sessions using a non-Pro model show the same linked
  delegation-cost warning here and in `MobileRunConfigSheet`: until upstream DSH
  fixes child-route inheritance, a delegated child may use the session's
  creation-time DeepSeek-V4-Pro seed rather than the parent's visible model.
  Keep the warning tied to that agent/model combination and its upstream
  discussion rather than turning it into a global banner.
  Model/Reasoning choices and Plan/Fast toggle rows keep the menu open so users
  can adjust several values; Escape or outside interaction dismisses it through
  the shared composer focus policy.
  Once the model list reaches `OPTION_SEARCH_MIN_OPTIONS`
  (`lib/fuzzy-option-filter.ts` — the same threshold and matcher the mobile
  sheet uses) the direct model list gains a fuzzy search row over
  `MenuOptionSearchList`: a provider may publish dozens of models, and scrolling
  is not a way to find one. A search field inside a Radix menu must be
  `DropdownMenuSearchInput`, which owns the fight with the menu's typeahead and
  roving focus (its jsdoc has the details); the same tasks-side Model submenu
  (`tasks/task-agent-run-config-menu.tsx`) is still an unsearchable clone and
  should adopt it.
  Roles are retired from landing, child drafts and existing sessions. The menu
  offers model/config controls only, and permission remains a separate button.
  Neither saved Role ids nor recently used Role records apply config, prefix the
  prompt or seed a new Session. New composer Turns explicitly record
  `agentRoleId: null`, preventing historical provenance from becoming a fallback.
  Historical Session fields and transcript spans remain readable without catalog
  subscriptions. The Session document readiness barrier remains mandatory even
  though the Role selection hook is gone.

  Effective values derive through `useAcpSessionConfigSelectionState` (user edit >
  runtime baseline > turn preference > capability default; a full runtime snapshot
  owns the non-user config table). Keep this a pure derivation rather than effect
  reconciliation; the latter previously caused the #185 session-open render loop.
  Child drafts inherit their parent's explicit config while clearing Role identity.
  The [retirement note](../notes/implemented/simplification/2026-09-23-retire-agent-roles.zh.md)
  records the changed scope and historical compatibility boundary.

  Run config has two durable authorities. A user Turn freezes what executes in
  its `inputConfig`; `resolveSessionConversationConfig` reads the latest accepted
  or queued Turn. ACP `config_option_update`/`current_mode_update` events update
  the separate shared `SessionDoc.acpRuntimeConfig` baseline, causally fenced by
  the driving `userTurnId`. A queued Turn and a newer accepted Turn always beat
  an older runtime event. Apply that shared baseline only to composer fields the
  local user has not edited; local unsent choices remain a private draft until
  send freezes them into a Turn. Never infer runtime config from a permission
  click or its history outcome: consent is not proof that the agent applied the
  change, and click-local state does not synchronize collaborators. Explicit
  execution actions (Implement Plan, Create PR, Commit & Push, conflict/CI/review
  fixes) are different: they create a new user Turn and must freeze a supported
  non-Plan mode into that Turn's `inputConfig`; they still must not mutate local
  composer state as a substitute for agent-confirmed runtime projection.
  `DesktopMachineMenu` is the matching elevated machine picker used by chat landing.
  Both render on the app-wide DropdownMenu surface (color-mix bg + layered
  float shadow). The old bottom bar row is gone: machine name + workdir badge moved to
  `SessionHeaderMenu` (`machineName` prop). Mobile keeps the single
  `MobileSessionRunConfig` button + sheet.
  Pending-attachment state machines: `pendingImages` (images) **and** `pendingFiles`
  (files; cloud upload via `@/lib/session-file-upload.ts` with sha256/textPreview,
  abort + part retry). Oversize images (>5 MiB) auto-degrade to files. Send blocks
  while either is uploading. Desktop same-machine uploads use
  `@/lib/electron-session-file-sender.ts` / `localProjects.sendSessionFileLocal`, return
  a `transport:'local'` block into the same `pendingFiles[].uploaded` slot, and fall
  back to cloud on handoff failure. The composer exposes one unfiltered hidden
  `<input type="file">` on every platform (Windows included — the renderer no
  longer crashes once locale `.pak`s ship; see `apps/electron/AGENTS.md`) and
  routes each selection by MIME into the image or file state machine.
