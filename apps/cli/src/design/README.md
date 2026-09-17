# Design files in a Session workspace

`workspace.ts` is the shared resolved context for preparation, rendering, image
assets and collection. It takes the existing Session host cwd plus session/artwork
IDs; Agent cwd remains Molly's resolved cwd. New project drafts live at
`<cwd>/.molly/artworks/<artworkId>/<sessionId>/`. Ordinary chat workspaces retain
`<dataRoot>/chats/<sessionId>/`. Existing `.geon/artworks` drafts continue in place; if both old and new directories
exist, resolution fails without deleting either. No Git operation is needed.

Only the draft directory's `design.yaml` and `media/` are
collectible Agent output. A leftover `.pptd` is not this turn's artifact. The
saved current projection lives at
`<dataRoot>/chats/<artworkId>/design-current/`, next to canonical storage and
separate from every session draft. Create and save publish it without any Agent.
Healthy reads verify its revision marker and every exported file's bytes; reopen
repairs missing or replaced files from canonical under the artwork lock. Dispatch
checks readiness after flushing editors and never uses an older projection as current.
Preparation never seeds or overwrites a draft. Legacy workspace projections remain
untouched; current trusted resolution points to the canonical-adjacent directory.

The existing chat `design-input/<turnId>/` remains the immutable manifest,
reference-byte and receipt location. New manifests record `artifactWorkdir` and
artwork identity as dispatch facts. Every consumer compares them to paths derived
from the trusted live Session; manifest paths never authorize filesystem access.
Legacy manifests without the field retain their known chat-root interpretation.
Existing chat drafts are explicitly linked in the prompt and never relocated.

Switching the UI between sessions does not affect resolution. Reopening with the
same cwd recovers the same paths. Redirecting an old turn to another cwd is
rejected while preserving its files and manifest; automatic cross-directory
recovery is not provided. New turns can use the new workspace. Canonical canvas
storage and association recovery remain owned by `store.ts` and the existing
Electron design service.

MCP generation writes to this same draft's media directory. Image edits resolve
relative paths there and may read explicitly named attachments from the trusted
Session cwd. Render replies include the absolute preview path because their
output directory can differ from Agent cwd. Hooks reuse `resolveDesignContext`; file watching should use the same resolver
instead of constructing paths.

Historical design readback uses the same context with the persisted Session's
project/worktree metadata when no runtime Session is loaded. Read-only source and
file-preview requests may read archived designs; deleted Sessions stay unavailable
and other Code Collab operations keep their archive gate. A historical project turn
with missing/invalid frozen input or a changed root fails explicitly; it never
substitutes today's draft. Work files may have changed since the original turn.

Old `candidates/<digest>.json` files retain complete documents and embedded assets.
The design worker returns a checksum/identity-verified original path, and ordinary
file preview supplies its bytes. No candidate approval, deletion, export-copy or
history catalogue is needed. New candidate production is retired; final conflicts preserve the existing draft and receipt diagnostics.

Live authoring preview and idle explicit import watch `design.yaml`,
needed `media/` in the draft directory. Leftover
Legacy `.pptd` is not a preview or import source. Invalid or unstable
files keep the last valid preview and do not clear the current artwork.

Agent previews continue through `render-preview.ts` and the shared desktop render
host, at the canvas's actual dimensions. The returned PNG path is available to
ordinary image-reading tools; rendering alone does not prove model image input.
Turn collection writes verdicts/receipts only, with no thumbnail generation,
reference amendment, or dedicated readback. Legacy optional outcome fields and
existing image files remain stored; the current read view ignores retired fields.

Pi design sessions use the registry ACP adapter `pi-acp@0.0.33` and explicitly
loaded native Pi extension. The verified runtime is Pi `0.85.1`; other versions
return an actionable design-hook error. The launcher resolves the existing
`PI_ACP_PI_COMMAND` (or PATH), preserves user configuration, and uses a temporary
executable shim because this adapter does not forward extension arguments. It
never installs Pi globally or selects a product default Agent/model.

`current-projection.ts` exports the self-contained canonical payload under the
store's existing mutation lock. Fsynced staging replaces the fixed directory;
temporary directories are publication recovery, not history. Canonical publication
and projection publication are separate filesystem operations. A projection failure
reports that the canvas revision was saved but current files are not ready; an exact
save retry or reopen repairs it. Verification checks file hashes, not just a marker.
No projection publication touches draft files or frozen turn manifests.

Pi and Claude use public read-before-edit reminders and their native tools. There
are no Molly generation ledgers, successful-read coverage proofs or Write/Edit
interceptors. Shell and custom tools retain their actual native behavior. The
optional `molly_resubmit_draft` accepts explicit `expectedRevisionId` and
`artifactDigest`, checks both against the current canvas and exact draft, and
records only those facts. It neither commits nor ends a turn. Unchanged inherited
bytes without explicit submission remain `no_artifact`; ordinary changed output
uses the frozen turn version. No reread, mtime change or save automatically rebases
an old draft.

Natural completion independently validates structure, kernel replay, assets,
artifact source and canonical compare-and-swap. A matching explicit submission
may choose its checked revision; otherwise the immutable turn baseline applies.
Conflicts retain drafts and durable diagnostics. No candidate, automatic restart,
paid retry, semantic merge or mandatory finalize tool is introduced.

Claude Code's existing native `UserPromptSubmit` configuration appends the common
reminder while preserving user/project settings. Pi uses public `before_agent_start`.
`sync-service.ts` now owns only exact explicit submission facts and native Pi
settlement, transported through protocol version 2. Old proof events are rejected.
Historical implementation evidence remains in the
[Pi note](../../../../.agents/notes/implemented/architecture/2026-09-11-pi-design-hooks.md)
and [Claude note](../../../../.agents/notes/implemented/architecture/2026-09-11-claude-design-hooks.md);
the [replacement decision](../../../../.agents/notes/implemented/simplification/2026-09-12-editor-owned-pptd-save.md)
describes current responsibilities.

Each actual design Agent spawn registers a fresh launch ID. Pi, Claude, Codex,
Kimi and Grok use that same trusted identity for explicit exact resubmission; this
does not claim native hook support on every runtime. Speculative processes created
before durable design identity are recreated through the ordinary startup gate. The daemon binds requests to
the current client, source turn and canvas owner; delayed native or MCP producers
cannot update a replacement service. This is a lifecycle fence, not a sandbox.
Pi ACP can report success after native provider failure, so the native settled
status remains independently required. Error, cancellation or missing settlement
preserves canonical, draft and diagnostics. Files, previews and an ACP success
response do not establish native success. Settlement uses a native execution ID,
not an assistant-generation read ledger.

Idle desktop design sessions expose supported Pi/Claude choices in Molly’s existing
run configuration menu. Selection only records the next provider. The explicit
Turn freezes that provider ID; a changed/unavailable selection fails visibly.
The owned dispatch retires a mismatched live runtime, ignoring its retiring
callbacks, then uses existing restore/history replay. Persisted ACP identity is
paired with its actual provider in SessionMeta, so a cold reopen never resumes
another provider’s native session. The canvas association and retained files stay
in place, and ordinary conversations retain their existing Agent selection rules.

Codex design sessions load the bundled read-before-edit reminder through native
`UserPromptSubmit` hooks in the existing ACP `CODEX_CONFIG` session overlay.
The managed CLI `0.153.4` and ACP `1.10.0` deliver it before the model request,
including a fresh reminder after session resume. Existing hooks and trust remain;
only Molly's fixed command receives its own session-scoped native trust hash.

The rule requires current-file reads, complete reads before full replacement,
rereads after conflicts, and the latest current-design files when continuing. New
files are exempt from reading nonexistent targets. This is a reminder, not a read
ledger, synchronization trigger, tool denial, or commit authorization. Existing
native tool checks remain unchanged. Explicit native hook disabling is respected;
unsupported dotted `CODEX_CONFIG` hook overrides fail with a diagnostic instead of
being silently replaced. See the [implementation and native proof](../../../../.agents/notes/implemented/architecture/2026-09-12-codex-read-reminder.md).

## Read-only source snapshots

The desktop's source preview resolves the current trusted Session source through
`design/source-path` without a turn ID, including a not-yet-created entry; supplied turn IDs retain the historical
frozen-manifest checks. The design worker calls `buildPreviewPayload(workdir, {})`
for two bounded, reference-only collections followed by the existing intake.
Names and exact content, including same-path image changes, identify the snapshot.
This observes a stable input, not a completed author transaction; valid intermediate
drafts may render. No preview operation writes canonical, baselines or turn state.

Actual open preview consumers share an Electron-owned native watch and serialized
observation. The existing watcher runs in explicit tracked-only mode, with no
workspace discovery. Validated dependencies include missing files; new targets are
watched and re-observed before publication. Matching exact bytes skip conversion.
Closing the last consumer releases watching and cached payloads; reopening, reconnect,
manual refresh and observed turn finalization reconcile independently. Invalid drafts
retain the last valid surface; watcher errors retain manual refresh. Formal turn
collection and exports remain independent.

Element-reference prompt markers are validated during `turn-input.ts` materialization
and frozen-input recovery against the actual artwork revision and stable IDs.
A stale marker blocks dispatch without changing its identity or selecting a replacement.
The original prompt and ordinary attachments remain the frozen input.

Explicit desktop import is separate from observation: Electron retains the displayed
payload and submits it to the unchanged `designOperation` save after canvas flush.
The store repeats structural/assets validation and atomic version checks, including
same-content lost-reply idempotence. Import saves also refresh the application current projection; they never overwrite
Agent draft authoring files.

Missing canonical reads reject without creating a session directory. The Electron
owner drains accepted design-worker operations and awaits child exit on application
quit, after the existing cancellable editor flush. See the
[shutdown fix](../../../../.agents/notes/implemented/bug-fix/2026-09-12-design-worker-shutdown.md).

### Pi image and rendering tools

Pi generation/edit MCP calls allow 210 seconds to cover the existing 180-second image
service deadline and delivery. Pi render keeps its default; cancellation remains active
and paid calls are never retried automatically. Pi gives the SDK cancellation notification the
same 30-second MCP delivery allowance before closing the isolated call client; a stalled send
therefore cannot block Stop indefinitely. The MCP server propagates that native request signal
through edit uploads and returned-image downloads, combines it with the HTTP deadline, and checks
it before publishing the content-addressed asset. Builtin Kimi
design launches use the
public `KIMI_MCP_TOOL_TIMEOUT_MS` default only when neither the inherited/provider
environment nor the native `config.toml` sets it. `KIMI_CODE_HOME` and the child
HOME locate that file; unreadable or malformed configuration is left to Kimi.
This Kimi setting is a global MCP default for the design session, including other
tools without a per-server override; native per-server timeout settings still win.
The managed executable exposes no separate config-file CLI option in this launch. See the
[deadline correction](../../../../.agents/notes/implemented/bug-fix/2026-09-12-image-mcp-client-deadline.md)
and [server cancellation correction](../../../../.agents/notes/implemented/bug-fix/2026-09-12-image-mcp-request-cancellation.md).

The separate `pi-mcp-extension` uses Pi's public tool API and the existing Molly
MCP HTTP host. It exposes only listed `molly_generate_image`, `molly_edit_image`
and `molly_render_preview` tools, with the server's descriptions and schemas.
Before each generation it refreshes availability without re-enabling an explicitly
inactive tool. Execution uses the ordinary native extension tool policy and MCP
session context; the adapter does not answer permissions for the user or implement
image requests itself. MCP failures remain tool failures and cancellation signals
reach the SDK. Session shutdown closes the client.

The launch prefers the existing daemon HTTP endpoint. If startup has no endpoint,
it uses the existing bundled stdio MCP entry with the same owned Session context.
HTTP calls have independent SDK connections so aborting one closes its request
without interrupting another; the stdio client uses ordinary MCP cancellation. Image configuration/model and render-host availability remain the daemon's
gates. Installed Pi validation is pending; see the
[implementation record](../../../../.agents/notes/implemented/architecture/2026-09-12-pi-geon-mcp-extension.md).

## Design history

`history.ts` adds list/read/create/restore operations to the existing design worker.
Each artwork owns `<dataRoot>/chats/<artworkId>/history.git`; its Git objects and
managed ref are the only version history. Commits contain the complete document
and embedded assets, while current association metadata stays outside history.
Ordinary saves do not create history entries. Git uses Molly's local executable;
missing Git reports an error without falling back to another store.

Readonly history verifies reachable version identity and content before rendering.
Restore protects unversioned current content in the same Git repository, then uses
the normal store save/CAS and current YAML projection publication. A failed protective write
cannot replace the current artwork; a canonical save followed by projection or
canvas-reload failure remains a saved state with a recovery error. User repositories,
branches, index, global configuration and remote operations are not involved.
See the [decision and acceptance limits](../../../../.agents/notes/implemented/feature/2026-09-12-design-version-history.zh.md).
