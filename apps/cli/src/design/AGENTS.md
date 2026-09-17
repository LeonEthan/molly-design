# Design service invariants

Root and CLI instructions apply. `CLAUDE.md` links to this file.

- BentoDoc and embedded assets are the editable canonical truth. Create and save
  publish a current YAML artwork projection independently of Agent execution at
  `<dataRoot>/chats/<artworkId>/design-current`. Drafts and immutable turn inputs
  are separate and never overwritten by publication. Do not add projection history.
- Publish under the existing artwork mutation lock. Verify revision and exact file
  hashes before exposing current files. Canonical persistence and directory
  publication are separate: report partial publication explicitly, block dispatch,
  and recover through exact save retry or reopen. Never pass stale files as current.
- Healthy canonical reads retain lockless coherent payload behavior; only projection
  repair acquires the lock and re-reads latest canonical. Missing canonical reads
  must not create artwork directories.
- Write `.molly-current.json` and `.molly-managed-files.json`. Rebuild missing
  current projections from canonical; read `.folio-managed-files.json` only when
  the new ownership manifest is absent. Preserve user-modified skill files.
- New artwork workspaces use `.molly/artworks`; continue the exact legacy `.geon`
  workspace when present. Conflicting old/new directories fail without deleting drafts.
- Public read-before-edit reminders and native tool behavior belong to adapters.
  Do not restore generation/read-proof ledgers, intercept ordinary tools, patch
  runtimes or infer a shell/custom-tool sandbox. Reminders confer no commit authority.
- Final collection independently checks source, schema, kernel replay, assets and
  canonical CAS. Normal changes use frozen turn versions. Explicit resubmission
  must match the caller's expected revision and exact current draft digest; it
  cannot silently rebase older bytes. Unchanged inherited files alone are no output.
- Preserve real native error/cancellation and stale-producer handling. Pi's native
  settlement is required because ACP can lose provider errors; missing settlement
  fails explicitly. Bind events to actual execution, current launch/client,
  source turn and canvas owner, not model-generation read state.
- Conflicts preserve drafts and durable diagnostics for explicit continuation.
  Never produce candidates, restart the Agent or require a finalize tool. Retain
  historical candidate readback and the independent manual save-copy escape.
- Flush human edits before execution and keep every instance read-only through
  artifact processing. Preparation must verify the saved current projection after
  flush, including recovery/re-dispatch; frozen input itself remains immutable.
- Element references carry artwork, revision and stable IDs. Validate references
  against actual canonical; reject stale targets without choosing replacements.
- Design Agent selection affects only the next explicit turn. Freeze provider ID,
  bind native session identity to its actual provider and retire callbacks under
  the existing turn guard. Never resume across providers.

See [runtime and files](README.md), the
[replacement decision](../../../../.agents/notes/implemented/simplification/2026-09-12-editor-owned-pptd-save.md),
and the [YAML turn/projection entry](../../../../.agents/notes/implemented/architecture/2026-09-14-yaml-turn-projection.md).

Codex public UserPromptSubmit supplies context only. Preserve native user hook
declarations and trust; trust only Molly’s exact bundled command in the per-session
overlay. Never treat reminder delivery as read or commit evidence.

Pi image/render tools use the existing Molly MCP catalog and session context through
the public extension API. Never implement providers there or expose unlisted tools;
retain native tool policy, cancellation signals and session-scoped client cleanup.
Image MCP client deadlines must cover the existing image-service deadline plus delivery;
Pi render keeps its default. Give SDK cancellation delivery its 30-second allowance before
isolated Pi call-client cleanup; a stalled delivery then yields to transport close. Server
cancellation must reach image upload/download and guard the final asset write while remaining
distinct from that deadline. Kimi design
launches default the public global MCP timeout
only when environment and readable TOML omit it; never log config parse errors.
Do not retry paid requests automatically.

Design history uses the artwork's independent local Git repository. Preserve exact
embedded content and protect unversioned current work before restore; then use the
ordinary canonical save/CAS and projection path. Never alter user Git state or add
parallel snapshot storage. Recheck canonical revision after acquiring the history
lock so queued operations cannot version a pre-restore snapshot. See [history](README.md#design-history).

Grok reminders use only the app-owned session plugin and native hook reload. Preserve
user plugin trust; PreToolUse context arrives after the tool and establishes no read
or commit evidence. Missing/disabled Molly hooks must not be reported as loaded.
