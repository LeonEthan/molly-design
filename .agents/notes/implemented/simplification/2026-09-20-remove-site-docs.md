# Remove the retained Lody website tree (site-docs)

Status: implemented
Translation: current

[中文](2026-09-20-remove-site-docs.zh.md)

## Abstract

The repository carried `site-docs/`, a 458-file retained copy of the Lody
product website, at its root even though Molly's public source boundary is
`apps/{cli,electron}` and their packages, and the README already stated the
Lody website is not Molly documentation. Every consumer was CI/docs tooling
that treated the tree as skippable, plus one orphaned explainer doc. The tree
is now removed; the content remains reachable from git history and the upstream
Lody repository, so the deletion is fully reversible. The trade-off accepted:
two component-code comments still mention the historical `site-docs` consumer
because the interop constraints they describe still exist in the code.

## Problem

An independent-brand repository was publishing another product's marketing and
documentation website: 40 MB on disk, its own AGENTS.md rules, and entries in
the labeler, CI scope globs, and lint ignores. The tree participated in no
build, test, or package — the CI scope test only proved changes to it were
skippable — so its presence was pure cost: clone size, contributor confusion
about which product this repo ships, and surface for docs tooling warnings.

## Decision

Remove `site-docs/` with `git rm` and update every reference in the same
change: `.oxlintrc.json`, `.github/labeler.yml`, `select-ci-scope.mjs`
(`SKIPPABLE_GLOBS`) and its tests (the skip-behavior test is removed; the
synthetic-workspace assertion that `@molly/site-docs` is not a workspace
package stays), `README.md` / `README.zh-CN.md`, `CONTRIBUTING.md`, root
`AGENTS.md`, `.agents/README.md`, and `.agents/docs/AGENTS.md`.
`.agents/docs/site-landing-and-marketing.md` documented only the removed tree
and is deleted with it. Historical notes mentioning `site-docs` are dated
records and were not rewritten.

## Alternatives considered

- Moving `site-docs/` under `vendor/` like the retained ACP submodules
  ([note](../architecture/2026-09-20-vendor-retained-acp-submodules.md)): keeps
  provenance in-tree, but `vendor/` holds pinned submodule checkouts with their
  own git repos; an in-tree website copy is not needed for any build and
  upstream retains the original, so the move preserves cost without benefit.
- Keeping it as retained material: contradicts the repository boundary rule
  that public source is the desktop apps and their packages.

## Verification

- `node --test .github/scripts/select-ci-scope.test.mjs` passes after removing
  the obsolete skip-behavior test.
- `pnpm run docs check` reports no broken links and exits 0.
- Full `pnpm check` passes in the ambient Lody desktop shell.
- Restore path if ever needed: `git checkout <pre-removal-commit> --
site-docs/` or the upstream LodyAI/Lody repository.

## Limits

- Two comments in `packages/components` (`diff-render-worker.ts`,
  `use-session-actions.ts`) still reference the historical consumer to explain
  existing interop constraints; simplifying that code is out of scope.
- Bento remains an external-org submodule and four specs remain Chinese-only;
  both are separate follow-ups.
