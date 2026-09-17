# Folio public identity and help

Status: implemented
Translation: pending

## Abstract

The desktop already had a Folio installation identity, but its README, Help menu
and About links still advertised Lody's hosted, mobile and team product. T26
makes the public entry point the bilingual Folio README and routes help and
feedback to the Folio repository. The description separates current canvas
editing from unfinished Agent integration, and retains upstream authorship and
artwork. This is a documentation and visible identity correction, not a release
certification or a migration of user data.

## Decision and evidence

Implements [Issue #28](https://github.com/LeonEthan/Folio/issues/28), within the
[scope review](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md).
The [draft specification](../../../../specs/graphic-design-platform.zh.md) remains
draft; neither this note nor documentation checks approve its unimplemented goals.

The existing installation profile uses `dev.folio.app`, `folio://`, `~/.folio` and
local port 17790. Electron sets its name from that profile before creating stores.
These mechanisms remain intact. Newly provisioned workspaces use the name Folio;
the existing-workspace branch returns the stored name unchanged. Renderer/recovery titles, a native unresponsive
message and selected local UI translations had remaining Lody product labels.
The package description and homepage now describe Folio; its internal name,
author, dependency versions and lockfile retain their prior meanings.

The README now describes single-canvas editing, Agent-led PPTD authoring and Bento,
with editable poster examples. Image connection setup is optional for canvas
editing and asks the user for an explicit model; no model is recommended. Hook,
image-input and live-preview work is described as development work, without
promising support for every configurable Agent. No asset library, result-card or
candidate approval workflow is advertised. Subsequent feature changes own their
corresponding help updates, including onboarding under T23.

The desktop About panel gives a visible product description, documentation and
feedback. Native Help and sidebar help use the same repository destinations.
Upstream site material and historical notes are preserved; the README explicitly
identifies `site-docs` as Lody material rather than Folio's feature reference.
Existing upstream runtime/configuration links outside product help retain their
source attribution.

The macOS PNG icon was visually inspected; the checked-in PNG, ICNS and ICO
resources remain in their existing packaging paths. They are the inherited Lody
jellyfish artwork, now explicitly attributed in the README. There is no new logo,
icon-generation system, package identity or data migration. Replacing all Lody
strings was rejected because package names, protocol contracts, third-party
attributions and historical records must remain accurate.

## Verification and limits

Verification results are recorded below before handoff. This ticket does not
claim signed packaging, Windows/Linux launch, or successful live Agent design
execution. Those require their own platform/runtime evidence.

- `corepack pnpm install` completed in the independent worktree with
  `LODY_SKIP_ELECTRON_POSTINSTALL=1`; this skips Sparkle installation, not a
  packaging success claim. No dependency or lockfile change was required.
- `corepack pnpm --dir apps/electron build` completed for the OSS composition.
- A real macOS Electron launch used the built application directory, a fresh
  temporary user-data directory and an isolated local CLI port/data directory.
  It reported app name Folio, package version 0.76.0 and the expected application
  path. The new workspace sidebar and window title read Folio. The About panel
  displayed the design description, documentation, feedback and license controls.
  Invoking the native Help actions produced the Folio README and Issues URLs.
- An initial temporary probe launched `out/main/index.js` directly, which gave
  Electron the wrong app path and caused `design.pending` to look for resources
  under `out/main`. Launching the package directory removed that probe error;
  the staged design worker also answered `pending` successfully in isolation.
- HTTP checks returned 200 for the Folio repository, Issues, Chinese README and
  Lody upstream repository. The adapter source's anonymous repository URL returned
  404; the README therefore retains its name and local provenance links without
  advertising that inaccessible URL as a public entry.
- English About was visually inspected. Chinese copy is present in the shipped
  locale resources, but an attempted automated locale-switch probe timed out;
  Chinese runtime presentation is not claimed. No live Agent or generated image
  was needed or invoked for this identity/help verification.
- Final `corepack pnpm check` passed: types, lint, repository tests, i18n and
  public/platform/import boundaries. Only inherited `ANTHROPIC_*` and
  `CLAUDE_CODE_USE_*` variables were omitted from the check subprocess environment;
  no user configuration was changed. Two existing provider-copy assertions were
  updated to the new Folio wording. The existing workspace provisioning tests pass.
- `corepack pnpm format`, targeted Prettier, `corepack pnpm run docs check` and
  `git diff --check` passed. The unrelated Sparkle test formatting produced by the
  repository formatter was reverted. Documentation size warnings remain existing;
  no registered SHA-protected topic changed.
