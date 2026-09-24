# Harness map

| Component                                 | Responsibility                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `electron-harness.ts`                     | Isolated Electron/CLI process lifecycle, logs, traces, and teardown      |
| `hooks.ts`                                | Scenario evidence retention policy                                       |
| `resource-probe.ts`                       | Structured main, renderer, DOM, CPU, and memory snapshots                |
| `terminal-resources-probe.ts`             | Native xterm open/dispose regression without model credentials           |
| `canvas-resources-probe.ts`               | Native canvas Session recycling, isolation and heap-retention regression |
| `world.ts`                                | Cucumber adapter for the shared harness                                  |
| `world-utils.ts`                          | Stable artifact paths, port reservation, and cleanup assertions          |
| `fixtures/synthetic-review-repository.ts` | Deterministic large Git diff fixture                                     |
| `pages/onboarding-page.ts`                | First-run user interaction and local bootstrap contract                  |
| `pages/review-page.ts`                    | Review-panel project setup and observable diff interactions              |
| `pages/session-page.ts`                   | Deterministic ACP conversation and Stop lifecycle                        |
| `pages/browser-permission-page.ts`        | Scripted browser approval and private-network refusal                    |
| `pages/kimi-replication-page.ts`          | Explicit live Kimi golden replication, export and reopen acceptance      |
| `pages/work-session-page.ts`              | Worktree Session, terminal, deletion, and cleanup contract               |
| `fixtures/work-session-fixture.ts`        | Synthetic Git workspace and scripted ACP evidence                        |

The harness passes only an explicit environment allowlist into Electron. Linux
runs under `xvfb-run`, so both its `DISPLAY` endpoint and generated `XAUTHORITY`
file must cross that isolation boundary.

`router-resources-probe.ts` drives the built desktop's real router with a synthetic
scroll target. It checks that cache entries retire with native browser history while
Back/Forward, replace, a new forward branch and renderer reload preserve restoration.
Run `pnpm --filter @molly/e2e router:resources` after building. It uses no model or
session documents; assertions use route-render signals and actual scroll positions.
