# Molly Electron

Molly desktop application built with Electron, React, and TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

Follow the root [contributor setup](../../CONTRIBUTING.md#get-the-code); install
from the repository root, including its three required source submodules.

The desktop postinstall prepares the pinned Electron binary with Electron's own
installer before rebuilding native dependencies. Electron 42 and later no longer
download the binary during dependency installation; source-based E2E launches
need it prepared before running scenarios. `MOLLY_SKIP_ELECTRON_POSTINSTALL=1`
skips desktop preparation. If install scripts were skipped, run
`pnpm --dir apps/electron exec install-electron` before launching the E2E harness.

### Open-source desktop development

From the repository root, build the embedded CLI and OSS renderer, then launch
Electron with the bundled CLI:

```bash
pnpm start:local
```

This is the normal OSS development entrypoint. Fully quit an existing Molly
desktop process before running it because Electron enforces a single running
instance.

The Molly local host lease uses `127.0.0.1:17792`, separate from Lody Nightly's
desktop listener on `17790`. On macOS, the daemon probe, control and Loro data plane
still use the installation profile's sockets under `~/.molly/run` (or
`MOLLY_DATA_DIR/run`). The host lease must be acquired before the daemon starts;
an occupied endpoint without a matching lease record leaves Molly reconnecting.
After updating a checkout that used `17790`, fully quit the old Molly instance
and run `pnpm start:local` again. For a detached daemon from the older build,
the updated embedded CLI's explicit `daemon stop`/`daemon restart` retains
authenticated control of its legacy endpoint; see [CLI upgrade behavior](../cli/README.md#host-port-upgrades).
Lody can remain running. See the
[coexistence fix](../../.agents/notes/implemented/bug-fix/2026-10-02-local-host-port-coexistence.zh.md)
for the regression and verification limits.

`pnpm --dir apps/electron preview:local` is a lower-level smoke/e2e command for
an OSS build that has already been prepared. It deliberately skips rebuilding
and should not be used as the normal development command.

### Build

Run these commands from `apps/electron`. They use the local renderer and embedded
service. Packaging defaults to no publication; explicitly supplied signing
credentials determine signed/notarized versus ad-hoc output. Official release CI
targets macOS arm64 only; Intel macOS and Windows remain experimental.
Linux desktop packaging, updates and desktop-file integration are retired. Ubuntu
CI runners and cross-platform Bento resource checks remain infrastructure checks.

```bash
# For Windows
$ pnpm build:win

# For macOS
$ pnpm build:mac
```

Packaging excludes previous `dist` outputs and `.sparkle-local` update fixtures,
including when a custom output directory is selected. Generated `resources/cli`
bytes are excluded from formatting: the embedded engine manifest seals their
hashes. Rebuild and sync these resources instead of editing them in place.

### Molly P0 design sample

The File menu opens the fixed Molly sample and exports PNG/JPEG. Both development
and packaged builds include the pinned Bento resources; no adjacent checkout is
needed. See [Bento resources](../../packages/design-bento/README.md) for the source
closure and current scope. Molly local state uses `~/.molly`, independently of Lody.

Run the built app with `--molly-p0-verify=<output-directory>` to verify the
bundled font/image sample. `--molly-p1-verify=<output-directory>` exercises the
editor controls, save/reopen, conflict protection and exact 913×617 PNG/JPEG
exports, and checks that local updates remain disabled even with the legacy
force-enable flag. These opt-in probes use synthetic designs and no model calls.

Canvas disposal retires per-surface callbacks and closes owned contents. Electron
partitions live for the process lifetime, so clean partitions are reused through
exclusive leases with fresh origins, after native destruction and request drainage.
Cleanup failure quarantines the partition; simultaneous editors/previews/exports
never share a lease. Hidden editors retain their original contents and lease.
Each lease clears its document protocol callback during disposal, so a native
callback retained after unregistering cannot keep the editor or artwork alive.
The focused regression is `pnpm --filter @molly/e2e canvas:resources`.
Source-preview cleanup reuses that lease disposal after native contents have
disappeared. Repeated hide/close during cancellation is covered by
`design-source-preview.test.mjs` and the built-in P1 native probe; see the
[Issue #111 fix and verification](../../.agents/notes/implemented/bug-fix/2026-10-09-source-preview-disposal.zh.md).
Remaining process-memory trends need allocation and lifetime evidence: Chromium
also retains bounded storage caches and delayed frame resources; a post-GC
private-memory increase alone does not establish another canvas leak.

Canvas attachments share the pending document and product-API readiness promise,
including attachments arriving after the native view record is published.
Overlapping viewport fits follow the newest dimensions and release obsolete
layout waiters. Current attachment success clears only its own UI error; save
and synchronization errors remain independent. See the
[attachment regression](../../.agents/notes/implemented/bug-fix/2026-09-28-canvas-attachment-readiness.md).

For installed-package verification, copy the application from its DMG into a
private test location. Set both `MOLLY_DATA_DIR` and
`MOLLY_ELECTRON_USER_DATA_DIR` to separate private test directories and launch the
executable with `--user-data-dir=<the same Electron test directory>`. The native
Electron switch takes precedence; otherwise the explicit environment override
applies before storage initialization. Without either, Molly retains the existing
`Molly Design` userData directory despite its shorter display name. P1
asserts the effective profile before creating designs. Never point these probes
at existing user data or replace an application in `/Applications`.

The after-pack hook runs the existing Bento hash/license probe against collected
package bytes on every target, in addition to native dependency gates. It can
also be run directly with
`node packages/design-bento/scripts/verify-resources.mjs <packaged-design-directory>`
from the repository root. Cross-host packaging verifies resource presence and
hashes; it does not establish that Windows native executables run. Local
packages do not enable the inherited Lody updater, including with
`MOLLY_ELECTRON_ENABLE_UPDATER=1`. Packaging is not signing, notarization or release
publication.

The agent-browser + WebMCP implementation follows the
[draft browser Spec](../../specs/agent-browser-webmcp.zh.md).
This migration has build/static evidence only; prior Playwright acceptance does not
establish the new driver's runtime behavior.

The built-in browser uses a Molly-only Electron partition, persistent in a
packaged build with a stable macOS signing identity. Unpackaged macOS development
also supports site-scoped account import when OS secure storage is available, but
its browser session stays memory-only and loses sign-ins on restart. Packaged
ad-hoc/unsigned macOS builds still disable account import because Keychain trust
does not reliably survive rebuilds. Agent
commands travel through the existing owner-only local control socket and act on
the same `WebContentsView` shown in the Session sidebar. Page actions now use
the pinned native agent-browser 0.39.0 build and the unchanged MIT-licensed VS Code
CDP adapter. Electron 44.7.0 enables native WebMCP before app readiness. The adapter
is generated by `scripts/sync-browser-cdp.mjs`; source hashes and its NOTICE accompany
the bundle. Each lease has a token-gated loopback WebSocket and an owned native daemon;
revocation cuts CDP access synchronously and then cleans up processes and private files.
Molly exposes its strict action union, bounded observations and four WebMCP lifecycle
tools. Website schemas are fetched on demand and remain untrusted page data.
Catalog/lifecycle events invalidate website handles, and the CDP guard checks a
single-use permit before invocation. Image refs and element waits reuse upstream
resolution; checkbox actions never repeat a click to force a state change.
No second Chromium is installed. Hidden Agent pages stay
renderable in a hidden host window and reattach when the panel opens. The macOS
Settings > Website accounts leads with signing in on Pinterest's page inside Molly, which reads no
other browser. Its collapsed import section lists supported local Chromium browser profiles only when opened and uses the pinned
`rookie-cookies` binding in Electron main to import cookies for a user-selected
Pinterest account (the first-release import scope). Sign-in blocks Agent browsing until
its native page is destroyed. Reloading the owning app window closes its sign-in
pages and cancels pending opens while retaining ordinary Session pages.
The importer checks detailed Cookie identities against
the extraction report and rejects unsupported partitions before changing Molly
cookies, including when the destination already contains site CHIPS cookies.
The pinned reader reports excluded Chromium service directories as discovery errors;
that specific unscoped diagnostic does not block a successfully read selected profile.
Selected-profile/source errors and all other request errors still stop import.
The user may need to approve macOS Keychain access during import. The site-scoped
report and detailed reader remain separate native reads; this can repeat Keychain
authorization, and Molly does not recommend granting `/usr/bin/security` permanent
access. Browser-data
permission is separate: macOS can attribute development access to the terminal or
coding agent that launched Molly. A coding agent can be the responsible app even
when its terminal already has browser access. Allow the chosen browser under the
responsible app in Files & Folders, then refresh Molly, or fully quit and launch
`pnpm start:local` directly from an already authorized terminal. Failed listing
does not establish absent profiles. The collapsed import section offers **Open Files
and Folders settings** whenever any browser is unreadable, including alongside
readable profiles. Clicking it re-lists profiles before opening the macOS privacy
pane; it does not grant permission or import cookies.
The initial native report allows five minutes for human
authorization; Settings shows a pending hint and manual retry guidance. Read
failures leave existing Molly cookies unchanged. The pinned detailed-reader API
has no timeout parameter; five minutes is not an overall import deadline.
No extension or import socket is installed. The after-pack hook enables and
reads back Electron's encrypted-cookie fuse before signing. See the
[user guide](../../USER_GUIDE.md#built-in-browser-research-current-development-build)
for the current setup and support limits.

Navigation uses Chromium's native URL and network handling. Selected images use
Electron `net.request` bound to the owning browser session with the existing body, redirect,
Cookie and Referer bounds, then the design asset decoder. Both paths follow the
user's network, including proxies and TUN, without Molly public-DNS, `DIRECT`,
response-peer, per-site, cache or Service Worker restrictions. WebRTC is enabled
by native behavior. Native page downloads remain available and do not publish
design assets automatically.

Ownership checks, native document readiness, human takeover and finite operation
timeouts remain. Cancellation or an uncertain outcome rejects only that operation's
late result, without freezing browser access for the current run or automatically
replaying the action. Manual addresses retain loopback Managed Preview routing;
Agent navigation remains on its native page, including loopback.

Image Cookie context retains the initial site across native navigation into its
descendants, resetting on a cross-site document. Each image redirect decides
Cookie inclusion from HTTPS and that context; it does not limit destinations.

The higher-level `Session.fetch` API was checked first. In the historical Electron 39.5.1 baseline,
`redirect: 'manual'` rejects a redirect as `Redirect was cancelled` instead of
returning its response. Native request redirect events preserve the existing
per-hop Cookie policy and five-redirect bound without Node HTTP/DNS or socket
address verification.

## Browser driver build and verification

Install Rust 1.99.0 and the native target, then run
`pnpm --dir apps/electron build:browser-driver`. Normal desktop builds and development
also prepare this resource. The first build fetches a checksummed source archive,
applies the tracked host patch and compiles with Cargo's locked dependencies.
Subsequent builds reuse a verified target artifact. See
[native build inputs and patch contract](native/agent-browser/README.md).

The driver ships outside ASAR with its license and manifest. Collection checks verify
source/patch identity, target and file hashes. The existing signing hook handles its
Mach-O seal before the root app signature; compiler caches and source are excluded.
Formal distribution remains macOS arm64. Other platform builds have no new runtime
acceptance evidence. The old Playwright-only probes are retired. The native navigation
probe remains available after resource staging; it was not run for this migration.

## First-release readiness

The release workflow targets macOS Apple Silicon and requires Developer ID,
notarization and Sparkle signing credentials in the existing release environment.
It shares one resolved version across packaging and publication and publishes
`SHA256SUMS.txt` alongside artifacts. Build-only dispatch does not publish.

Before a public release, the maintainer must verify the final signed/notarized
DMG on a clean profile: configure a model, create/revise artwork, edit/save/export,
restart and recover. Test automatic upgrade between two identifiable signed Molly
versions while retaining artwork, assets, settings and native history. Existing
local ad-hoc package evidence does not satisfy these distribution/upgrade checks.
See [current acceptance evidence](../../USER_GUIDE.md#release-status-and-support-limits)
and the [release specification](../../specs/molly-design-independent-release.zh.md).

## Brand resources

The app uses the outlined Molly Design signature from the components package and
its matching M icon on a paper tile. `build/icon-source.svg` owns the large icon;
`icon-source-small.svg` (48–64px) and `icon-source-micro.svg` (16–32px) carry optical
stroke corrections. All three use a strengthened M contour for Dock legibility;
the full wordmark retains its lighter signature strokes. Keep the 1024px PNG copies in build/, resources/icon.png and
components/src/assets/molly-icon.png aligned with the large master.

`build/icon.icns` and `icon.ico` embed size-specific renders. Do not regenerate
these by downscaling only the large master or running pad-mac-icon.py: that loses
the optical variants and adds padding to an already inset tile. The existing
`icon-mac.padded.png` consumer now uses the same 48px-margin master; its filename
is retained for compatibility. This asset change does not alter app identity,
update configuration or signing. Installed Dock appearance still needs a native
visual check after packaging.
