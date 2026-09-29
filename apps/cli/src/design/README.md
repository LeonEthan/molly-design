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

The shared `buildDesignContinuationReference` prepares bounded historical reference
data for explicit cross-engine migration. It selects settled user/assistant text
with source turn IDs, never native identities, tool records, permissions, thoughts,
run options or executable mention spans. Local human file references are only
attachment candidates: source-namespace authorization and byte/hash validation
still belong to the existing attachment store. Unsupported references and context
limits produce omission counts; no files or source history are changed.
`session/design-continuation-service.ts` now durably prepares this reference in an
immutable target-Session receipt. The Molly startup path can bind its text to the
new engine's existing system context without native transcript replay. First-turn
attachment handoff now rechecks the receipt and source, then reuses ordinary local
file/vision/reference materialization. The renderer dialog and target publication
are wired through `session/design-continuation-prepare` (see the session README);
ordinary Agent switching is not a substitute for that migration flow.

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

Image publication resolves the trusted workspace root and refuses symlinked media
directories and nonregular targets. It stages a bounded byte snapshot and publishes
with an exclusive hard link; a concurrent different file is preserved, while identical
bytes are reused. Byte limits (16 MiB), positive decoded dimensions (at most 16,384 per
edge and 64 million pixels across decoded frames), and canonical base64 are checked before publication.
These are import safety limits, not canvas/provider defaults; no resizing or repair
occurs. The pinned Sharp decoder must complete its strict raw-pixel pipeline (15-second
processing timeout); metadata alone is insufficient. PNG/JPEG/GIF results, and PNG/JPEG/GIF/WebP
edit inputs including masks use the same decoder. GIF/WebP frames are decoded together;
mask dimensions match the first source even for WebP. Cancellation before publication
removes its temporary file when the directory identity is unchanged. A failure after
the paid request remains dispatched/unknown; asset-write idempotency is not permission
to repeat generation. Decoder acceptance does not establish visual quality; late-result recovery remains open.

All clients use the image MCP server's ordinary generate/edit path: validated bytes
are saved in the owning draft's `media/` directory and the result contains paths,
digest and dimensions. Pi reaches this server through unmodified `pi-mcp-adapter`.
There is no image-specific adapter mapping, private inline-byte request, import
callback, paid-operation journal or recovery tool. Existing files and historical
operation records remain untouched; ordinary file tools can inspect saved assets.
Design collection still independently validates assets and canonical CAS.

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

YAML validation and its local helpers, native preview and final collection reuse
`@molly/design-authoring` asset admission: at most 16 MiB per referenced asset and
the existing PNG/JPEG/GIF or TTF/OTF/WOFF/WOFF2 byte sniff. Known failures identify
the relative media path; oversize failures include actual and limit bytes.
The canonical store rechecks the same rule, MIME and digest. Byte admission does
not prove Chromium font loading or native visual review.

Live authoring display watches `design.yaml` and needed `media/` in the draft
directory. Legacy `.pptd` is not a preview source. Invalid or unstable
files keep the last valid preview and do not clear the current artwork.

Agent previews continue through `render-preview.ts` and the shared desktop render
host, at the canvas's actual dimensions. The returned PNG path is available to
ordinary image-reading tools; rendering alone does not prove model image input.
Turn collection writes verdicts/receipts only, with no thumbnail generation,
reference amendment, or dedicated readback. Legacy optional outcome fields and
existing image files remain stored; the current read view ignores retired fields.

Molly design sessions use the sealed embedded Pi SDK. The external `pi-acp`
launcher, temporary command shim and separate design/MCP extensions are retired
from source and both bundle layouts; staging rejects stale copies. User Pi
installations, configuration and history are untouched. The embedded worker uses
only its explicit host-owned resources, never `PI_ACP_PI_COMMAND` or PATH discovery.

`current-projection.ts` exports the self-contained canonical payload under the
store's existing mutation lock. Fsynced staging replaces the fixed directory;
temporary directories are publication recovery, not history. Canonical publication
and projection publication are separate filesystem operations. A projection failure
reports that the canvas revision was saved but current files are not ready; an exact
save retry or reopen repairs it. Verification checks file hashes, not just a marker.
No projection publication touches draft files or frozen turn manifests.

Embedded Pi uses a public `before_agent_start` reminder and its native tools. There
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

The host supplies the common reminder to the embedded resource loader; synthetic
SDK tests verify delivery to the model context on success, failure and cancellation.
The embedded adapter derives settlement from native events and its owned run receipt,
not the retired extension's `design/tool-hook` terminal messages. Optional exact
resubmission uses the existing Molly MCP tool and launch-bound host checks.
`sync-service.ts` retains exact submission facts and historical Pi settlement
handling; old proof events are rejected. Claude/Codex/Grok reminder sources and
native config overlays, Grok plugin reload and Kimi CLI timeout adaptation are
retired. Existing user CLI configuration and hook registrations are left untouched.
Historical implementation evidence remains in the
Pi note
and Claude note;
the replacement decision
describes current responsibilities.

Each actual design Agent spawn registers a fresh launch ID for explicit exact
resubmission. Speculative processes created
before durable design identity are recreated through the ordinary startup gate. The daemon binds requests to
the current client, source turn and canvas owner; delayed native or MCP producers
cannot update a replacement service. This is a lifecycle fence, not a sandbox.
The old Pi ACP adapter could report success after native provider failure; the
embedded adapter requires native settlement independently. Error, cancellation or missing settlement
preserves canonical, draft and diagnostics. Files, previews and an ACP success
response do not establish native success. Settlement uses a native execution ID,
not an assistant-generation read ledger.

An explicit Molly turn freezes its connection/model selection. A changed selection
retires the old worker and restores the product-owned native Pi history; product
transcript replay is not a fallback. Historical external configurations remain
readable but cannot execute; continuing an old design requires the explicit
[migration flow](../session/README.md). The canvas and retained files stay in place.
Earlier external Codex reminder behavior is recorded in the historical
implementation and native proof,
not enabled by the current package.

## Read-only source snapshots

The desktop resolves trusted Session source paths through `design/source-path`,
including not-yet-created entries. Active canvas and source turn identities bind the
single canvas display to current execution. `buildLivePreviewPayload` excludes draft
bytes unchanged from frozen turn input, then uses the existing bounded, reference-only
collector and intake. It observes valid intermediate states without claiming a complete
transaction. Preview requests never write canonical, baselines or turn state.

Visible consumers share native dependency watches and serial observation. New dependencies
are watched and re-observed before publication; invalid drafts retain the last good
surface. A valid frozen frame can finish while newer changes are coalesced for the next
render. Source/turn/consumer changes still reject late results. Closing the last consumer
releases watches and cached payloads. Reopening, reconnect and focus reconcile current
source. Formal collection and exports remain independent.

## Pi image and rendering tools

The adapter's public `requestTimeoutMs` setting is 210 seconds, covering the
image service's 180-second deadline and delivery. MCP cancellation and cleanup
belong to the stock adapter. The server propagates its request signal through
uploads/downloads and checks it before writing assets. A cancelled request can
still have reached the provider; Molly never automatically repeats a paid request.
Image configuration/model and render-host availability remain daemon gates.

## Design history

`history.ts` adds list/read/create/restore operations to the existing design worker.
Each artwork owns `<dataRoot>/chats/<artworkId>/history.git`; its Git objects and
managed ref are the only version history. Commits contain the complete document
and embedded assets, while current association metadata stays outside history.
Ordinary saves do not create history entries. Git uses Molly's local executable;
missing Git reports an error without falling back to another store.

History reads verify reachable identity and content. Selected base and action identity
persist in the current envelope, outside BentoDoc/YAML. Git commit metadata records
logical design origin; physical history remains a linear managed ref. Save binds the
new base with canonical CAS; unchanged content at the selected base is a no-op.
Selecting history directly edits from that version without mutating the saved version.
Restore protects unversioned current content in the same Git repository, then uses
the normal store save/CAS and current YAML projection publication. A failed protective write
cannot replace the current artwork; a canonical save followed by projection or
canvas-reload failure remains a saved state with a recovery error. User repositories,
branches, index, global configuration and remote operations are not involved.
See the decision and acceptance limits.
