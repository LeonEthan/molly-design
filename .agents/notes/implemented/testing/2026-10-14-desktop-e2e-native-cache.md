# Reuse verified native resources in Desktop E2E

Status: implemented
Translation: pending

## Abstract

Desktop E2E smoke spent roughly 8.5 of its 14.5–16 minutes compiling the bundled
`agent-browser` driver and `browser-cookie-reader` addon from source, although the
journeys took about one minute. GitHub-hosted macOS regression now restores those
two staged resource directories from an exact-key Actions cache after a clean
checkout, then passes them through the existing manifest-verification fast path;
invalid output is deleted and rebuilt, and only fresh verified builds are saved.
Actions cache scope is the provenance boundary: pull-request writes stay in their
PR ref and release never restores. Hosted cold/warm timing at one commit is still
owed by the PR evidence; this note records the design and local verification only.

## Problem

[Issue #144](https://github.com/LeonEthan/molly-design/issues/144) measured four
smoke runs at 14m32s–16m14s with a warm pnpm cache; the native builds were cold on
every run (about 6m53s and 1m32s in run 38671176976). Checkout cleaning removes
the ignored `apps/electron/resources/*` and `.cache/*` outputs, so nothing native
survives between runs.

## Reuse ladder

- **Reused directly:** `actions/cache/restore` and `actions/cache/save` (already
  the mechanism behind `setup-node`'s pnpm cache) and the existing
  `verifyAgentBrowser`/`verifyBrowserCookieReader` fast paths in the build scripts.
  No second build system or verification format was added.
- **Reused with adaptation:** the verifiers now also compare the manifest's
  archive checksum (and agent-browser's version) with `source.json`, require the
  recorded target triple to match the platform/architecture, and bind each staged
  license or notice to the tracked `native/*` bytes. Before this, a producer could
  replace a license and reseal the manifest consistently, and a local staged
  resource kept a stale license after a notice update. The signing reseal keeps
  these fields, and its fixtures now record the real target triple. The fast path now logs its outcome and
  removes an invalid directory before rebuilding instead of silently falling through.
- **Borrowed pattern:** key computation lives in
  `apps/electron/scripts/native-resource-cache.mjs`, with each build script
  exporting its own input descriptor (source manifest, patch, licenses, build
  scripts and target map) so the key cannot drift from what the script reads.
  `.github/scripts/desktop-native-cache.mjs` is only workflow glue.
- **Rejected:** Cargo/`target`-directory caching (larger, toolchain-sensitive, and
  still compiles; the issue makes it optional); caching `apps/electron/.cache`
  source archives (download is not the bottleneck); `clean: false` or runner
  leftovers (forbidden by the issue); broad `restore-keys` (could select a stale or
  lower-trust executable).

## Key identity

The key is `molly-native-<resource>-<platform>-<arch>-<sha256>` over: runner OS,
`ImageOS` and `ImageVersion`; platform, architecture and Rust target triple; `rustc -vV` (version,
commit, host, LLVM), `cargo -V` and `clang --version` (including the Xcode
installation); macOS SDK version and build; Rust/C build
environment variables (`RUSTFLAGS`, `CARGO_BUILD_*`, `CARGO_PROFILE_*`,
`MACOSX_DEPLOYMENT_TARGET`, `CC`, and similar); and the bytes of `source.json`
(revision, archive checksum, pinned compiler, version/protocol), `embedded.patch`,
every license/notice input, the resource build script and the key module. Crate
dependencies are fixed by the archive's `Cargo.lock` and `--locked`; the N-API
addon does not link a Node or Electron ABI. Application edits outside these
inputs keep the key. `ImageVersion` is included because an image refresh can
change the linker or system libraries without changing the rustc, clang or SDK
identifiers; each refresh therefore causes one intentional cold build, after
which application-only commits on that image reuse the entry.

## Validation and fallback

Actions can prefix-match even a primary key, so a restore is accepted only when
`cache-matched-key` equals the requested key and `cache-hit` is true; any other
restored directory is deleted before the build (`rejected-key`). An accepted hit
never skips verification. The build fast path checks source revision, archive
checksum, version/protocol, patch digest, compiler, target triple, platform/architecture, exact regular-file inventory, file
hashes, build identity, unlisted files and license bytes. Missing, incompatible,
corrupt or incomplete output is removed, logged with its reason, and rebuilt from
the checksum-pinned source; verification only reads bytes. After the build,
`desktop-native-cache.mjs verify` re-runs both verifiers. A restore miss is not
proof of a fresh build, so each builder appends `{resource, buildId}` to
`MOLLY_NATIVE_BUILD_REPORT` only after compiling and verifying in this run; a
save step runs only when the post-build verification of that component matches
a recorded `buildId`. Reused or relabelled output is never saved. A hit whose
content failed verification cannot be overwritten (cache keys are immutable);
each run rebuilds and logs it until the entry is evicted or the key schema changes.

## Provenance boundary

Desktop E2E runs on `pull_request` with read-only repository permissions. GitHub
scopes caches by ref: a PR run reads its own PR-ref entries and default-branch
entries, and its writes are visible to no other ref. Default-branch entries are
written only by default-branch runs (the scheduled Daily macOS leg or a maintainer
dispatch on the default branch), so the trusted-to-untrusted direction is the
only sharing. A dispatch on any other branch writes that branch's scope and is not
treated as trusted. The alternative of PR-numbered or trusted-namespace
keys, was not adopted: it would add no isolation beyond GitHub's enforced scope
and would prevent PR runs from reusing Daily-seeded default-branch entries. Release
packaging and every non-regression workflow build from source and are checked not
to reference these caches; `pull_request_target`, whose writes land in base-branch
scope, must never use them. `pull_request` runs, including fork pull requests,
can save; their entries are scoped to the PR merge ref. Read-only `contents`
permission does not make the cache read-only. Saves are non-fatal only so that
cache-service unavailability, quota eviction or a write refusal leaves later runs
cold instead of failing the journeys. Manifest checks establish consistency, not trust in a
producer able to replace both binary and manifest.

## Observability and benchmark control

`[native-cache]` lines log pnpm-cache state, per-resource restore hit/miss/cold
skip and restore duration; `[native-resource]` lines log verification outcome and
duration, reuse or rebuild, and native build duration. The PR workflow's manual
dispatch gains `native_cache: reuse | cold`; `cold` skips restore only, so the same
commit can be timed cold then warm (see the E2E README).

## Verification and limits

- `apps/electron/scripts/native-resource-cache.test.mjs`: key changes for each
  source manifest, patch, license and script input and for toolchain, SDK, target,
  runner image and build environment; unrelated edits keep it. Valid synthetic
  resources reuse; missing, corrupt, incomplete, unlisted, stale-source, other
  toolchain/patch, other archive checksum or target triple, resealed-license and
  wrong platform/arch resources are deleted
  without executing their binary. Removing the license binding fails the
  resealed-license case.
- `.github/scripts/desktop-native-cache.test.mjs`: restore follows checkout and
  precedes the build; exact keys, no `restore-keys` or `clean:`; only an exact
  matched key is accepted and prefix or missing restores are deleted; non-fatal
  save requires a this-run build record whose `buildId` matches post-build
  verification (relabelled and restored output is not saved); only the two regression workflows use the cache,
  never with `pull_request_target` or write permissions; the cold control is
  dispatch-only and does not skip verification; the restore report. The smoke
  workflow runs both cache test files on every hosted run, cold or warm.
- Local controlled run on an Apple Silicon Mac with Rust 1.99.0 (development
  machine, not a hosted runner): cold builds took 198.5 s (agent-browser) and
  37.4 s (browser-cookie-reader). After snapshotting and restoring both staged
  directories, verification took 10 ms and 4 ms and both builds were skipped.
  A restored binary with one appended byte and a restored directory missing a
  license were each rejected with their reason, removed and rebuilt; the rebuilt
  agent-browser binary was byte-identical to the cold build.
- Smoke/full journey selection and gates are unchanged.
- Not yet established here: hosted same-SHA cold/warm timings, actual hit rate on
  new PRs (depends on Daily seeding the default branch), and whether the 7–9 minute
  warm target is reached.
