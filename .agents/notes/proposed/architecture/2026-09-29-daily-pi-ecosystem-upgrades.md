# Daily, unmodified Pi ecosystem upgrades

Status: proposed
Date: 2026-09-29
Translation: pending
PR: [#53](https://github.com/LeonEthan/molly-design/pull/53) (draft)

## Abstract

Molly now composes Pi 0.87.1 and its admitted MCP adapter through public APIs and an exact named catalog, with a daily dependency-update pipeline and no adapted vendored add-ons. Execution-time file authorization, public resource loading, synthetic model fixtures and explicit replacement of removed models remove the upgrade coupling identified below. The published sandbox/auto-review stack did not meet admission requirements, so Molly retains its own sandbox and review implementation. Automated local checks passed; Spec approval, live design acceptance, installed-app validation and hosted workflow operation remain one manual review batch. Fresh signed releases can still contain malicious code, and old-to-new session compatibility does not establish safe app rollback.

## Implementation and batch review, 2026-09-29

The implementation below supersedes the initial unverified assumptions in the proposal that follows. The eight work areas are delivered together in one draft PR for the requested batch review, instead of eight dependent draft PRs. The decision record remains `proposed` while under review; changed Specs remain `draft`, and their Chinese counterparts are marked stale.

| Plan area | Implemented outcome |
| --- | --- |
| 1. Intent | Harness and design Specs adopt daily, unmodified public composition; owning instructions and implementation docs follow that contract. |
| 2. File boundary | Public file operations authorize the actual absolute path Pi resolves, including variants and dangling symlinks. PR #52's journal isolation and narrowed temp roots remain. |
| 3. Upgrade-resistant tests | Public synthetic model registration, transcript system messages and valid synthetic image fixtures replace model-catalog and transcript-shape assumptions. |
| 4. Daily pipeline | Named `pi` catalog, installed-SDK-derived versions, scoped release-age exemptions, npm signature/lock-integrity verification, daily grouped Dependabot updates, check-gated merge and three-day reassessment workflow. Initial set is Pi 0.87.1 plus pi-mcp-adapter 3.2.0. |
| 5. Public loading | Configured `DefaultResourceLoader`, explicit discovery-free inputs, normal inline host-context factory, and Pi-loaded MCP TypeScript entry without package rewriting. |
| 6. Questions | Original Molly question extension uses supported dialogs and retains negotiation, run binding, awaited dismissal and timeout/cancel behavior. Vendored question code is removed. |
| 7. Auto-review | Published stack evaluated and rejected at admission; Molly owns its prompt and strict result schema. Vendored review code is removed. |
| 8. Continuation | Missing explicit model stays visible until the user selects a replacement; the same native session continues. A synthetic Pi 0.85.1 session fixture covers old-to-new restore. |

### Reuse and decisions

Existing host approvals, run journals, sandbox operations, question dialogs, model picker and native session storage remain the implementation boundaries. Public Pi operations and `DefaultResourceLoader` replace copied normalization and resource-loader behavior. The published MCP adapter stays unchanged; Pi loads a separate Molly entry that exposes its public factory through the session-local public event bus. Worker `HOME`/`USERPROFILE` are private, while sanitized tool children and the sandbox credential deny list receive the real home explicitly.

Dependabot was selected over a new updater because it [supports pnpm workspace catalogs](https://github.blog/changelog/2025-02-04-dependabot-now-supports-pnpm-workspace-catalogs-ga/). Existing daily desktop E2E is reused as a callable workflow. The merge workflow runs trusted default-branch code without checking out PR code and restricts itself to same-repository Dependabot dependency-only changes with matching tested head/base and successful checks. Main was unprotected and repository auto-merge disabled at inspection, so this uses the gated merge API without changing repository settings. Hosted operation remains unverified until the workflows exist on main.

The unconfirmed peer-warning refinement is not adopted: incompatible declared Pi peers fail the gate. A daily health check surfaces grouped update PRs still open after three days for reassessment; essential adapters are never dropped automatically. The initial install required no fresh-transitive age exemption. New blocked transitive releases fail visibly and require a scoped decision. Explicit npm registry signatures plus lock integrity were chosen over changing pnpm versions for `trustPolicy`; all direct catalog entries and newly staged package versions relative to the PR base are verified. This proves package identity/integrity, not publisher trustworthiness or provenance of source builds.

### Published add-on trial

An isolated installation loaded unmodified `@erichll/pi-sandbox` 0.21.1 and `@erichll/pi-auto-review` 0.21.0 with their peers under Pi 0.87.1 and a private `HOME`. Pi's public loader reported no extension load errors. The sandbox registered `bash` and `subagent`; review registered `policy-audit`, `auto-review-approve` and `break-glass` commands. Molly's actual resource-loader admission guard rejects the stack with `harness_extension_tool_collision` because the host owns `bash` authorization. Adopting the extra subagent execution path would also expand this migration's scope.

Published auto-review source inspection additionally found that a denied review blocks the tool and points to approval/break-glass commands rather than falling back to Molly's supported user-approval dialog. The stack therefore cannot preserve the required behavior through the current public configuration. The plan's Molly-owned fallback was selected; no dependency is patched. The full third-party sandbox behavioral suite and live design run were not performed after admission failed. The retained Molly implementation's synthetic auto-review suite passes, and its live design acceptance is deferred to the batch below.

### Automated evidence

- `pnpm install`, `pnpm check`, `pnpm format`, public/platform boundary checks and `pnpm run docs check` passed. Documentation checking reported no errors; size warnings are not approval.
- All 235 harness tests passed on Pi 0.87.1 and in an isolated Pi 0.85.1 baseline copy. This includes actual final-path operations, questions, synthetic provider contracts, cancellation, accounting and previous-session restore.
- Model-selection/UI regressions passed (21 tests across two focused files). Registry-signature unit tests cover authentic signatures, changed identity/integrity and missing trust material.
- Signature and lock-integrity checks passed for all 23 new or updated packages in the staged Pi closure. The ordinary staged runtime contained 241 packages; its manifest verification passed.
- Packaged offline question/compatible-model/protected-MCP smoke passed under both Node and Electron's Node. Pi loaded the unchanged MCP adapter's TypeScript entry in that packaged layout.
- The rebuilt local macOS desktop passed all six existing full E2E scenarios (37 steps). Windows hosted E2E and final signed installers were not run locally.
- The required advisory Codex CLI opinion was unavailable: the initial read-only call failed app-server startup with `EPERM`, and the later review command rejected the `--sandbox` argument placement. No independent opinion was obtained, and neither failed call was automatically retried.

### Windows CI follow-up

The first hosted run passed static checks, tests, Pi harness checks, macOS full E2E and all design-resource builds. Windows full E2E stopped during CLI build with `Unsupported embedded harness manifest`: package inventory paths used native backslashes while the new engine-version verifier looked up a forward-slash path. File resource paths already used forward slashes. The fix reuses that existing normalization for package inventory paths and the engine lookup, keeping the manifest portable without weakening verification. The optional native-addon install warnings were not the failing build step. Local bundle generation and manifest verification passed normally and with Windows-style relative-path separators injected into the builder. Hosted Windows validation of this correction is pending.

### Single manual review and validation batch

- [ ] Review the completed diff and draft Specs together: public-only composition, strict peer gating, the Molly-owned fallback, release-age/signature trade-off, and guarded automatic dependency merges. Obtain independent review; none was produced by the failed CLI attempts.
- [ ] Run one real design session in the finished app with an explicitly selected model: normal sandboxed shell, outside-boundary escalation, classifier deny/failure/timeout to user approval, cancellation without approval, question selection/custom answer/multiselect/dismissal, preview/image reading, and generate/edit with an explicit image model. Respect the five-call image budget unless a larger budget is authorized.
- [ ] Resume an existing native session whose model is missing, choose a replacement, and verify continuation in that same session without an automatic model fallback or restart.
- [ ] Observe one hosted grouped Dependabot update: latest catalog edits, signature/peer failures if applicable, complete macOS/Windows E2E gates, matching-head/base merge behavior and a blocked-update reassessment. Local checks do not prove GitHub scheduling or merge execution.
- [ ] Validate the final installer and any intended rollback using preserved session files. The previous-release fixture proves old-to-new loading only; it makes no new-to-old format guarantee.


## Owner decisions, 2026-09-29

Recorded from the owner's working session; no GitHub approval link exists yet.

1. Pi and its companion packages update to the latest version almost daily.
2. Every Pi add-on, now and in the future, is used unmodified and follows the same daily updates. Vendored adapted copies are retired.
3. The release-age trade-off is accepted: fresh releases may enter without the seven-day wait, with other checks instead.
4. The harness Spec adopts this new intent; it stays `draft` until approved again.

The owner also accepted the four follow-up recommendations:

- **A. Daily means main, not releases.** A dependency PR auto-merges to `main` when all checks pass. Desktop releases keep their own schedule.
- **B. Pi wins.** If an add-on still does not accept the newest Pi after three days, it is reconsidered or dropped.
- **C. Trial the published sandbox/auto-review stack first.** `@erichll/pi-sandbox` + `@erichll/pi-auto-review` are evaluated in Molly's worker, and the result decides whether they replace Molly's auto-review.
- **D. Molly owns a small question extension.** No published question add-on works in Molly's non-terminal UI.

## Problem and evidence

### Current coupling points

| Coupling                                                | Where                                                                                                                                                 | Effect on a daily update                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `minimumReleaseAge: 10080` (7 days)                     | [pnpm-workspace.yaml](../../../../pnpm-workspace.yaml)                                                                                                | pnpm refuses any release younger than a week; exceptions are exact versions added by hand |
| Literal `'0.85.1'`                                      | `apps/cli/scripts/build-embedded-harness.mjs`, `verify-embedded-harness.mjs`, `apps/electron/scripts/eb-after-pack.mjs`                               | Every bump fails the build until three scripts are edited                                 |
| Exact versions in one package manifest                  | [packages/harness-pi/package.json](../../../../packages/harness-pi/package.json)                                                                      | Four Pi-family entries edited in step by hand                                             |
| Vendored adapted add-ons                                | `packages/harness-pi/vendor/pi-ask-question`, `vendor/pi-auto-approval`                                                                               | Forks with hash manifests; they never receive upstream fixes                              |
| Build-time rewrite of `pi-mcp-adapter`                  | `build-embedded-harness.mjs` (esbuild compile, adjusted staged entry points)                                                                          | A per-version packaging step for an add-on Pi can load itself                             |
| Hand-built internal `Extension` object                  | [resource-loader.ts](../../../../packages/harness-pi/src/resource-loader.ts)                                                                          | Breaks, or silently misbehaves, when Pi changes the internal shape                        |
| Full custom `ResourceLoader` implementation             | `MollyResourceLoader` in the same file                                                                                                                | Breaks when Pi adds interface methods                                                     |
| Mirrored Pi 0.85.1 read-path variant list               | [auto-review-policy.ts](../../../../packages/harness-pi/src/auto-review-policy.ts), draft [PR #52](https://github.com/LeonEthan/molly-design/pull/52) | A new Pi can change the list with no error, silently weakening a security check           |
| Tests reading Pi transcript shape and catalog model IDs | `packages/harness-pi/tests/*`                                                                                                                         | Fail on routine upstream changes unrelated to Molly behavior                              |

### Trial bump to Pi 0.87.1 (reverted)

Run on 2026-09-29 in a worktree; the change was reverted and the lockfile restored.

- Without an override, pnpm refused Pi 0.87.1 (published 2026-09-22 19:42 UTC) under the seven-day gate.
- With the gate disabled for that command, `@molly/harness-pi` production sources compiled. Type errors appeared only in tests.
- 24 of 233 harness tests failed:
  - Pi moved the system prompt into the transcript context (`TranscriptContext` has no `systemPrompt`), and test stubs read `context.systemPrompt`.
  - Tests pinned catalog model IDs (for example `kimi-k2-0711-preview`) that Pi's bundled catalog no longer contains, giving `harness_model_not_in_catalog` or `harness_thinking_level_unsupported`.
  - Pi changed oversized inline-image handling, and a five-byte synthetic image is now omitted.
  - One personal-memory cancellation test timed out; the cause was not investigated.

This establishes the upgrade friction for one real jump. It does not establish runtime correctness on 0.87.1, packaged behavior or provider behavior.

### Published add-on facts (npm metadata and tarball inspection, 2026-09-29)

| Package                          | Pi requirement                                   | Relevant behavior                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pi-mcp-adapter` 3.2.0           | `pi-ai` `^0.84.1 \|\| … \|\| ^0.87.0`            | Already used unmodified; its range excludes Pi 0.88 until a new adapter release                                                                                                |
| `pi-ask-question` 0.1.0 (npm)    | `>=0.84.0 <1`                                    | Only `ui.custom` (a terminal component); the vendored copy is a different GitHub version (0.4.0) rewritten to use dialogs                                                      |
| `pi-auto-approval` 0.1.1         | `*`                                              | Own `tool_call` gate, own `select`/`input` approval UI, model selector that writes `~/.pi/agent/models.json`                                                                   |
| `@erichll/pi-sandbox` 0.21.1     | `^0.87.1`; peers `pi-subagents`, `typebox`       | `tool_call`/`tool_result`/`user_bash` hooks, two tools, config under `~/.pi/...` via `homedir()`, depends on `@anthropic-ai/sandbox-runtime` and `@erichll/pi-auto-review`     |
| `@erichll/pi-auto-review` 0.21.0 | `^0.87.1`; peer `@gotgenes/pi-permission-system` | Config and a SQLite policy audit under `~/.pi/...`, `auto-review-approve`/`break-glass`/`policy-audit` commands; uses `select`/`confirm`/`input`/`notify` and some `ui.custom` |

Pi's public file tools already expose the extension point Molly needs: `createRead/Write/EditToolDefinition(cwd, { operations })` call `ReadOperations`/`WriteOperations`/`EditOperations` with the final absolute path after Pi's own normalization. Pi probes read-path variants with direct `fs.access` (existence only) before it calls `ops.access`/`ops.readFile` on the chosen path. `ToolDefinition.execute` receives the `toolCallId`. Molly already constructs these three definitions in [approved-tools.ts](../../../../packages/harness-pi/src/approved-tools.ts) and already uses the same pattern for bash (`BashOperations`).

## Principles

**Unmodified means:**

- Allowed: choosing a published package and version; configuring it through its own config files, environment variables and Pi settings; composing sessions from Pi's public API; Molly's own separate extensions.
- Not allowed: vendored or adapted copies, dependency patches, importing an add-on's non-exported files, build-time source rewrites, or intercepting an add-on's transport.

**Molly's glue uses public extension points only.** When Pi offers a public hook, Molly uses it instead of copying behavior. Tests assert Molly's observable behavior with Molly-registered synthetic models, not Pi's internal data shapes or catalog contents.

**Keep what already serves this:** exact versions recorded in the lockfile (each daily update is still reproducible and revertable), public-SDK-only imports, the generated packaged-resource manifest, and the unmodified `pi-mcp-adapter`.

## Proposal

### 1. Version-set policy

"Latest" is a compatible set, not one number. The daily job selects the newest Pi version accepted by every admitted add-on's peer range, plus the newest version of each add-on.

Under decision B, if an add-on's range still excludes the newest Pi after three days, the add-on is reconsidered or dropped.

Proposed refinement for owner confirmation: a peer-range mismatch alone is not a failure. pnpm installs with a warning, so the job tries the newest Pi anyway. If all checks pass, the set is accepted unchanged. The three-day clock starts only when checks fail. This matters for `pi-mcp-adapter`: dropping it would remove image generation and browser research, so for an essential add-on the owner decides explicitly rather than the rule dropping it automatically.

### 2. Update pipeline

- **One version source.** Move the Pi packages and admitted add-ons into a named pnpm catalog. The harness build reads the engine version from the installed `@earendil-works/pi-coding-agent/package.json`. `verify-embedded-harness.mjs` and `eb-after-pack.mjs` compare against the built manifest instead of a literal.
- **Release age.** Exempt the Pi family and admitted add-ons from `minimumReleaseAge` by name. Fresh transitive dependencies of a new Pi release are not covered by a name exemption and would still be blocked. The first PR measures how often this happens and chooses between listing them or a narrower policy.
- **Integrity instead of age.** Verify registry signatures/provenance for the updated packages in the update job. Candidates are pnpm `trustPolicy: no-downgrade` (needs a pnpm version newer than the repo's 10.20; to verify) or an explicit signature check step.
- **Automation.** Reuse Dependabot (native to GitHub) with a daily group for the catalog, falling back to Renovate if Dependabot's pnpm catalog support is insufficient. Neither is configured today.
- **Gate.** The update PR runs `pnpm check`, the harness tests, the packaged offline smoke (`smoke-embedded-harness.mjs`) and the existing daily E2E. Auto-merge to `main` when all pass (decision A). Read [workflow security](../../../../.github/workflow-security.md) before adding the workflow.
- **Failure handling.** Fix only Molly glue; report upstream; remain on the last green set. Never patch.

### 3. Add-on admission rules

An add-on is admitted only when all hold:

1. Published on npm, with an acceptable license.
2. Its interaction works in Molly's non-terminal UI, which supports `select`, `confirm`, `input` and `notify` but not `editor` or `ui.custom` terminal components.
3. Its config and state can be pointed at Molly's private worker directories through configuration alone (for example, a private `HOME` for the worker). No user-level or project-level Pi config is read.
4. Its peer range follows Pi releases within days.

Add-ons are loaded by Pi's own extension loader (Pi ships `jiti` for TypeScript sources), not recompiled by Molly. The extension selection is an explicit list in Molly's build; discovery stays off.

**Isolation from the user's own Pi.** Molly keeps embedding the Pi SDK in its own worker process (`createAgentSession`). It never launches or reads a locally installed `pi`, and its bundled version is independent of the user's version. Pi's own paths are already redirected: `agentDir` and `PI_CODING_AGENT_DIR` point to Molly's private root, and settings, sessions, model cache and credentials never use the user's `~/.pi`. However, the worker currently inherits the real `HOME` ([environment.ts](../../../../packages/harness-pi/src/environment.ts)). An add-on that resolves `homedir()` directly, as `@erichll/pi-sandbox` and `pi-auto-review` do, would therefore read and write the user's real `~/.pi` config and audit database. That is a conflict with the user's own Pi, and it is why rule 3 exists.

A private worker `HOME` fixes this only if two current dependents on the real home are made explicit first:

- Molly's sandbox computes denied credential paths from `homedir()` ([sandbox.ts](../../../../packages/harness-pi/src/sandbox.ts)). A private `HOME` would silently move that deny list away from the real credentials. The real home must be passed in explicitly.
- Tool children inherit `HOME` through `createToolEnvironment`. They must keep the real home so `git`, `npm` and similar tools behave as before.

### 4. Moving glue onto public extension points

- **File boundary at execution (replaces PR #52's mirrored list).** Pass Molly `ReadOperations`/`WriteOperations`/`EditOperations` to the existing tool definitions. Each operation checks the final absolute path it receives against the workspace and allowed roots.
  - Outside the boundary, the operation requests review with the real path. It finds its tool call through an `AsyncLocalStorage` context set by a thin wrapper around the definition's `execute(toolCallId, …)`.
  - This lands authorization on the execution path, as the Spec requires, and removes the need to predict Pi's path rewriting.
  - Limit: Pi's variant probing still checks whether outside paths exist before any operation runs (existence only, no content).
  - The run-journal fix and the narrowed temp allowance from PR #52 are kept.
- **Prompt context.** Replace the hand-built internal `Extension` object with a normal inline extension factory using the public `before_agent_start` hook, placed last.
- **Resource loading.** Replace `MollyResourceLoader` with Pi's `DefaultResourceLoader`, configured with an explicit system prompt and no discovery. Earlier review found that `noContextFiles` alone does not disable `SYSTEM.md`/`APPEND_SYSTEM.md` discovery.
- **Tests.**
  - Register a synthetic provider/model per test instead of relying on Pi's catalog.
  - Read the system prompt from the transcript messages.
  - Use image fixtures that Pi's current limits accept.

### 5. Auto-review trial (decision C)

Load the published `@erichll/pi-sandbox` and `@erichll/pi-auto-review`, with their required peers, unmodified in a Molly worker with a private `HOME`, and run the synthetic auto-review suite plus one manual design run.

Proposed non-negotiable guarantees (owner to confirm):

| Guarantee                                                                                                          | Why                                                 |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Shell runs in the OS sandbox: writes only workspace/temp; credential and Molly private-data reads denied           | Core security boundary                              |
| Unknown network destinations and out-of-sandbox commands are escalated                                             | Core security boundary                              |
| Classifier deny, failure or timeout asks the user; cancellation never prompts or approves                          | No silent consent                                   |
| Classifier model calls go through Molly's registered provider, so every HTTP attempt is journaled before transport | Honest usage accounting; credentials stay in memory |
| No config, audit database or credential outside Molly's private root                                               | Isolation from the user's own Pi                    |
| Every interaction on the approval path uses dialogs Molly supports                                                 | Admission rule 2                                    |

Proposed negotiable, meaning the add-on's behavior can replace Molly's:

- The exact decision record format. Provenance still has to be recorded somewhere Molly can show.
- The wording of diagnostic categories.
- Grant scoping details.

Browser site grants use `pi-mcp-adapter`'s approval event and currently call Molly's classifier. If the add-on replaces the classifier, the trial must show how a first site grant is classified through a public API; otherwise browser grants keep a small Molly-owned classifier.

**Outcome:**

- If the guarantees hold through configuration, delete Molly's `sandbox.ts`, the `auto-review*` modules and the vendored `pi-auto-approval`.
- If not, keep auto-review as Molly-owned code with its own prompt and delete only the vendored copy.

Either way `vendor/pi-auto-approval` is removed.

### 6. Question tool (decision D)

Write a small Molly-owned extension that registers `ask_question` using `ctx.ui.select`/`input`, keeping today's host behavior: negotiated question UI, run/epoch binding, awaited dismissal, and no answer on timeout/cancel. Its code is Molly's, not a copy; it takes no upstream hash. Delete `vendor/pi-ask-question`. Adopt a published add-on instead if one later meets the admission rules.

### 7. Routine consequences of daily updates

- **Models leave the catalog.** A saved session whose model disappears currently fails with `harness_model_restore_incompatible`. Show a clear message and let the user choose another model and continue the same session. There is still no automatic fallback, which is consistent with the Spec's explicit-selection rule.
- **Native session forward compatibility.** Newer Pi may write session files an older Molly cannot read, which matters for app rollback. This is unverified; add one test that opens the previous release's session fixture on the new Pi, and document rollback limits.
- **Add-on abandonment.** Handled by the admission rules and decision B.

### 8. Rules and Spec changes

- [Harness Spec](../../../../specs/molly-embedded-pi-harness.md) (already `draft`), and its `.zh.md` counterpart marked stale:
  - Replace "engine baseline is Pi v0.85.1 … pinned at build time" and "community native plugins must be reviewed, version-pinned" with the daily-update, unmodified-composition intent.
  - Drop "the Pi SDK upgrade is deferred".
  - Keep the closed-loading and isolation intent.
- [Generative layered design Spec](../../../../specs/generative-layered-design-workflow.md): the auto-review description ("vendored `pi-auto-approval` … curated", "pinned, and upgrades need review") changes after the trial decides section 5. That revision returns the Spec to `draft`.
- [harness-pi AGENTS.md](../../../../packages/harness-pi/AGENTS.md):
  - Replace "Import the pinned public SDK" and "Curated source changes require reviewed provenance/hash updates" with "public SDK only; add-ons unmodified and admitted by the rules in this note".
  - Keep the rest.

## PR sequence

Each PR is a small draft PR with its own checks; later PRs depend on earlier ones.

| #   | Scope                                                                                                                                                           | Verification                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | This note, Spec draft revision and `AGENTS.md` intent                                                                                                           | `pnpm run docs check`                                                                      |
| 2   | Rework PR #52: keep journal isolation and temp narrowing; replace the mirrored path list with execution-time operations                                         | Existing auto-review tests plus real-path cases (`file:`, `~`, variants resolving outside) |
| 3   | Tests decoupled from Pi internals (synthetic models, transcript system prompt, fixtures)                                                                        | Suite green on 0.85.1 and on a trial 0.87.x install                                        |
| 4   | Update pipeline: catalog, derived engine version, release-age exemption, integrity check, Dependabot group, auto-merge, first bump to the newest compatible set | `pnpm check`, harness tests, packaged offline smoke                                        |
| 5   | Public extension points: inline prompt-context factory, `DefaultResourceLoader`, Pi-loaded `pi-mcp-adapter` without the esbuild rewrite                         | Harness tests, packaged smoke inside Electron's Node                                       |
| 6   | Molly-owned question extension; delete `vendor/pi-ask-question`                                                                                                 | Question UI tests (negotiation, dismissal, timeout/cancel)                                 |
| 7   | Auto-review trial (section 5), then adopt or keep Molly-owned; delete `vendor/pi-auto-approval`; Spec update                                                    | Synthetic auto-review suite, one manual design run                                         |
| 8   | Missing-model continuation and session forward-compatibility test                                                                                               | Restore tests with a removed model; previous-release session fixture                       |

## Alternatives considered

- **Keep pinning and upgrade by hand periodically.** Rejected by the owner's requirement; the trial showed the cost accumulates (four releases behind in three weeks).
- **Keep vendored adapted add-ons, tracking upstream by hash.** Rejected: adapted copies do not receive upstream changes, which contradicts decision 2.
- **Deep-import Pi's path resolver.** Rejected: it is not in the package exports, and it would couple to internals that change daily. Execution-time operations are public and see the real path.
- **Ignore peer ranges entirely.** Not proposed as a default; the refinement in section 1 tries the newest set and lets tests decide.
- **Keep the seven-day gate and add exact exceptions daily.** Rejected: manual, and incompatible with automatic daily merges.

## Risks and limits

- Supply chain: without the waiting period, a compromised Pi or add-on release could reach `main` within a day. Pi code runs with users' model credentials in memory. Mitigations are integrity checks, lockfile rollback and releases decoupled from `main`. None of these detects a malicious but validly signed release.
- Auto-merge trusts the test suite; behavior not covered by tests or the offline smoke can regress silently until the next manual run.
- Unverified: Pi loading add-on TypeScript inside the packaged Electron Node; Dependabot pnpm catalog support; pnpm trust policy availability; add-on behavior with a private `HOME`; session-file forward compatibility.
- The auto-review trial may conclude that published add-ons cannot keep the guarantees, in which case Molly keeps owning auto-review code.

## Related

- [Embedded Pi harness implementation](2026-09-19-embedded-pi-harness-implementation.zh.md)
- [Generative layered design workflow](../../implemented/feature/2026-09-24-generative-layered-design-workflow.md) (earlier add-on evaluation under Pi 0.85.1)
- [Standard Pi MCP integration](../../implemented/simplification/2026-09-28-standard-pi-mcp-integration.md) and [triage](2026-09-28-pi-mcp-adapter-triage.md)
- [PR #52](https://github.com/LeonEthan/molly-design/pull/52): file-path bypass and journal isolation fixes
