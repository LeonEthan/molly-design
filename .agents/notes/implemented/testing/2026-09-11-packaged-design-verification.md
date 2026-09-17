# Packaged design verification and isolated identity

Status: implemented
Translation: pending

## Abstract

Folio needs evidence from installed application bytes, because development builds
and native CLI probes do not establish that the desktop can start or export.
The existing Bento resource and design journeys now inspect collected package
bytes, a non-sample canvas size, rejected writes and quit protection. Actual
macOS packaging exposed a package-manager mismatch that omitted `debug` and
prevented startup; the packaging runner now pins its collector to the same pnpm
entrypoint. Folio also disables the inherited Lody updater even when a legacy
force-enable environment variable is present. Platform runtime verification
remains separate from resource-only cross-host packaging.

## Decisions and discovered failures

The existing after-pack probe booted the CLI and native bindings successfully
while the desktop main process failed before reaching the design journey.
Electron Builder invoked a global pnpm 11.19.0 despite the outer packaging command
using the repository's pnpm 10.20.0. Its dependency collection omitted `debug`,
which `electron-updater` requires through `builder-util-runtime`. A private shim
inside the existing temporary configuration directory pins descendant `pnpm`
commands to the caller's explicit entrypoint. No global installation or manually
maintained runtime dependency list is introduced. The regression test executes
the shim with spaces and a quote in its path and verifies forwarded arguments.

The existing local updater policy allowed `LODY_ELECTRON_ENABLE_UPDATER=1` to
activate Lody release metadata in a Folio package. The local policy now always
disables updates; startup, checking and installing reject through the existing
service gate. Non-local policy behavior is retained. No Folio feed, release
publication or new update system is added.

The existing P1 conflict probe used Undo immediately after recreating an editor
whose undo history was empty. It therefore made no edit and could not establish
a save conflict. The probe now clicks the existing shape control to make a real
unsaved change, then verifies conflict preservation and the existing Keep editing
choice during quit. This corrects the probe, not product behavior.

## Verification approach

This extends the [resource CI evidence](2026-09-09-bento-resource-ci.md), rather
than treating that historical CI run as evidence for the current installer.
After-pack verifies hashes and licenses in `app.asar.unpacked/resources/design`
on every target. Existing native probes retain their platform/architecture gates.
P0 verifies the bundled font and image; P1 verifies 913×617 exports, save/reopen,
invalid-document and missing-font-asset rejection without replacing saved bytes,
and disabled update methods for both values of the legacy force-enable flag.
The quit probe simulates the explicit native dialog choice; it is not a human
visual-quality judgment.

Tests use private application copies and synthetic data outside the repository.
Packaged Electron ignores `LODY_ELECTRON_USER_DATA_DIR`, so launch also passes
`--user-data-dir` to Chromium. An isolated Electron entrypoint confirmed that
`app.getPath('userData')` already resolves to this directory before app readiness
or product-module imports. P1 repeats that assertion before creating a design.
`LODY_DATA_DIR` remains separately isolated. No user installation or data is
replaced or migrated.

## Execution record

The final macOS package was rebuilt from source commit
`9f56dfa80bf88fdeee76c47e821f241050bc7fc7`, also embedded as
`folioSourceCommit` in its packaged `package.json`. Its identity is
`dev.folio.app`, product/executable `Folio`, version `0.76.0`. The DMG was verified
with `hdiutil verify`, mounted read-only, copied to a private installation location,
unmounted, and the copied `.app` passed `codesign --verify --deep --strict` for
its ad-hoc signature. It is not Developer ID signed, notarized or published.

| Target                      | Evidence                                                                                                                                                                                            | Unverified                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| macOS arm64, 26.6.2 (25G83) | Installed DMG copy: P0 and P1 passed; Electron 39.5.1 / Chromium 142.0.7444.265; real embedded CLI boot, PTY spawn and in-memory SQLite query; Bento hashes/licenses                                | Developer ID, notarization, update installation; other macOS architectures                      |
| Windows x64                 | macOS arm64 cross-host `--win --x64 --dir` succeeded; PE32+ x86-64 executable; Bento hashes/licenses; target SQLite/ConPTY files, DeepSeek assets and `en-US.pak`; missing `debug` restored in ASAR | Windows execution, Windows-native pnpm shim execution, installer execution, other architectures |
| Linux x64                   | macOS arm64 cross-host `--linux --x64 --dir` succeeded; ELF x86-64 executable; Bento hashes/licenses, target native files and DeepSeek assets; missing `debug` restored in ASAR                     | Linux execution, installer execution, other architectures                                       |

Cross-host packages were collected during the same resource-fix worktree before
the final source checkpoint and P1 probe correction was committed. They verify
the identical resource closure below, not the final release combination or native
execution. Existing after-pack output explicitly skipped native execution on both.
The historical native-platform resource CI remains separately linked above.

The copied final macOS app passed both installed probes. P0 reopened identical
800×600 PNG bytes using bundled Space Mono and the synthetic image. P1 used the
actual editor controls to create/edit, undo/redo across hiding, save, destroy and
reopen a 913×617 drawing. PNG corners retained alpha zero; JPEG corners were white.
The exported files were decoded for dimensions/pixels and visually inspected; they
are stage exports, not window screenshots or placeholders. P1 also rejected an
invalid document and missing font asset without changing the saved payload,
preserved a real conflicting edit, and kept its editor alive after the simulated
Keep editing response blocked quit. Both values of the legacy updater force flag
produced disabled startup, rejected update checking and rejected installation.

A separate deliberately corrupted copy failed P0 with
`Bento resource integrity failure`, exit 1, and no success result or exported
image. The valid installed artifact was not modified. Normal startup with a fresh
isolated profile also reached the Folio `#/local/chat` workspace, then quit
normally with Command-Q. During onboarding an initial local-agent-unreachable
message appeared; Skip for now asynchronously advanced and Enter opened the local
workspace showing a connected machine and no configured Agent. This was not a
stable startup failure. Old onboarding wording and full first-setup behavior
remain the separate T23/T29 journey scope; no Agent was configured or invoked.

## Byte evidence

All values below are SHA-256. The DMG is `Folio-0.76.0-arm64.dmg`; private test
outputs are retained outside the repository, and their locations were handed to
the task owner rather than committed as machine-specific paths.

| Artifact                             | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| Final macOS DMG                      | `082a6be3ab2af947c114b5911ee2957c4636c4670117273dbc534b39b3966396` |
| Final macOS app.asar                 | `17cf4fae5f34b85bd9c4e60df58ac6c7065b96611466f43354c94432cbb65ce7` |
| Windows x64 app.asar                 | `82aa21539c8c3132f80657cd572a843e728dbd6ff10369c073a1292e5a28b900` |
| Linux x64 app.asar                   | `124efa9742b942a7e0df91f552b98ccf622580e078d01fb98e16839e40031eb1` |
| Bento editor.html, all three targets | `896f6c4e594a15636d308c4610b5f49a90b95e5571c159ac3d8469b8999c4fda` |
| sample.json, all three targets       | `6420efd728e8f5203ed8a489567cd7a83e1fb9a9b5ca0b751802fb90530abd7f` |
| P1 design.png, 4,666 bytes           | `f953eff9d7f262e8b0da3111c2da77b782b1ecbf5fca6ec21022ad8cdf37010a` |
| P1 design.jpeg, 6,741 bytes          | `0acdd365d95b8a2eba516748c73405ccda1148e1cb0c8a70f4bd5194f3971704` |

## Checks and limits

The full repository check passed type, lint, tests, i18n and platform checks, then
its public-boundary scan rejected a generated test `.app` placed under `output`.
Moving that private artifact outside the repository made the same boundary check
pass; no source allowlist was weakened. The focused Electron suite and packaging
shim regression passed after the collector change, and the final source rebuild
passed Electron typechecks. Root formatting, documentation checks, public-boundary
and `git diff --check` passed. Documentation reports only existing size warnings;
there are no registered SHA topics.

This verifies the T27 package/resource boundary and current design journey. It
does not claim the later T02 serial-editing changes, actual Agent/model matrix,
or T28/T29 final combination have been tested. Changes affecting resources must
rerun the corresponding probes. There was no paid model call, auto-installation,
update download, user-data migration, release upload or issue/PR mutation.
