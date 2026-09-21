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
LICENSE back to canonical Apache-2.0 (GitHub detected "Other"), sweeps
user-visible Lody residuals, renames transcript-shaped fixtures to the synthetic
`.sample.json` convention, aligns the onboarding tour's main run with the design
product, and removes the daemon's remote npm upgrade machinery end to end — the
`lody` npm package is third-party, so installing it would execute foreign code
([daemon remote upgrade removal](../simplification/2026-09-21-daemon-remote-upgrade-removal.md)).
Release and runtime-artifact hosting stays on the personal GitHub account for now
(no organization), and the first GitHub Release remains deferred until
signed/notarized artifacts exist. On 2026-09-21 the owner approved all 16 draft
specs at revision `a7a297ae` ([approval record](https://github.com/LeonEthan/molly-design/pull/52#issuecomment-5755930477));
their Status lines flip to `approved` with that link.

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
- **Fixture naming**: the ten ACP history/notification fixtures under
  `apps/cli/tests/fixtures/acp/` moved from `*.captured.json` to `*.sample.json`,
  the synthetic-fixture convention; `check-public-boundary.mjs` now rejects both
  `.jsonl` and the retired `.captured.json` suffix under fixture directories so
  transcript-shaped names cannot return.
- **Onboarding narrative**: local onboarding copy was already design-flavored and
  the coding tour never mounts on the local platform (`showsSession` gates it to
  non-local platforms; local steps are ceremony → providers → projects →
  firstTask), so the honest scope was removing dead copy and aligning the tour's
  main run: orphan `onboarding.ceremony.*` and `onboarding.firstTask.preparingAgent`
  locale keys removed (5 keys × 2), and the tour fixtures now work a design brief
  (`design.yaml`, render permission, palette subagent) instead of a test suite.
  The tour's sidebar/PR/terminal fixtures stay coding surfaces: the tour's own
  rule forbids claims its components cannot render, and cloud setup retains
  `TourStill` per `onboarding/AGENTS.md`.
- **Daemon remote upgrade removal**: the full `machine/upgrade` stack — wire
  schemas, RPC client/server, renderer token mint and settings UI, daemon handler,
  supervisor exit code 43, and npm self-install handoff — is excised, not gated;
  restart is retained. Rationale and evidence:
  [daemon remote upgrade removal](../simplification/2026-09-21-daemon-remote-upgrade-removal.md).
- **Release hosting**: releases and runtime artifacts stay under the personal
  GitHub account; no organization exists yet. Recorded here so the first Release
  runbook does not re-open the question.

## Verification and limits

- Targeted vitest runs pass for every touched area (chat-sync ×3, deep-link ×12,
  lifecycle, const ×9, RPC server/client, local session control, ACP history
  batching, machine settings panes, onboarding flow); typecheck passes for shared,
  cli, components, loro-streams-rpc and electron; `docs check` in a clean worktree
  without vendor submodules reports 0 errors; `lint:i18n` and
  `check:public-boundary` pass.
- The wire-compat `lody:`/`lody*` storage keys, `_meta.lody` fields, ACP submodule
  upstream URLs and historical note content are intentionally retained per
  `specs/lody-upstream-adoption.md`.
- Not done here: the first GitHub Release (deferred until signed/notarized
  artifacts exist; personal-account hosting). Spec re-approval landed via the
  linked owner approval; `code-review-viewer` retirement landed in
  `03a8448d`, and the E2E smoke harness was rebuilt on a scripted model wire
  with WORK-001 rescoped to the reachable product surface
  ([deterministic model wire](../testing/2026-09-21-e2e-deterministic-model-wire.md);
  issue #51 stays open until a full Daily passes).
