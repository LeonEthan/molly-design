# Desktop E2E contributor guidelines

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only. Root `AGENTS.md`
also applies.

## Runtime boundary

- Application E2E always launches the built OSS desktop through Playwright
  Electron. A browser-only renderer test belongs in `packages/components`.
- Build once before a run. Scenarios consume `apps/electron/out/main/index.js`
  and the synced CLI under `apps/electron/resources/cli`; they never rebuild.
- Installed acceptance uses the same harness with an explicit executable and
  expected source commit, consuming the package's own entry and resources.
  Read [installed launch instructions](README.md#installed-molly-design-acceptance)
  before selecting that target; preserve the same profile and endpoint isolation.
- Use a real Electron main process, preload, renderer, IPC graph, and bundled
  CLI. Only an external model/provider wire may be simulated.
- Every run owns a temporary Electron user-data directory, Lody data directory,
  workspace, artifact directory, and CLI host endpoint. `MOLLY_E2E=1` and the
  random TCP port on POSIX or unique named pipe on Windows must travel together
  to Electron and all CLI descendants. Never kill or attach to a user's
  existing Lody process.
- Harness restart reuses only its own durable directories after verified process
  and endpoint teardown. It pins the original executable/source target and reserves
  a fresh endpoint; any teardown failure stops restart and retains failed evidence.
- Review-profile export requires a verified launch and successful owned process/endpoint
  teardown before copying to a new external directory. Never overwrite a review
  destination or copy live storage; retain source evidence on export failure.
- Run scenarios serially until every remaining fixed OS endpoint has an
  explicit shared test binding. Do not raise Cucumber parallelism first.

## Scenario contract

- `journeys/registry.json` is the machine-readable source of truth for active
  journeys and evidence-backed gaps. `COVERAGE.md` is generated from it; never
  edit the matrix by hand. Every executable scenario has exactly one matching
  `active` registry row with the same id, priority, runtime, and feature path.
- Backlog scoring is deterministic. A candidate's semantic fingerprint covers
  its runtime, fixture, ordered actions, checkpoints, and cleanup. Keep blocked
  gaps in the registry with an actionable `blockedReason`; selection skips them
  instead of blocking the rest of the queue.
- Local authoring claims at most one backlog row per run. Codex works in an
  ephemeral detached worktree and cannot edit product code, harness policy, the
  registry, or generated coverage. It packages a candidate without executing
  generated code. After explicit human review, a second ephemeral worktree
  promotes the row, proves one assertion ablation fails, restores exact file
  hashes, and runs three fresh focused rounds plus the full suite. Only a passed
  candidate is applied to the maintainer checkout. Neither command publishes it.
- Every scenario has `@lody`, `@essence`, exactly one of `@P0` or `@P1`,
  exactly one `@runtime-*` owner, and one stable `@LODY-AREA-NNN` id.
- `@P0` is a short merge-blocking journey. `@P1` is a deeper scheduled or
  labeled journey. `@runtime-none` means no ACP model runtime is needed; it
  does not mean the bundled CLI may be mocked.
- Do not commit `@wip` scenarios. Keep Gherkin steps thin and put selectors and
  interaction policy in Page Objects.
- Prefer accessible roles and stable product-owned test ids. Never select by
  generated class names or animation timing.
- Await observable state or an explicit protocol response. Real sleeps,
  wall-clock races, retries that hide failure, and live network calls are
  forbidden in deterministic regression. The explicitly authorized real Kimi golden
  acceptance lane uses the live model, retains failed rounds, and never retries a
  paid image request automatically; see `KIMI-REPLICATION-ACCEPTANCE.md`.

## Evidence and lanes

- Regression E2E is deterministic and blocking. On failure, retain the
  screenshot, Playwright trace, renderer/main logs, CLI backlog, process and
  memory snapshot, and machine-readable failure index.
- Daily regression records each scenario independently, deletes passing videos,
  and retains one `failure.webm` per failed scenario. It runs one macOS
  and Windows matrix per suite; the failure-issue reconciler treats the macOS
  artifact as canonical evidence until the Windows leg proves stable. The
  read-only runner only
  uploads evidence; a trusted default-branch reconciler validates recordings and
  posts independently retryable Daily comments linking to the Actions artifacts.
  The Actions token must not be used for unsupported inline attachment uploads;
  keep recordings in the bounded artifact without adding a personal token.
  Only a successful full Daily may close that Issue; smoke success never clears
  failure state that can include P1 coverage.
- Pull-request regression also records scenarios and retains failed videos. Its
  read-only runner uploads evidence; a trusted default-branch reconciler may
  validate that artifact and attach it only to the current matching PR head.
- Acceptance is a separate immutable round. It captures successful user-visible
  checkpoints and metrics for human review; a later repair creates a new round.
- Scout is a separate non-blocking soak lane. It may reuse this harness and Page
  Objects, but it owns repeated execution, explicit GC checkpoints, slope
  analysis, and diagnostic heap capture. Never put soak thresholds in `@P0` or
  `@P1` regression scenarios.
- Runtime artifacts under `e2e/artifacts/` are ignored. Fixtures committed to
  the suite must be synthetic and contain no user or agent transcript.

Run `pnpm e2e:check` after changing suite metadata and `pnpm e2e:build && pnpm
e2e:smoke` after changing the harness or an active P0 journey.
