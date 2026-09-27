# Vendor the Bento editor source in-tree

Status: implemented
Translation: current

[中文](2026-09-21-vendor-bento-in-tree.zh.md)

## Abstract

Bento, the design editor's upstream, was a submodule from an external
organization (nyblnet/bento) that Molly does not control, combined with five
Molly patch files applied at build time. That arrangement made an independent
brand release depend on a third-party org's hosting and forced every checkout
and CI job through a sparse worktree plus `git apply` ceremony. The submodule is
now removed and its `slides`/`kernel`/`scripts` subtrees are vendored in-tree
under `packages/design-bento/bento/` with the five patches already applied;
the builder copies that tree instead of materializing a pinned worktree. The
built `editor.html` and `build.json` are byte-identical to the pre-change
baseline (sha256 `65e8e697…0533bb` and `633078d9…68ecb1c` respectively), so the
shipped canvas is unchanged. The trade-off accepted: upgrading the Bento pin is
now a manual re-import-and-re-apply refresh instead of a submodule pointer bump.

## Problem

- The submodule pointed into `nyblnet`, an organization Molly does not control;
  force-pushes or deletion upstream would break fresh clones and CI.
- Every build ran a detached-worktree sparse checkout plus five ordered
  `git apply` steps, which is slow, Windows-fragile, and obscured the actual
  source being built.
- Contributor docs had to explain a three-submodule init ritual where one of
  the three existed only to be patched into something else.

## Decision

De-submodule Bento and vendor its `slides`, `kernel` and `scripts` subtrees
(plus `LICENSE` and `THIRD_PARTY_NOTICES.md`) at
`packages/design-bento/bento/`, with the five recorded Molly patches applied in
manifest order as ordinary source:

- `canvas-moveable-deferred-dragstart`
- `a1a2-semantic-editor`
- `web-product-session`
- `a1a2-native-mutation-seal`
- `gd4c-frame-decorators`

`scripts/build.mjs` now `cpSync`s the vendored tree into a temp directory
instead of building a sparse worktree and applying patches; the vendor overlay,
in-script pinned-anchor adaptations, `npm ci`, tsc/vite build, output hashing
and license emission are unchanged. `source-manifest.json` records the same
`bentoCommit` and lists the adaptations under `appliedPatches`; the retired
`patches/` directory is removed and its hash entries leave the manifest `files`
map. `packages/design-bento/AGENTS.md` binds the vendored tree to recorded
refreshes only.

Reference updates: the seven workflow init lines, README/README.zh-CN and
CONTRIBUTING drop the third submodule (two pinned submodules remain);
`packages/design-bento/README.md` describes the vendored build and the
re-import upgrade procedure; NOTICE states the vendored provenance; two
historical notes whose markdown links pointed at the deleted patch files are
repointed to `source-manifest.json` without rewriting their rationale.
`.gitattributes` already pins `packages/design-bento/**` to LF, so Windows
checkouts keep byte-identical hashes; oxlint already ignores the tree.

## Alternatives considered

- Keep the submodule: zero migration cost, but the external-org dependency and
  the patch ceremony remain, and fresh-clone fragility is unresolved.
- Fork into a Molly-owned org and keep the submodule: removes the org-control
  risk but keeps worktree/patch complexity and splits the source of truth
  across two repositories.
- Publish a patched Bento as an npm package: adds a release pipeline and
  versioning for one consumer; the in-repo tree is simpler to audit and diff.

## Verification

- Deleted `apps/electron/resources/design/`, rebuilt from the vendored tree:
  `editor.html` sha256 `65e8e697ed453f33a1dae100d0c0c2ce64f7b40a607c28df286851d4100533bb`
  and `build.json` sha256 `633078d957eb035b79aa0414c8423c7833cf8f5990f247cc14377a35968ecb1c`,
  both identical to the pre-change baseline built from the submodule;
  `verify-resources.mjs` passes.
- `git ls-files` vs on-disk file count agree (204 files), so no vendored file
  is swallowed by ignore rules.
- `pnpm run docs check` and full `pnpm check` pass.

## Limits

- Visual acceptance of the canvas was not re-run; the equivalence argument is
  byte-identical build output, not a fresh screenshot pass.
- An upstream Bento upgrade now requires re-importing the subtrees and
  re-applying the recorded adaptations by hand; there is no automation for the
  refresh yet.
