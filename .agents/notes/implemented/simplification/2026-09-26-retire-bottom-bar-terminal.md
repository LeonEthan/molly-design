# Retire the bottom-bar embedded terminal

Status: implemented
Translation: pending

## Abstract

The desktop app's bottom-bar Terminal dock was removed end-to-end per issue
#13: the UI panel and its commands/keybindings, the Electron main-process
relay and IPC surface, the CLI daemon's PTY server, and the shared wire
protocol. The removal also retires the two dependencies that existed only for
this feature — `@lydell/node-pty` in the CLI and `@xterm/*` in the renderer —
including their pnpm patches, native-binding staging in the Electron packaging
scripts, and the Appearance settings section for terminal fonts. Transcript
"terminal" concepts (agent tool-output blocks, ANSI theming) are unrelated and
stay. The main trade-off accepted: `molly-terminal-font-*` local storage keys
become harmless dead data on existing installs, and the `session.newTab`
command id replaces `session.newTabOrTerminal`, invalidating any user-rebound
shortcut for the old id.

## Problem

Issue #13 (正亮功能反馈): the embedded terminal panel is no longer wanted.
Keeping it costs maintenance across four layers — xterm integration and theme
plumbing in the renderer, a WebContents↔daemon relay in Electron main, a PTY
service with per-platform native binding staging in packaging, and a shared
zod protocol — plus the only consumers of two native-ish dependencies.

## Decision

Delete the feature bottom-up so the type checker reports each upper layer's
remaining references:

1. **`@molly/shared`**: `terminal-protocol.ts`, `node/local-terminal.{ts,cjs}`
   and the five `terminal.*` IPC send channels + one push channel removed;
   package `exports` entries dropped.
2. **`apps/cli`**: `local-terminal-server.ts` and `terminal-pty-service.ts`
   removed; `MollyFleet` loses its PTY wiring (startup, shutdown, per-session
   cleanup hooks, terminal workdir resolvers). `terminal-workdir-resolver.ts`
   stays because `SessionManager.resolveSessionWorkdir` (session fork) still
   uses it — only the fleet's terminal-specific wrappers were deleted. The
   `closeSessionTerminals` config hook disappears from `molly.ts` /
   `message-handler.ts` with it. `@lydell/node-pty` leaves `dependencies`,
   the vite externals list, and the published-bundle policy script.
3. **`apps/electron`**: `TerminalRelay` + `terminal-ipc` service removed from
   main, the preload invoke-policy drops the `terminal` group, and
   `scripts/cli-native-deps.mjs` loses ~200 lines of node-pty staging
   (per-platform binary packages, spawn-helper asar repair, afterPack smoke
   probe). The cross-arch `fetchNativePackage` helper stays — sharp staging
   still uses it.
4. **`@molly/components`**: the `components/terminal/` directory,
   `terminal-dock-host.tsx`, the dock's story and four test files removed.
   `session-detail.tsx` drops the toggle button and both commands;
   `session.newTabOrTerminal` becomes plain `session.newTab` (⌥N unchanged);
   `Ctrl+\`` / `⌘J` are gone with `session.toggleTerminal`.
   `DesktopSessionDetailLayout` loses its `terminalDock` slot. The onboarding
   tour drops its scripted terminal channel, the `terminal` track, and the
   anchor. Appearance settings lose the Terminal section, the
   `terminalFontFamily/Size` atoms, and the font-normalize helpers; the
   interface-font selector's reused i18n keys move from `settings.terminal.*`
   to `settings.fontFamily.*`.
5. **Dependencies**: `@xterm/xterm` + `@xterm/addon-fit` leave
   `packages/components`; pnpm patches `node-pty@1.1.0` and
   `@xterm/xterm@5.5.0` are deleted (the xterm patch's ScreenDprMonitor
   lifetime fix shipped upstream; the node-pty patch's spawn-helper asar fix
   dies with the only consumer). Attributions regenerated.
6. **e2e** (found by code review): `LODY-WORK-001` — a P0 journey whose whole
   premise was "delete a Session with Agent and Terminal resources" — is
   retired and replaced by `LODY-SESSION-002` (same flow minus the terminal:
   completed scripted session → archive → permanent delete, asserting the
   project directory survives). The xterm listener probe
   (`terminal-resources-probe.ts` + its `terminal:resources` script), the
   Windows PTY lifecycle probe (`probe-windows-pty.mjs` + its e2e-daily
   workflow step), and all terminal steps/page-object IPC calls are removed.
   Session Stop coverage stays untouched in `LODY-SESSION-001`.

## Kept (out of scope)

- `ai-gui/terminal-component.tsx`, `terminal-preview.ts`,
  `vscode-terminal-theme.ts`, `.font-terminal`, `terminalTextFontSizeStyle`:
  these render *agent conversation* terminal-output blocks, not the dock.
- `terminal-table.ts`: a CLI table renderer with a coincidental name.
- `terminalIcon` in the shared icon set: still used by the mentions menu and
  ai-gui tool-call headers.
- i18n keys about transcript terminal output
  (`copyConversationHistoryTrimTerminal`, `terminalOmitted`,
  `gitExecutableNotFoundAction`).

## Verification

- `pnpm check` (typecheck + lint + tests + i18n + boundary guards) passes:
  shared 1314 tests, cli 3051+ tests (terminal PTY tests deleted with the
  code), components 3185 tests, electron 4 tests. The session-cleanup suite
  formerly named `message-handler-terminal-cleanup.test.ts` was renamed to
  `message-handler-session-cleanup.test.ts` and keeps its 10
  non-terminal cases. `pnpm --filter @molly/e2e check` (suite contract +
  registry fingerprints + COVERAGE regeneration) passes.
- Two-axis code review (standards + spec) run on the diff; its findings —
  stale `apps/electron/AGENTS.md` node-pty invariants, the broken e2e xterm
  probe, stale hooks docs, a stale `context/terminal-output-lifecycle.md`
  pointer in `apps/cli/AGENTS.md`, and the `hooks/AGENTS.md` terminal-dock
  rule — are all fixed in this change. The empty `pinnedDependencies` Map in
  the published-bundle policy script is kept as generic policy (review's
  speculative-generality call noted and declined).
- Final grep for dock/panel/xterm/pty/relay/protocol references across
  `apps/{cli,electron}/src`, `packages/{components,shared}/src`,
  `locales/` and `e2e/` finds only unrelated transcript/ACP semantics.
- Not verified here: a packaged desktop build (`electron-builder` beforePack/
  afterPack paths were edited but not run), the e2e desktop journeys
  themselves (they need a built app), and the live app smoke (no terminal
  button in the header, no Terminal section in Appearance settings).
  Those belong to PR review on a real machine.
