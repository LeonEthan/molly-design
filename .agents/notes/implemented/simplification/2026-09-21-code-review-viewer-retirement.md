# Retire the code-review-viewer package

Status: implemented
Translation: pending

## Abstract

`@molly/code-review-viewer` was private build machinery that republished the
code-review-helper's single-file `standalone.html` as a versioned, sha256-pinned
asset for a `molly review` command that does not exist in the OSS CLI. Nothing
depended on it: no workspace manifest lists it, no app imports it, and its own
AGENTS.md already described it as "retained private build machinery, not a
published artifact". The package is removed with its labeler, CI-scope, and E2E
owner-path references. The code-review-helper keeps its own live standalone
consumer (`review-helper export --format html`).

## Problem

A leaf package with zero consumers still cost maintenance: lockstep-version
invariants, a manifest-generation script, CI scope fixtures, and docs that
described a jsDelivr fetch-and-cache pipeline for a command that was retired
with the Lody CLI surface. Every workspace-wide operation (install, typecheck
discovery, CI scoping, boundary checks) paid for a package whose only product
was never shipped.

## Decision

Remove `packages/code-review-viewer/` and update every live reference in the
same change:

- root `AGENTS.md` drops the viewer packaging rule;
- `.github/labeler.yml` drops the viewer path from the `scope: code-review`
  label (the helper stays);
- `select-ci-scope.test.mjs` drops the synthetic viewer package and the
  helper→viewer typecheck test, and adds `@molly/code-review-viewer` to the
  real-workspace retired-projects exclusion (the `@molly/site-docs` precedent);
- `e2e/journeys/registry.json` drops the viewer from LODY-REVIEW-001 owner
  paths (that journey exercises in-app diff surfaces, never the package);
- code-review-helper docs (`AGENTS.md`, `standalone-build.md`,
  `file-responsibilities.md`, `embed-standalone.mjs`) now state the standalone
  viewer's only consumer is the helper's own `export --format html`; the stale
  `molly review` / jsDelivr / `src/lib/review-viewer.ts` story (that CLI file
  does not exist) is removed.

The helper's `build:standalone` pipeline stays: it has a live consumer in the
helper's own CLI export command. Restoring the viewer, if a review consumer
ever ships, is `git checkout <pre-removal-commit> -- packages/code-review-viewer/`.

## Alternatives considered

- **Keep as retained machinery**: the package's own rules admitted it builds
  for no consumer; retention exists for upstream provenance, but the helper
  already holds the full source of the viewer UI, so the wrapper duplicates no
  unique content.
- **Retire code-review-helper too**: out of the approved scope — the helper's
  standalone HTML still serves its own export command, and its storybook
  scripts are referenced from the root manifest.

## Verification

- `node --test .github/scripts/select-ci-scope.test.mjs` passes, including the
  real-workspace exclusion assertion for the removed package.
- `pnpm install` refreshes `pnpm-lock.yaml` (6 deletions, no added
  dependency); `pnpm run docs check` reports 0 errors;
  `pnpm check:public-boundary` passes.
- Full `pnpm check` passes.

## Limits

- Historical notes mentioning the viewer are dated records and were not
  rewritten.
- `@molly/code-review-helper` remains private retained machinery; whether its
  storybook/export surface justifies the package long-term is a separate
  decision.
