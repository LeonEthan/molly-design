# apps/electron/src

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Root `AGENTS.md` and `apps/electron/AGENTS.md` also apply. Build, packaging,
native-dependency, and OSS-composition rules stay in `apps/electron/AGENTS.md`.

## Module boundaries

- `src/main/index.ts` owns Electron lifecycle hooks, event wiring, IPC registration,
  and dependency injection. Keep business logic out of it.
- Put domain services in `src/main/services/*`, IPC handlers and input validation in
  `src/main/ipc/*`, and local-project worker/storage code in
  `src/main/local-project/*`.
- Main-process-only helpers belong in `src/main/utils.ts`. Put cross-runtime types and
  pure logic in `@molly/shared`; shared Electron IPC contracts live in the narrow
  `@molly/shared/electron-ipc` export.
- Electron main and preload code must not import runtime values from the
  `@molly/shared` root barrel. Use a narrow subpath so Node bundles do not pull in
  renderer modules or `loro-crdt` WASM.
- Invoke signatures come from the `IpcService` classes and the one constructor list in
  `register-services.ts`; every public instance method is renderer-facing and must have
  `@IpcMethod()`. Do not restore parallel handwritten invoke contracts or per-method
  preload lists. `packages/components` intentionally imports the inferred service type
  across the app/package boundary with `import type`; the import is erased and must never
  become a runtime dependency. Shared push/send maps remain in
  `@molly/shared/electron-ipc`. Preload exposes only `{ invoke, on, send }`, permits invoke
  channels by the service groups in `preload/ipc-invoke-policy.ts`, and keeps push/send
  allowlists. The IPC registration test keeps that policy aligned with the registered
  service constructors. There is no `window.api`. Validate foreign input at the IPC class
  boundary.
- Preload runs under the renderer CSP. Zod schemas used there must pass
  `{ jitless: true }`; do not add `unsafe-eval` to accommodate Zod's JIT path.

## Renderer and window integration

- A mounted full-screen `data-native-tab-surface` opts into native browser Tab traversal within that surface and from the unfocused document. Onboarding uses this explicit opt-in; general app chrome keeps its existing Tab suppression.
- Generic update metadata may carry localized Markdown under
  `vendor.mollyChangelog.locales.{en,zh_CN}` (legacy `lodyChangelog` read fallback) in addition to the standard English
  `releaseNotes` fallback. Main validates and bounds those remote strings before
  exposing them through `ElectronUpdaterState`; renderer code must use the shared
  safe Markdown renderer rather than raw HTML.
- React render failures are split by owner: the root `createRoot` error callbacks
  persist fatal IPC diagnostics, while `ErrorBoundary` owns caught-error UI.
  De-duplicate the same error across React and window events.
  Renderer-mounted notification must come from a committed layout-effect sentinel,
  never a timer or microtask guess.
- Theme changes must also update the native window color in `window-theme.ts`.
  OS appearance changes while `themeSource` is `system` must retint chrome and
  notify the renderer (`app.nativeTheme`). On macOS also subscribe
  to `AppleInterfaceThemeChangedNotification`; Chromium `matchMedia` and
  `nativeTheme.updated` often miss Control Center switches.
- Frameless window drag is per-panel, not a root overlay: each column's top
  header (or a same-height `WindowDragStrip` when there is no header) is
  `-webkit-app-region: drag`. Interactive descendants use `app-region-no-drag`.
  Dialog and alert-dialog overlays mount the strip themselves. Hide those
  regions in native fullscreen. Windows caption buttons stay an OS overlay
  (`MAIN_WINDOW_TITLE_BAR_OVERLAY_HEIGHT`); right-edge headers pad `pr-[144px]`
  so toolbar controls do not sit under them.
- The onboarding window must be native Light before its first renderer paint; normal product windows start from the System theme source.
  An automatic login launch may suppress the initial product window, but onboarding and deep-link launches must remain visible.
- The primary window pushes `app.windowForeground` from native show/hide, minimize/restore and focus/blur events, including its initial loaded state. Preload retains the latest boolean for late onboarding subscribers; Chromium document focus may remain stale on macOS minimize.
- `sessionControl.send` streams intermediate responses on `sessionControl.response`
  keyed by request id. The renderer subscribes before `invoke`, removes the
  listener after settlement, and treats only the final response as completion.
- The public browser retains hostname-based engine routing for manual browsing;
  `will-navigate` and `will-redirect` both enforce it. The Agent reader has a
  separate lease in `public-browser-agent-controller.ts`: bind one Session page
  and active run, check site/URL/DNS/proxy before requests, verify response peers
  before exposing DOM or screenshots, and revoke on takeover, cancellation or
  host loss. While leased, block human mouse/keyboard input at the WebContents
  event boundary; manual toolbar actions take over before navigating, and
  closing a leased page blocks that run from silently recreating it. The Agent
  receives finite operations, never arbitrary script/CDP,
  cookies, or a target id. Keep `will-download` denied. Selected image bytes use
  `public-browser-asset-fetch.ts` with a pinned public socket and per-redirect
  validation; do not turn page downloads into an asset path.
- A packaged, stably signed Molly shares a persistent browser partition across
  its Session pages; development and ad-hoc macOS builds use memory only. Cookie
  import requires a stable macOS signing identity, secure storage and an explicit source Chrome
  profile and site selection. Electron main uses the pinned native reader for only
  that site's cookies, keeps values out of renderer and Agent responses, and pauses
  Agent page access before writing. No extension or daemon import RPC participates.
  The packaged binary must verify the `EnableCookieEncryption` fuse before signing.
  Cookie writes alone do not prove website sign-in.
- Image preview export (`services/image-export-service.ts`) keeps the native
  menu, clipboard, and save dialog here because the renderer holds the only copy
  of the image (a `blob:` URL main cannot download). Bytes cross once, after the
  menu selection. Naming/filter logic stays in `image-export-core.ts` so it runs
  under `node --test` without the `electron` runtime.

## Local file resources

- CLI `file/resolve-local` owns session/path resolution; Electron owns file IO. Never
  put local file bytes back into the daemon's JSON response or expose filesystem
  paths in resource URLs. `local-file-resource.ts` issues opaque renderer-lifetime
  capabilities, bounded per renderer, revoked on navigation/destruction.
- Each resource read opens a regular file without following a substituted symlink
  and checks device/inode/size/mtime/ctime before and during reads. Replacement or
  modification invalidates the preview; no mixing revisions or writes through resources.
- Text above the editor budget uses fixed bounded Range requests. Binary uses raw
  streams with backpressure/cancellation; raster header dimensions bound decode cost.
  The scheme never bypasses CSP, executes file content, or authorizes a remote RPC.

## Design canvas

Before changing design views, save/preview IPC, renderer consumers or execution
flush integration, read the [design service contracts](main/services/AGENTS.md).
