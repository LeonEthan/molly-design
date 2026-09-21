# Pre-release public cleanup: redaction, links, and brand residuals

Status: implemented
Translation: pending

## Abstract

A four-lane audit (branding, open-source hygiene, specs/docs, repository boundary)
plus a GitHub/CI review found the independent-release repository in good legal shape
but with concrete pre-launch gaps: main CI was red, the renderer still rejected
`molly-design://` deep links, eight files leaked local machine paths, and 17
third-party product screenshots sat in git. This change repairs CI, fixes the
deep-link scheme mismatch, redacts local paths, removes the screenshots, purifies
LICENSE back to canonical Apache-2.0 (GitHub detected "Other"), and sweeps
user-visible Lody residuals. The daemon's remote npm upgrade is disarmed because
the `lody` npm package is third-party — installing it would execute foreign code.
Deferred by design: spec approvals (human-only), GitHub Release creation (no signed
artifacts yet), onboarding-tour narrative, and full removal of the upgrade
machinery.

## What changed

- **CI green path**: chat-sync MCP tests no longer read the host's real
  `~/.molly/local-identity.json` (they pinned a temp `MOLLY_DATA_DIR`); note links
  into uninitialized vendor submodules now use pinned GitHub blob URLs, and the
  link to the gitignored esbuild artifact `molly-authoring.mjs` is de-linked.
- **Deep links**: renderer resolvers accept both `molly-design:` (what the CLI and
  main process emit) and legacy `lody:` (cloud profile) via a shared
  `isDesktopDeepLinkProtocol` helper; `auth-debug`'s `isMollyProtocol` matches the
  registered scheme; Conf stores moved from `lody-desktop` to `molly-desktop`.
- **Redaction and boundary**: local-machine evidence paths under the developer's
  home directory became `~/...`; `check-public-boundary.mjs`'s
  `internalPathPattern` gained the current machine identity with a documented
  placeholder convention; `.maka-workspace.json`, `.lody/`, `.pnpm-store/` and
  `.claude/settings.json` moved from per-clone info/exclude into `.gitignore`.
  The competitor-screenshot assets directory was removed; the research note keeps
  text captions and source URLs.
- **Links and licenses**: private `agentic-listing-design` URLs became marked
  private provenance (READMEs, source manifests, generated attributions); both
  CHANGELOGs carry a frozen-upstream-history banner; LICENSE is canonical
  Apache-2.0 again; manifests carry uniform `license` fields.
- **Brand sweep**: orphan `settings.account.cliAuth.*` locale family removed (32
  keys × 2, including the `lody start --auth` hint); three i18n fallback strings,
  tour fixture branch names, placeholder emails (`missing-email.molly.invalid`,
  legacy domain still recognized), `SITE_URL` dead default, three dead lody.ai
  modules deleted, and stale "package name stays lody" docs corrected.

## Verification and limits

- Targeted vitest runs pass for every touched area (chat-sync ×3, deep-link ×12,
  lifecycle ×10, const ×9); typecheck passes for shared, cli, components and
  electron; `docs check` in a clean worktree without vendor submodules reports 0
  errors; `check:public-boundary` passes.
- The wire-compat `lody:`/`lody*` storage keys, `_meta.lody` fields, ACP submodule
  upstream URLs and historical note content are intentionally retained per
  `specs/lody-upstream-adoption.md`.
- Not done here: spec re-approval (requires linked human approval), the first
  GitHub Release (needs signed/notarized artifacts), onboarding-tour narrative
  rewrite, `code-review-viewer` retirement decision, and full excision of the
  daemon upgrade machinery (capability gate is the minimal closure).
