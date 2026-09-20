# Molly

[简体中文](README.zh-CN.md)

Molly is an independent, local desktop workspace for graphic design with an Agent
and an editable canvas. Create a poster, revise it in conversation, adjust text,
shapes and images directly, then export PNG or JPEG.

Built on [Lody](https://github.com/LodyAI/Lody), Molly combines its desktop and
execution architecture with the Bento editor and one bundled Pi engine. Artwork,
versions and conversations stay in local product storage. Model and image requests
use the providers you explicitly configure; no Molly cloud account is required.

## Current development build

- Create and revise a single-canvas design through conversation or direct editing.
- Automatically save manual edits, retain versions, reopen and export artwork.
- Supply your own model connection. Image generation/editing is optional and uses
  a separately configured connection and explicit model.
- Keep editable BentoDoc artwork with a YAML projection for Agent authoring.

**Release status:** development build; first-release target is **macOS Apple Silicon**.
There is scoped installed-package evidence, but the complete migrated workflow,
public signed/notarized distribution and two-version automatic upgrade acceptance
are not complete. macOS Intel, Windows and Linux builds remain experimental.
See [tested journeys and limits](USER_GUIDE.md#release-status-and-support-limits).

## Get started

For an available local DMG, follow the [installation guide](USER_GUIDE.md#install-the-macos-package).
This repository does not yet claim an established public download channel.

1. Open Settings → Agents → Molly model connections and add your provider connection.
2. Create a canvas and explicitly select the connection, model and thinking level.
3. Try: “Create an 800 × 600 workshop poster with a dark blue background and an
   editable ‘Make something’ heading.” Then ask for a revision or edit the canvas.

[Connections and image tools](USER_GUIDE.md#configure-connections) ·
[Save, preview and recover](USER_GUIDE.md#continue-preview-and-recover) ·
[Backup and uninstall](USER_GUIDE.md#back-up-uninstall-and-recover-data)

## Run locally

Use Node.js `>=22.14.0 <23 || >=23.6.0` and repository-pinned pnpm through Corepack:

```sh
git clone https://github.com/LeonEthan/molly-design.git
cd molly-design
git submodule update --init packages/acp-extension-core packages/acp-extension-dsh packages/design-bento/bento
corepack pnpm install
corepack pnpm start:local
```

The first build also runs locked `npm ci` inside a temporary Bento checkout;
network access and native build tools may be required. The desktop bundles its
execution engine; users do not install a separate Agent CLI.
See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, checks and dependency boundaries.

## Repository

| Area                                                        | Responsibility                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/electron`                                             | Desktop application, native integration and packaging          |
| `apps/cli`                                                  | Embedded local service, Agent execution and design persistence |
| `packages/components`                                       | Shared workspace interface                                     |
| `packages/design-bento`                                     | Pinned editor, Molly adaptations and rendering resources       |
| `packages/design-authoring`                                 | Lossless YAML artwork conversion and Agent skills              |
| `packages/harness-pi`                                       | Bundled model engine and reviewed extensions                   |
| `packages/platform`, `packages/shared`                      | Platform ports and shared contracts                            |
| `packages/acp-extension-core`, `packages/acp-extension-dsh` | Required upstream protocol/capability contracts                |
| `e2e`                                                       | Desktop acceptance tooling                                     |

Other ACP submodules under `vendor/` and `site-docs` retain upstream/historical
material outside the
default workspace. The Lody website is not Molly documentation. See the
[dependency maintenance guide](CONTRIBUTING.md#source-dependencies) before changing them.

## Contribute and get help

Use [Molly Issues](https://github.com/LeonEthan/molly-design/issues) for reproducible
bugs and proposals, the [user guide](USER_GUIDE.md) for usage and recovery, and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before preparing a contribution.

## Source and licenses

Molly is an independent derivative of Lody. Its original authorship and
[Apache-2.0 license](LICENSE) remain intact. Rights-holder-owned adapters migrated
from `agentic-listing-design` are also authorized under Apache-2.0; Bento and other
third-party components retain their own licenses. See [NOTICE](NOTICE),
[Bento provenance](packages/design-bento/README.md),
[authoring provenance](packages/design-authoring/README.md) and
[dependency notices](THIRD_PARTY_NOTICES.md).
