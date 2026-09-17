# Molly Electron

Molly desktop application built with Electron, React, and TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

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

Every build command below uses the local OSS renderer, embeds the local-only
CLI, and has no update publishing target or notarization identity.

```bash
# For Windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

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
hashes; it does not establish that Windows/Linux native executables run. Local
packages do not enable the inherited Lody updater, including with
`MOLLY_ELECTRON_ENABLE_UPDATER=1`. Packaging is not signing, notarization or release
publication.
