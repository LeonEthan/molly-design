# Geon independent brand release residual fixes

Status: implemented
Translation: pending
[中文](../../../../.agents/notes/implemented/feature/2026-09-13-geon-independent-brand-release-residual-fixes.zh.md)

## Abstract

After the Folio→Geon rename, several product-facing surfaces still referenced Lody or the old Folio artifact names, and two CLI session marker stores were still writing under a hardcoded `~/.lody` path in local Geon builds. This note records the cleanup decisions: the marker stores now resolve through the same local data-root helper as the rest of the CLI, the fallback Git identity was aligned with the design-history author used elsewhere, user-visible Lody product references in `locales/en.json` and `locales/zh_CN.json` were rewritten as Geon, and remaining image assets were reconnected to existing Geon artwork where a suitable replacement existed. No migration was added for the short-lived marker files under the old `~/.lody` path; the rationale and limits are documented below.

## Decisions

### Local data-root paths

- `apps/cli/src/session/session-fork-operation-store.ts` and `apps/cli/src/session/worktree/speculative-worktree.ts` previously hardcoded `path.join(os.homedir(), '.lody', ...)`. They now import `getLodyDataDir` from `@lody/shared/node/installation-profile` and use `getLodyDataDir('local')`, which returns `~/.geon` in the public local profile and respects the `LODY_DATA_DIR` override used elsewhere.
- The same fix was applied to `apps/cli/src/lib/code-collab/code-collab-v2-diff-store.ts` (`getCodeCollabV2DiffStoreDbPath`) and `apps/cli/src/lib/machine-lifecycle.ts` (`DAEMON_UPGRADE_INTENT_FILE`). These were the last two literal `~/.lody` write paths in the CLI source.
- This makes all CLI durable-state paths consistent with the local installation profile and the Electron-side user-data migration that moved `~/.folio` → `~/.geon`.
- No data migration is provided for any of the moved paths:
  - Fork-operation and speculative-worktree markers are short-lived operational records.
  - The daemon-upgrade-intent file is a transient signal consumed once and deleted.
  - The Code Collab diff store is local-only derived evidence (turn diffs can be recomputed/repopulated by new turns). An old database under `~/.lody` will not be read after the update, but the retained content is not user-authored source data. This trade-off keeps the change small and avoids one-off migration logic for transient or rebuildable state.

### Git identity alignment

- `apps/cli/src/session/git-identity.ts` previously fell back to `LodyAI <agent@lody.ai>` when no usable host or requested identity existed.
- It now falls back to `Geon <geon@localhost>`, matching the fixed author already used in `apps/cli/src/design/history.ts` for design-history commits.
- The same fallback was also updated in `apps/cli/src/session/worktree/worktree-manager.ts` for initial-commit creation.

### Locales

- All 26 product-identity references to "Lody" in `locales/en.json` and the corresponding 27 in `locales/zh_CN.json` were changed to "Geon". Examples include welcome titles, desktop-app labels, the bug-report team name, and the hard-reset description.
- `localProjects.add.noMachinesDescription` was rewritten to describe Geon's embedded Agent runtime rather than a standalone "Lody CLI", because Geon no longer ships a separate CLI product.
- `settings.integrations.github.missingReposHint` was changed to a neutral "the GitHub App" wording. A search across `packages/platform`, `packages/shared`, and `apps/electron` found no hardcoded GitHub App registration name, slug, or client ID; without evidence of a renamed Geon App, the text avoids asserting a specific App name. This is tracked as an external dependency: a Geon GitHub App must be registered/renamed on the GitHub side before any branded App name can be claimed in user-facing copy.
- Protocol names (`lody://`), package names (`@lody/*`), environment variables (`LODY_*`), the `_meta.lody` protocol field, upstream attribution, and license ownership were left unchanged per the namespace-layer decision in the parent rename note.

### Asset reconnection

- `packages/components/src/components/pages/desktop-checkout-return-page.tsx` and `packages/components/src/components/pages/email-verified-page.tsx` now import `geon-icon.png` instead of `lody-icon.png`, with `alt="Geon"`.
- `packages/components/src/components/settings/usage-calendar-model.ts` still imports `lody.svg` as a raw path string and parses a single `d` attribute for 3D logo relief. `geon-mark.svg` consists of multiple separate paths and is not a drop-in replacement without parser changes, so the Lody SVG was retained and is called out as a remaining legacy asset.

## Evidence and links

- Independent release proposal: [proposed/feature/2026-09-13-geon-independent-brand-release](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md).
- Parent rename decision: [implemented/feature/2026-09-13-geon-rename](2026-09-13-geon-rename.zh.md).
- Issue: [#32](https://github.com/LeonEthan/Geon/issues/32).
- Installation identity rule updated in [packages/shared/AGENTS.md](../../../../packages/shared/AGENTS.md).

## Verification and limits

- Targeted tests run:
  - `apps/cli/src/session/session-fork-operation-store.test.ts`, `apps/cli/tests/git-identity.test.ts`, `apps/cli/src/session/worktree/speculative-worktree.test.ts` (21 tests passed).
  - `apps/cli/src/lib/code-collab/code-collab-v2-diff-store.test.ts`, `apps/cli/src/lib/machine-lifecycle.test.ts` (passed).
- Typechecks passed for `lody`, `@lody/components`, `@geon/design-authoring`, and `@lody/shared`.
- Static checks passed: `corepack pnpm lint`, `node scripts/check-i18n.mjs`, `node scripts/check-platform-boundaries.mjs`, `node scripts/check-public-boundary.mjs`, `node scripts/check-code-collab-imports.mjs`; `corepack pnpm format` was run.
- `node scripts/docs/main.mjs check` was run at the end of the work.
- Limit: the `lody.svg` asset remains in use by the usage-calendar 3D relief parser; replacing it would require extending the parser to compose multiple paths from `geon-mark.svg`. The old `~/.lody` directories for the moved paths are not migrated and may be left on disk as orphaned transient/derived state.
