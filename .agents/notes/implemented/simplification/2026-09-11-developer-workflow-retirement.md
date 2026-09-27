# Developer workflows leave the design product

Status: implemented
Translation: pending

## Abstract

Folio's inherited PR and code-review UI could start remote queries and automated
review/merge work unrelated to local design. T24 removes those product entries and
their dedicated background engines, while keeping file presentation, Agent tools,
process recovery and historical records. The consumer audit distinguishes generic
worktree configuration from PR actions; that configuration remains for T25. This
record does not claim GitHub-related types or repository engineering CI were removed.

## Decision and consumer audit

The boundary follows [the design Spec](../../../../specs/graphic-design-platform.zh.md)
and [the convergence decision](../../proposed/simplification/2026-09-11-design-workflow-convergence.zh.md).

| Retired entry                          | Subscription/background path                                                                                             | Dependency disposition                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| GitHub settings and install callback   | Integrations auth/query components; settings-only repository preload                                                     | Remove integrations components; old URLs redirect without auth hooks                        |
| Sidebar legacy PR badges/hover actions | TaskList/Updated rows and SessionInfoCard consume durable metadata only                                                  | Remove PR/CI presentation and navigation; keep session/file context and raw durable records |
| Session PR quick actions and panel     | PR details/check-run polling; PR comment fetch/write in diff panel                                                       | Remove hooks and container; preserve generic file/diff rendering                            |
| Automatic review settings/menu/banner  | Fleet review workspace subscriptions, reviewer session creation, CI/merge actions; `lody_review_submit` MCP registration | Remove engine and poller modules; tolerate durable legacy fields                            |
| PR status badges' background producer  | Fleet PR scheduler, workspace metadata/presence registrations, GitHub credential harvesting, dedicated scheduling store  | Remove runtime graph; leave existing database/cache files untouched                         |
| CLI `review` command                   | On-demand remote standalone viewer download                                                                              | Remove CLI helper/viewer dependencies and update lockfile; engineering packages/CI remain   |

Retained consumers are concrete: settings `project-settings.tsx` still reads
`workspaceReposWithStatus` for existing worktree setup/cleanup configuration. The
session/file services still resolve existing local and Git workspaces, including
historical sessions; `resolveCodeCollabWorkspaceRoot`, workspace watching and file
preview are not review-only. Generic delegated task automation, Agent execution,
permissions, diagnostics, rendering preview, image reading, attachment previews,
process cleanup and recovery remain separate paths. Session PR metadata and review
Flock schemas remain readable; this change neither rewrites history nor deletes
working directories. **Factual correction (T25):** the local owner UI organization query and the
post-removal worktree-file lookup were independent events, not an IPC auth call
chain; see [the T25 audit](2026-09-11-design-without-git-ide.md#factual-correction-to-the-earlier-smoke-interpretation).

Removing only visible buttons would leave polling and automatic merge work alive.
Deleting every module named review or Git would instead break ordinary file
consumers and history. The chosen cut removes execution roots and exclusive leaves.
The repository's own engineering workflows and standalone review package tooling are
not product runtime entries and remain unchanged. Some leaf presentation components
still have Storybook fixture consumers (for example `PrTabView` and `AutoReviewStatus`),
so this change removes their production mounts rather than claiming those fixtures
are generic design features. Normal history text and user-authored links remain readable.

## Verification

`corepack pnpm check` passed, including 2,604 CLI tests (4 skipped), 3,342
component tests, and the public/platform/import boundary checks. The targeted MCP
suite passed 79 tests across registration, image and rendering tools; the new
in-memory `tools/list` assertion verifies generic session tools remain published
without `lody_review_submit`. Required formatting and docs checks passed.

The actual local desktop build succeeded. The isolated Electron smoke passed all
3 scenarios / 18 steps with the accepted synthetic worktree fixture from `72a4065`
(to ignore only materialized bundled design skills); that fixture is not changed
by T24. A native probe separately exercised fresh local bootstrap, skipped Agent
configuration, the usable `#chat-prompt`, and the Settings dialog with no GitHub or
Review agent entry. Legacy GitHub settings navigation resolves back to local chat
under the existing local route guard. Probe artifacts are temporary and excluded
from public source. The probe uses both canonical data directories, a unique CLI
endpoint, and the Electron package directory; teardown verified endpoint release.

The final built CLI help also verifies `review` and `github` are absent while
`project` and `session` remain. A rendered metadata-card regression and sidebar
tests cover legacy PR fields without restoring PR navigation.

No real model/provider call or packaged-release installation was exercised. These
checks establish retained local startup/settings and deterministic generic tool
contracts; they do not replace final combined design acceptance.
No paid Agent calls, remote publication, user-history migration or user-file cleanup
are part of this change.
