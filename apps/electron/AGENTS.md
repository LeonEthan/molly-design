# Electron contributor guidelines

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.
Root `AGENTS.md` also applies. Main/preload/renderer module boundaries, IPC
contracts, and window/renderer integration rules live in
[`src/AGENTS.md`](src/AGENTS.md) and are read whenever `src/**` changes.

## Local OSS composition

- The public desktop composition is local-only. It must not discover deployment env
  files, initialize authenticated product-cloud behavior, or enable telemetry.
- The build-time `mainPlatformKind` is the source of truth for data directories,
  sockets, run/lock files, host leases, and workspace catalogs. Pass it explicitly;
  never infer it from an inherited `MOLLY_PLATFORM` value.
- The Vite toolchain mode is named `oss`, while the injected product platform remains
  `VITE_MOLLY_PLATFORM=local`. `electron.vite.config.ts` owns this mapping and must
  clear caller-provided `VITE_*` values before injecting audited local constants.
- Run desktop development from the repository root with `pnpm start:local`. It must
  rebuild the embedded CLI and local renderer before launching the bundled CLI; do
  not reuse production/cloud artifacts.
- Cloud desktop development must likewise build and sync the CLI before
  `electron-vite dev`; the direct `apps/cli/dist` lookup is only a missing-staging
  fallback and must not let an older `resources/cli` shadow a fresh build.
- The local Agent runtime and local Loro data plane are required product services.
  Start or attach to them on every desktop launch; do not add a control-only mode.
- `localPlatform.getSnapshot` atomically supplies the persistent `local:*` user and
  the single `lw_*` workspace from the CLI catalog. Do not split this into independent
  fallbacks. A missing catalog means provisioning; malformed identities or multiple
  active workspaces are errors.
- OSS local mode must not create a PostHog client, write an analytics install id, or
  upload source maps, even when unrelated analytics variables exist in the shell.
- Use `pnpm --dir apps/electron preview:local` only when a smoke/E2E harness has
  already prepared and validated the OSS build artifacts. That low-level command must
  remain `--skipBuild --mode oss`.

## Build toolchain

- Electron 39's Chromium supports native top-level await. Keep renderer and module
  worker builds on native TLA; do not add `vite-plugin-top-level-await` or an
  equivalent full-bundle AST compatibility rewrite. Reprocessing Rollup's complete
  output graph materially increases production renderer peak memory.

## Embedded CLI and native dependencies

- The embedded CLI launches built JavaScript only; there is no source-loader/Jiti
  fallback. Development and packaged builds must use the same output layout.
- `better-sqlite3`, `@lydell/node-pty`, and `loro-crdt` remain external and must be
  staged under `resources/cli/node_modules` by `scripts/sync-cli-dist.mjs` and
  `scripts/cli-native-deps.mjs`.
- Image decoding uses pinned `sharp` plus target-specific addon/libvips packages.
  Verify staged resources for every target and run the real decoder on native builds.
- `@lydell/node-pty` and `better-sqlite3 >= 13.0.2` use N-API artifacts. Stage the
  target platform/architecture artifact; do not rebuild by Electron ABI.
- Every embedded-CLI descendant launched through `process.execPath` must inherit
  `ELECTRON_RUN_AS_NODE` when it exists. On packaged macOS, omitting it launches a
  second GUI app instead of Node.
- Electron Builder ignores nested staged `node_modules`. `eb-after-pack.mjs` must copy
  them into `app.asar.unpacked`, verify the sealed Pi closure and absence of retired
  adapters/presets, then probe CLI `--help`, node-pty loading, and a real in-memory SQLite
  database before signing.
- Keep `better-sqlite3 >= 13.0.2`, CLI `engines.node >= 22.14.0`, the first-import
  guard in `sqlite-runtime-support.ts`, and its tests aligned. Older Node versions can
  segfault while loading the N-API 10 binding.
- When upgrading `@lydell/node-pty`, audit package layout and Windows ConPTY binding
  names. Apply the staged asar-path repair after downloading target artifacts; a pnpm
  patch cannot cover cross-architecture packages fetched during packaging.
- `electronLanguages` must include underscore names used by macOS resources and
  hyphenated names used by Chromium `.pak` files. The after-pack assertion for
  `locales/en-US.pak` is a release gate.

## Release packaging and auto-update

- Molly updates must use its independent release feed and trusted signing identity.
  Never enable an inherited Lody feed or bypass verification. Installation must wait
  for saved edits and idle Agent execution; unavailable prerequisites stay explicit.

- Always package through `scripts/package-electron.mjs` (`pnpm run package -- <args>`),
  never `electron-builder` directly. It injects the released version via
  `extraMetadata` so `package.json` is a fallback rather than the release source of
  truth, and it forces `--publish never` unless a caller opts in.
- Windows electron-updater still uses the `publish` block: Vite strips every
  `VITE_*` value, so `AppUpdaterService` falls back to packaged `app-update.yml` and
  `latest*.yml`. Tag contract is `v${version}`.
- macOS uses Sparkle (`electron-sparkle-updater`): `SUFeedURL` + `SUPublicEDKey` in
  Info.plist, `package-electron.mjs` rebuilds the native addon, afterPack injects
  `SPARKLE_ED_PUBLIC_KEY` before signing. The release workflow then runs
  `Innei/electron-sparkle-updater/action` pinned to a reviewed full commit SHA against
  this release's zips only
  (`publish: false`); the Action fetches the two previous `v*` zip releases as
  delta bases. Keep Apple signing credentials scoped to the packaging step and the
  Sparkle private key scoped to validation plus the pinned signing Action; never expose
  them as job-level environment variables. Previous zips stay out of the published asset list. Sparkle load
  failure falls back to electron-updater. Sparkle UI stays silent; progress and
  ready-to-install go through `ElectronUpdaterState` for the renderer banner.
- A downloaded package outlives a failed check or install. While
  `downloadedFile` is set, `recordError` keeps `phase: 'downloaded'`; dropping
  to `error` hides the sidebar banner and the About install button, which are
  the only ways to retry.
- Artifact names must stay space-free. GitHub Releases rewrites spaces to periods,
  which desynchronizes `latest*.yml` and Sparkle enclosures. Do not use
  `${productName}` in `artifactName`.
- macOS releases must be signed and notarized. `generate_appcast` refuses archives
  that fail `codesign --verify --deep --strict`, and Gatekeeper needs a notarized
  first-install DMG. Windows does not have this constraint.
- Official release CI packages macOS arm64 only. Intel macOS and Windows
  commands remain experimental local builds; widening release scope needs native
  acceptance evidence. Linux desktop packaging and integration are retired;
  Linux CI runners and platform-neutral resource probes remain.

## Verification

- Run the repository checks after source changes. Packaging/native-dependency changes
  also require the Electron packaging probes for every affected target architecture.
- Do not replace deterministic probes with launch sleeps or retry-only tests.
