# Local Molly Preview installation

Status: implemented
Translation: pending

## Abstract

Development launch does not exercise all packaged Electron paths, which makes local
testing differ from the installed product. Molly Preview reuses release packaging
and installs an independent application that opens from Finder. Package metadata
selects isolated storage and background identity before initialization, and Preview
never checks for release application updates. Local Preview omits installer creation
and notarization; release installation and upgrade checks remain separate.

## Decision and reuse

`start:local` already builds the embedded CLI and production renderer, but remains
unpackaged and takes different Helper/browser paths. `build:unpack` already exercises
release resource collection, native dependency probes and signing, so adapt its
`package-electron.mjs --dir` boundary with `--preview` instead of adding a second
builder or a development-only runtime. The existing installation profile owns state
roots, sockets, protocols and host leases; extend it in TypeScript and CommonJS with
a Preview channel. Existing About/version display reports the Git-based Preview version.

`pnpm preview:install` builds, packages and stages a signed application under
`~/Applications`. It verifies bundle identity and signatures before replacement,
rejects running Preview processes and preserves test data. Only a matching Preview
bundle may be replaced. Available local signing credentials follow the release signer;
without them an ad-hoc bundle retains the existing browser-import restrictions.
No public update feed, CI release channel, parallel storage or paid service is added.

The pinned builder merges arrays across inherited configuration. An initial package
therefore declared both release and Preview protocols. Use its supported single
Protocol object to replace the inherited array, verify the real merged config in
regression, and reject mixed protocols before installation. Local certificate
auto-selection supplies the qualifier without the certificate-type prefix required
by the builder. Preview keeps Developer ID signing but disables remote signing
timestamps: the existing signer otherwise contacts Apple's timestamp service for
each collected resource, including duplicated Sparkle localization paths. Release
signing and notarization settings remain unchanged.

## Isolation

The desktop reads `mollyChannel` from packaged metadata before platform/storage
initialization. Stable/development launches reset inherited channel selection.
Preview pins `~/.molly-preview` and `Application Support/Molly Preview`, skips all
legacy migrations and ignores generic profile overrides. Shared installation profiles
provide its `molly-preview` namespace, port 17794, protocol and bundle ID. The desktop
pins these choices in every CLI launch after login-shell and request environment
merging. Release profiles and data are unchanged.

The Preview packaging override clears the Sparkle feed/key, disables automatic checks
and omits publish metadata; runtime update policy also rejects manual checks and
install requests through the existing disabled-updater path. The packaging wrapper
rejects explicit publish flags for Preview and keeps its default `--publish never`.

## Validation

Focused tests cover startup without environment variables, hostile inherited
profile/channel values, migration avoidance, child identity, disabled updates,
TypeScript/CommonJS endpoints and staged installation/replacement safeguards.

- `pnpm check` passed: type checks, lint, repository tests, i18n and all boundaries.
  After the final packaging fixes, the Electron suites passed again, including the
  real builder-config merge regression, publish rejection and signed installer fixtures.
- `pnpm format` passed. Its unrelated pre-existing formatting change was restored.
  Frozen/offline dependency installation and lockfile regeneration left the lockfile
  unchanged because only package scripts changed.
- The complete `pnpm preview:install` command passed on macOS arm64 and installed
  version `0.1.2-preview.gf69da6a3.dirty`. Packaged Bento, encrypted-cookie fuse,
  browser reader/driver, image decoder, Pi, CLI and SQLite checks passed. Developer
  ID signature verification passed before and after installation. Final Info.plist
  declares only `molly-preview`; its update feed/key are empty and checks disabled.
- Launch Services opened the installed app into its first-run onboarding without
  profile environment variables. The actual Preview probe returned healthy from
  `~/.molly-preview/run`; the desktop held port 17794, and its CLI ran from the
  installed bundle rather than repository output. The running-app replacement
  guard rejected the live app.
- Normal application quit completed; replacing the installed app preserved synthetic
  markers in both Preview data directories. Relaunch reached onboarding and a healthy
  new packaged daemon. Synthetic markers were removed; Preview remains open for
  manual testing. No release application was launched or replaced.

An initial certificate-qualifier failure and the stopped mixed-protocol package are
failed/intermediate attempts, not acceptance evidence. Only the final corrected
package was launched. These checks make no model calls, configure no credentials
and do not establish real creation workflows, notarized first-install acceptance
or application update installation. No artifacts were published or committed.
