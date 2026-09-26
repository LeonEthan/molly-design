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
- Image import requires the owning active Molly run, selected MCP identity,
  frozen image/catalog revision and single-use native approval. Resolve the draft from Session/frozen context;
  import intents are recovery identity, not publication or canvas-commit evidence.
- Local image recovery is read-only: verify owned receipts and original-turn files;
  preserve unavailable results and paid state. Never regenerate or commit on recovery.
- Flush human edits before execution and keep every instance read-only through
  artifact processing. Preparation must verify the saved current projection after
  flush, including recovery/re-dispatch; frozen input itself remains immutable.
- Element references carry artwork, revision and stable IDs. Validate references
  against actual canonical; reject stale targets without choosing replacements.
- Design Agent selection affects only the next explicit turn. Freeze provider ID,
  bind native session identity to its actual provider and retire callbacks under
  the existing turn guard. Never reuse native identity across ACP Agent providers.
  Within Molly, an explicit idle-time model/connection switch replaces the worker
  and retains the same product-owned Pi history; never replay product messages.

See [runtime and files](README.md), the
replacement decision,
and the YAML turn/projection entry.

Embedded Pi uses its host-approved reminder and frozen Molly MCP catalog; preserve
native settlement, approval, cancellation and owned-client cleanup in `harness-pi`.
Keep external Agent shims, hooks and native config overlays retired; preserve user
CLI installations, hook trust, configuration and history. Never implement image providers in the adapter.
Image MCP client deadlines must cover the existing image-service deadline plus delivery;
give SDK cancellation delivery its 30-second allowance before
owned call-client cleanup; a stalled delivery then yields to transport close. Server
cancellation must reach image upload/download and guard the final asset write while remaining
distinct from that deadline. Native CLI timeout settings are not embedded model settings.
Do not retry paid requests automatically.

Design history uses the artwork's independent local Git repository. Preserve exact
embedded content and protect unversioned current work before restore; then use the
ordinary canonical save/CAS and projection path. Never alter user Git state or add
parallel snapshot storage. Recheck canonical revision after acquiring the history
lock so queued operations cannot version a pre-restore snapshot. Selected base and
operation identity live in the canonical envelope, outside BentoDoc/YAML; Git commits
record logical design origin while the managed ref remains linear. Source display
may read frozen input provenance but never gains save authority. Freeze its referenced
source identity separately from the full artifact digest; unused new media cannot
make an inherited draft live. See [history](README.md#design-history).
