# Vendor layout for retained ACP submodules and a Molly-owned ignore package

Status: implemented
Translation: current

[中文](2026-09-20-vendor-retained-acp-submodules.zh.md)

## Abstract

Four retained upstream ACP submodule checkouts (Claude, Codex, Grok, Kimi) sat
inside `packages/` even though the workspace excluded them, so the owned-package
directory overstated the maintained surface and invited contributors to treat
historical material as live code. The vendored file-watcher package also
published itself as `@loro-dev/ignore`, borrowing a namespace Molly does not
control. The four submodules now live under `vendor/`, which no workspace glob
matches, and the watcher package is `@molly/ignore`. Full `pnpm check` passes;
the only intentional residue is the submodule _names_ in `.gitmodules`, which
`git mv` keeps stable and which do not affect fresh clones.

## Problem

`packages/` mixed two kinds of content: Molly-owned packages that CI builds and
tests, and retained upstream checkouts that root pnpm explicitly excluded.
Evidence of the confusion cost: the Kimi checkout alone is an 84 MB third-party
monorepo whose root package is still named `@moonshot-ai/monorepo`, and the
workspace needed four `!packages/acp-extension-*` exclusion lines to keep pnpm
away from directories that only existed for provenance. Separately,
`packages/ignore` carried the name `@loro-dev/ignore` with `version 0.0.0` and
no `private` flag; nothing in its source, headers, or the NOTICE file indicates
loro-dev provenance, so the name was a namespace squat that an accidental
publish could have turned into impersonation.

## Decision

- Move `packages/acp-extension-{claude,codex,grok,kimi}` to
  `vendor/acp-extension-{claude,codex,grok,kimi}` with `git mv`, preserving each
  pinned commit. Build-required submodules (`packages/acp-extension-core`,
  `packages/acp-extension-dsh`, `packages/design-bento/bento`) stay in place.
- Drop the four workspace exclusion lines from `pnpm-workspace.yaml`; `vendor/`
  matches no workspace glob, so exclusions are unnecessary.
- Rename `@loro-dev/ignore` to `@molly/ignore` (manifest, the single importer in
  `apps/electron`, the electron-vite `externalizeDeps` exclusion, and the
  lockfile).

## Reference updates required by the move

A full-repo grep outside historical notes found every consumer, and each was
updated in the same change: `.oxlintrc.json` ignore patterns, the root `lint`
ignore-patterns, `scripts/package-kimi-runtime.mjs` (`kimiRoot`),
`apps/cli/scripts/probe-grok-design-hooks.mjs` (adapter path),
`.github/scripts/select-ci-scope.mjs` (`ALWAYS_FULL_GLOBS` Kimi paths) with its
test fixtures, `.github/labeler.yml` (`scope: agent-runtime` now covers both
`packages/acp-extension-*` and `vendor/acp-extension-*`), plus wording in
`README.md`, `README.zh-CN.md`, `CONTRIBUTING.md`, and root `AGENTS.md`.
Historical `.agents/notes` entries were not rewritten.

## Alternatives considered

- Keeping the four submodules in `packages/` with the exclusion lines: zero
  churn, but the misleading layout was the problem being fixed.
- Deleting the retained checkouts outright: loses the pinned provenance and the
  historical Kimi runtime source that `package-kimi-runtime.mjs` packages.
- Renaming `.gitmodules` section names to match the new paths: cosmetic; the
  name is only an internal key (path is authoritative), and rewriting it would
  require moving `.git/modules/*` entries in every existing clone for no
  behavioral gain.
- Only adding `"private": true` to `@loro-dev/ignore`: stops accidental publish
  but keeps a foreign namespace in imports and build config permanently.

## Verification

- `git submodule status` reports identical pinned commits at the new paths;
  `git -C vendor/acp-extension-kimi rev-parse HEAD` resolves.
- `node --test .github/scripts/select-ci-scope.test.mjs
.github/scripts/run-ci-typecheck.test.mjs`: 46/46 pass, including the
  real-repo `loadWorkspace` assertions that the four names stay excluded.
- Full `pnpm check` (typecheck, oxlint, all tests, i18n, boundary guards) passes
  in the ambient Lody desktop shell.

## Limits

- Existing clones need `git submodule sync` / re-init only if they work with the
  retained checkouts; ordinary desktop work never initializes them.
- `site-docs/` remains at the repository root and Bento remains an external-org
  submodule; both are separate follow-ups not covered here.
