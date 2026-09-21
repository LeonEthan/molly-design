# Pinned Bento resources

This package assembles the pinned Bento editor, Molly adapters and offline rendering
resources. Electron owns the isolated canvas and PNG/JPEG rendering; the embedded
local service owns persisted BentoDoc artwork. YAML conversion is owned by
[design-authoring](../design-authoring/README.md). Current save/version contracts
are described in [design persistence](../../apps/cli/src/design/README.md).

Run `corepack pnpm --dir packages/design-bento build`. Normal Electron development
and production builds invoke the same builder. The Bento source is vendored
in-tree under `bento/`; no submodule step is needed. Node 22.14+
and npm are required; the upstream npm lockfile pins build dependencies.

`source-manifest.json` identifies the source commit, the five Molly patches
recorded as applied in the vendored tree, and copied files. `vendor/packages` contains only the contracts, kernel and editor
source closure required by those patches. The capability matrix records source evidence; the current authoring validator
determines admitted fields. Authoring/PPTD,
quality orchestration, revision persistence, Web/HTTP/SSE applications and Agent
Runtime Manager are not migrated. The source repository
`agentic-listing-design` (private; not publicly distributed) is pinned at
`7fd3c0691876ec7428fe3f3ef1ef6c4c46cdef12`; the pinned original source has no root license file. Its rights holder LeonEthan
authorized the migrated, self-owned adapter code under Apache-2.0 on 2026-09-20;
see [NOTICE](../../NOTICE) and `adapterLicense` in the source manifest.
Bento and other third-party components retain their individual licenses.

Bento is vendored at `813c71fff72491e6898f5e55a20da44a562be586` (MIT, see
`bento/LICENSE`) with the recorded Molly patches already applied. Its own
`slides` and `kernel` sources are assembled with the adapter closure. Font Awesome Free glyph attribution is in `FONTAWESOME-LICENSE`;
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
the isolated transparent artwork stage; JPEG composites white first. There is
no window-chrome screenshot or fallback renderer.

## Historical projection types

`vendor/packages/contracts/src/pptd-v3.ts` records Molly's earlier adaptation
of the pinned Bento v4 types. It remains pinned source evidence, not a live PPTD
import/export entry. The current `molly-canvas/1` single-file conversion and
projection capability mapping belong to `@molly/design-authoring`;
see its [README](../design-authoring/README.md).
The source manifest pins this additional file separately and records its origin.

## Serial canvas editing

The desktop controls generic `molly.setReadonly`, `molly.flush`, `molly.state`
and `molly.applyCommands`.
Bento does not observe Agent status: the bridge rejects semantic mutations while
readonly, and the product overlay commits buffered input before freezing, then
flushes accepted saves. An unfinished composition or save failure retains the draft.
Readonly input capture also blocks double-click entry into text/table editing;
blocking later typing alone leaves a misleading editable preview.
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

## Build and upgrade

From a normal root install, run:

```sh
pnpm --dir packages/design-bento build
node packages/design-bento/scripts/verify-resources.mjs
```

Each build verifies vendored hashes, copies the vendored `bento/` tree to a
temporary directory, copies adapters and local overlays, applies the recorded
in-script adaptations, runs the pinned
`slides/package-lock.json` through `npm ci`, then builds one offline HTML resource.
Root pnpm and upstream npm are deliberately separate dependency closures. A cold
build requires registry access; the root install alone is not an offline-build
preparation. The temporary copy is removed after success or failure; npm's normal cache
can reuse downloaded packages without introducing another artifact store.

For an upgrade, change the source pin only after inspecting its upstream diff;
refresh the vendored `bento/` tree from the new commit, re-apply the recorded
Molly adaptations listed in the source manifest, then run resource verification,
authoring round-trip tests, the desktop build and native edit/save/export acceptance.
A hash match does not establish visual compatibility. Keep
Molly overlays under this package; the vendored tree carries only the recorded
adaptations. The existing builder remains the single assembly path.

Resources include Apache-2.0 `MOLLY-LICENSE` and `MOLLY-NOTICE` for Molly and the
rights-holder-owned migrated adapters, alongside Bento and font/icon notices.
