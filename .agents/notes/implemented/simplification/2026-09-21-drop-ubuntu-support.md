# Retire Linux desktop support

Status: implemented
Translation: pending

## Abstract

The Ubuntu Daily journey repeatedly failed before useful product coverage, first
at credential storage and then during local bootstrap and teardown. The maintainer
approved retiring Linux desktop support, including packaging, updates and desktop
integration, and retaining macOS and Windows in Daily. Official release scope stays
macOS arm64; Intel macOS and Windows remain experimental builds. This reduces the
maintained product surface without claiming the unresolved Linux bootstrap failure
has been diagnosed or fixed.

## Decision and evidence

The narrower alternative removed only the Ubuntu Daily leg and its diagnostic
work. The maintainer selected the broader product removal (scope B), including
Linux package targets, updater installation and desktop-file identity. This
continues the [deterministic model-wire repair](../testing/2026-09-21-e2e-deterministic-model-wire.md)
and references [#51](https://github.com/LeonEthan/molly-design/issues/51).

The prior investigation recorded unavailable Secret Service producing
`credential_storage_unavailable`. Installing gnome-keyring and wrapping execution
in dbus-run-session in [run 35581506964](https://github.com/LeonEthan/molly-design/actions/runs/35581506964)
cleared that failure, but journeys stalled in `waitForLocalBootstrap` with CLI
phase `starting`, followed by teardown hanging until the job timeout.
[Diagnostic run 35588885714](https://github.com/LeonEthan/molly-design/actions/runs/35588885714)
reported usable safeStorage under the wrapper without successful Linux journeys.
Its terminal status was verified as cancelled before this implementation. These
are prior investigation observations, not a root-cause conclusion or a new local
reproduction. The diagnostic branch was deleted locally and remotely; its two
commits were not merged into main.

## Implementation and boundaries

- Daily executes macOS and Windows. macOS remains canonical failure evidence;
  Windows evidence remains in Actions artifacts until stable.
- Linux package commands and builder targets, `.deb` installation, AppImage
  protocol registration and desktop-file identity are removed. Packaging hooks
  reject Linux targets before staging native dependencies.
- Windows retains electron-updater publish metadata and `latest*.yml`; macOS
  retains Sparkle. No release is published by this work.
- Ubuntu static/test, smoke, reconciliation and release orchestration runners
  remain. Bento's three-platform resource-integrity matrix remains intact.
  Shared platform-neutral native-dependency helpers and defensive credential
  rejection on Linux remain useful to CI; removing product support must not
  enable plaintext credential storage in a source build.
- Historical notes, changelogs and upstream platform contracts remain history or
  shared infrastructure. Related release/design Specs return to draft because
  this revision changes support intent; prior approval does not approve it.

## Verification and remaining work

- `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm format`, `pnpm e2e:check`,
  `pnpm build`, documentation checks and `git diff --check` passed. The first
  sandboxed check could not bind local IPC sockets; it was stopped, and the full
  check passed outside the sandbox. Manifest changes affect scripts/metadata only;
  lockfile regeneration produced no dependency changes.
- Packaging rejection tests cover `--linux`, `--linux=deb`, `-l AppImage` and the
  before-pack hook before native staging.
- A temporary macOS arm64 directory package passed Bento integrity, image decoder,
  sealed engine, CLI boot, PTY and SQLite probes. It used local ad-hoc signing,
  not Developer ID/notarization or release publication.
- A temporary Windows x64 directory package passed resource and locale probes;
  executable resource editing/signing was disabled for this cross-host check.
  Native execution was explicitly skipped on the macOS host. Intel macOS and
  Windows arm64 packaging were not exercised. Host CLI staging was restored after
  cross-packaging.
- Local full E2E: onboarding passed; the three model-dependent scenarios failed
  at `modelConnections.save` with `credential_storage_unavailable`. The macOS
  credential implementation is unchanged; this is an unresolved local environment
  limitation, not passing E2E evidence. Credential protection was not bypassed.

No Linux support or native Windows acceptance is claimed. Issue #51 stays open
until a full Daily on main passes the new macOS/Windows matrix; the PR uses
`Refs #51`, not a closing keyword. Only after that may Scout soak on the new
harness inform triage of [#45](https://github.com/LeonEthan/molly-design/issues/45).
The first public GitHub Release remains deferred to the maintainer.
