# Pinned Bento resources

P0 loads a synthetic single-canvas design through Molly's Electron File menu.
The CLI owns the current JSON at `<Molly data root>/chats/molly-p0/design.json`;
Electron owns a sandboxed, network-blocked Bento view and PNG/JPEG rendering.
This fixed sample is not a new Session or a general document import API. P1 adds editable Session canvases; Agent generation remains P2.

Run `corepack pnpm --dir packages/design-bento build`. Normal Electron development
and production builds invoke the same builder. Install the pinned Bento submodule
with `git submodule update --init packages/design-bento/bento` first. Node 22.14+
and npm are required; the upstream npm lockfile pins build dependencies.

`source-manifest.json` identifies the source commit, five ordered patches, and
copied files. `vendor/packages` contains only the contracts, kernel and editor
source closure required by those patches. The capability matrix is retained as
source evidence, not a claim that P0 validates every capability. Authoring/PPTD,
quality orchestration, revision persistence, Web/HTTP/SSE applications and Agent
Runtime Manager are not migrated. The source repository is
https://github.com/LeonEthan/agentic-listing-design at
`7fd3c0691876ec7428fe3f3ef1ef6c4c46cdef12`; the original source has no root license
file. Preserve its provenance rather than attributing that adapter code to Bento.

Bento is pinned to `813c71fff72491e6898f5e55a20da44a562be586` (MIT, see
`bento/LICENSE`). Its own `slides` and `kernel` sources are assembled with the
adapter closure. Font Awesome Free glyph attribution is in `FONTAWESOME-LICENSE`;
Space Mono's bundled fixture font is covered by `SPACE-MONO-LICENSE`.
Molly's omitted text font resolves to Inter in the assembled contract copy. The
isolated canvas embeds Fontsource Inter 5.2.8 WOFF2 faces (regular/bold, normal/italic,
with its original script ranges) and emits `INTER-LICENSE` (OFL). It cannot inherit
fonts from the React shell. The font CSS identity is recorded in `build.json`;
canonical omitted fields and pinned vendor files remain unchanged.
The same single adaptation (`fontFamily: "MiSans"` → `"Inter"`, with the pinned-source
assert) must be applied by every other bundle of the vendored contracts, or
CLI/skill-side font validation will disagree with the canvas about the
registration-optional default: `apps/cli/vite.config.ts` (molly-vendor-text-default
transform) and `packages/design-authoring/scripts/build.mjs` (skill helper bundle).
When adding another consumer, mirror one of these three rewrites instead of editing
the pinned vendor file.
The fixture image is synthetic RGBA data. All fonts, icons and images are offline.

The builder emits `apps/electron/resources/design/editor.html`, sample JSON,
licenses and `build.json` with source and output hashes. No sibling checkout or
absolute source path is needed. The renderer uses the locked Electron 39.5.1
Chromium and the same Bento stage projection for display and export. PNG captures
the isolated transparent stage at 800×600; JPEG composites white first. There is
no window-chrome screenshot or fallback renderer.

P0 does not accept arbitrary documents. Saved sample changes fail without replacing
existing bytes. Repeating an open after a lost child-process response reuses the
already persisted file. No notification or separate chat metadata write is needed
to reconstruct this sample. Future Session association must derive from its stable
workspace/relative path after durable save, without rolling back saved content.

## P1 manual designs

`apps/cli/src/design/store.ts` owns `<Molly data root>/chats/<sessionId>/design.json`.
The file atomically contains the canonical BentoDoc, referenced content-addressed
asset bytes, and Session association. Assets are embedded so a confirmed save has
no partially committed external asset table. The module is the single committer:
the Electron-owned CLI worker forwards UI requests over stdin, and the daemon calls
the same exported operations in-process after a turn (P2.3). Both paths verify
expected content hashes and semantic kernel commands, fsync replacement bytes, then
acknowledge. A lost reply can be retried; a different baseline is a conflict — the
daemon preserves the existing draft and returns `DESIGN_CONFLICT`, leaving the Agent
to re-read, compare and explicitly continue or resubmit. Two callers
still do not mean two writers: commits are coordinated by content only, so a caller
that loses the baseline race never sees its bytes land. Historical candidate files
remain readable as ordinary files, but no new candidate production or adoption flow exists.

`design-pending/` contains only unfinished Session associations. UI repair authors
those through the existing workspace writer, then acknowledges them to the CLI.
Acknowledged Sessions are not reconstructed by scanning design files, so ordinary
Session deletion keeps its existing meaning. No conversation or undo log is copied
when conflict edits become an independent design.

Each native view retains its editor while its canvas tab is open, including hidden
panels and Session route switches. A committed turn re-creates clean instances from
the store so an open view cannot keep showing, or later saving, a superseded document. Explicit close releases undo
history. Save failures
block leaving with retry/discard choices; an unexpected crash recovers the last
confirmed file. Export uses an isolated instance of the same saved Bento document,
with fixed resources, decoded images and loaded fonts before stage capture.

P1 bounds canvases to 4096 pixels per side and imports PNG/JPEG/GIF images up to
16 MiB and 16 megapixels. These are resource limits, not new output formats. The
semantic controls expose these limits. `src/product-session.ts`, `src/selection-toolbar.ts` and `src/image.ts`
are local overlays of the pinned adapters; the builder applies them after copying
vendor sources. The source manifest records relative kernel imports and stricter
TypeScript adaptations. Original upstream identity and licenses remain unchanged.

## Historical projection types

`vendor/packages/contracts/src/pptd-v3.ts` records Molly's earlier adaptation
of the pinned Bento v4 types. It remains pinned source evidence, not a live PPTD
import/export entry. The current `geon-canvas/1` single-file conversion and
projection capability mapping belong to `@molly/design-authoring`;
see its [README](../design-authoring/README.md).
The source manifest pins this additional file separately and records its origin.

## Serial canvas editing

The desktop controls generic `molly.setReadonly`, `molly.flush`, `molly.state`
and `molly.applyCommands`.
Bento does not observe Agent status: the bridge rejects semantic mutations while
readonly, and the product overlay commits buffered input before freezing, then
flushes accepted saves. An unfinished composition or save failure retains the draft.
Direct property edits and dock element creation arrive as zod-validated commands
through `molly.applyCommands`, each applied as one kernel batch (one undo step);
every element semantic lives in `@molly/shared/design-selection-commands`, keeping
this bridge element-naive.
The product API reports its existing font-backed `ready` state and emits
`molly:ready` at that boundary. Electron waits for both the complete generic API and
`state().ready` before an attach can complete; document load alone is insufficient.
Views start readonly until the desktop confirms execution state. The daemon's
existing visible-turn owner waits for all artwork instances and keeps them readonly
through provider completion and artifact processing; hiding a view changes no ownership.
If a panel is hidden during its first load, Electron retains the completed editor
without revealing it; reopening reuses that instance. Initial display and viewport
fitting both honor the host's current visibility intent.
Unexpected dirty content blocks reload rather than being discarded. The original
store CAS remains independent. See the [implementation note](../../.agents/notes/implemented/architecture/2026-09-11-canvas-serial-execution.zh.md), including the headless limitation.

The generic `molly.selection()` bridge exposes the existing stable selection IDs.
Electron captures those IDs, flushes, and pairs them with the saved canonical
revision before inserting a normal composer mention. Bento has no conversation or
reference lifecycle; source previews cannot supply element references.
Bento also reports a zod-validated typed selection summary (count, kinds, bounded
per-element current values and fonts) over the same bridge, which still feeds the shell's passive composer selection. The native toolbar consumes
that summary immediately and reads selected stage DOM bounds locally, so its position
and fixed pixel size follow zoom, scrolling, resizing and reprojection. Dragging,
readonly and fully offscreen selections hide it. Popups share the native view and
stay within its viewport; shell presentation supplies current translated labels
and light/dark appearance. No geometry or new document state crosses IPC.

The host-bound `/toolbar` endpoint validates commands before the existing kernel
bridge, and validates reference actions before sending a captured reference back
to the ordinary composer. An ephemeral selection epoch rejects delayed operations
after switching targets, including switching away and back. Retained views keep
selection, zoom and toolbar across shell remounts. The old shell pill/spacer is
retired. See the [implementation and visual evidence](../../.agents/notes/proposed/architecture/2026-09-17-free-canvas-multi-artboard-research.zh.md).

## Image and selection actions

The current-artwork toolbar inserts selected-element references and editable prompts
for image generation/editing, style adjustment and regeneration into the ordinary
conversation. Image actions accept only selected canonical image elements; each
selected image is an explicit target. The saved revision stays frozen until send,
so edits after choosing an action require selecting the current elements again.
These actions do not launch a separate job or replace an image. The Agent receives
readable assets from the existing image MCP, decides how to modify PPTD and uses
the ordinary version-checked final save.

Bento's element position and image insertion, crop, fit and replacement commands remain available without
an image connection. A failed image tool leaves the current document untouched and
does not automatically retry a paid call. Canonical saves retain their referenced
embedded assets; authoring media and historical content keep the bytes they need.
There is no asset library, gallery or additional cleanup pass.

The assembled `window.bento.viewport()` API returns screen scale and the visible
center in canvas coordinates; passing that value restores the camera within native
zoom/scroll bounds. `window.bento.fit()` reuses native fit and centering. Electron
fits new document instances and resized containers before publishing prepared pixels;
unchanged retained instances keep manual zoom across hide/show.
It does not persist document state or know about Agent execution or Git history.
