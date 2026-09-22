# Molly Electron

Molly desktop application built with Electron, React, and TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

Follow the root [contributor setup](../../CONTRIBUTING.md#get-the-code); install
from the repository root, including its three required source submodules.

### Open-source desktop development

From the repository root, build the embedded CLI and OSS renderer, then launch
Electron with the bundled CLI:

```bash
pnpm start:local
```

This is the normal OSS development entrypoint. Fully quit an existing Molly
desktop process before running it because Electron enforces a single running
instance.

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
The focused regression is `pnpm --filter @molly/e2e canvas:resources`; see the
[lifecycle note](../../.agents/notes/implemented/bug-fix/2026-09-21-design-session-reuse.zh.md)
and earlier [callback-retention fix](../../.agents/notes/implemented/bug-fix/2026-09-21-design-session-callback-retention.zh.md).
Remaining process-memory trends need allocation and lifetime evidence: Chromium
also retains bounded storage caches and delayed frame resources. See the
[native-memory attribution](../../.agents/notes/implemented/testing/2026-09-22-memory-growth-attribution.zh.md)
before interpreting a post-GC private-memory increase as another canvas leak.

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
