# Embedded run contract

Status: implemented
Date: 2026-10-18
Translation: pending

## Abstract

The CLI and embedded Pi host independently built and checked the same run facts, making their accepted identities and metadata easy to drift apart. The shared `embedded-run-contract` now owns snapshot construction and acceptance, MCP binding parsing, session binding acceptance, run metadata, and model failure categories. Callers retain their existing static errors and lifecycle side effects. Wire JSON and the harness protocol version remain unchanged; visual quality and the broader agent lifecycle are outside this refactor.

## Decision and reuse

The owner approved all five responsibilities together on 2026-10-18, with failure categories in a separate commit. Existing schemas remain in `embedded-harness.ts` and are imported without re-exporting them. Extending that already-hot roughly 1,150-line file was rejected; no existing contract module covers this boundary. The new subpath reuses the existing shared incremental SHA-256 implementation for the exact run ID hash instead of adding a Node-only dependency or another hash implementation.

The CLI builds snapshots and only the host accepts them. Acceptance combines the schema with all existing host equality checks, including the absent permission mode and frozen MCP list. MCP parsing on both sides rejects duplicate server IDs. Session acceptance checks the schema, epoch and harness; the CLI still owns the one-binding lifecycle. Mismatch results carry typed reasons and fields while callers preserve their static error codes, host retirement and CLI shutdown behavior. Schema failures now also map to those static errors instead of exposing validation payloads.

Request and response helpers preserve the existing JSON keys, omission rules and order. `AgentClient` uses typed readers for question ownership and memory diagnostics; its builtin/Molly gate and cancellation special case remain. The extra response metadata reader lets it consume the envelope without duplicating parsing or taking the control's lease ownership role. Memory diagnostics retain the existing safe static-code filter, and malformed optional memory metadata cannot invalidate a valid completion receipt.

`MODEL_ERROR_CATEGORIES` supplies the category type and an exhaustive category-to-failure-code map. `ModelRequestFailureCode` derives from the existing Zod `ChatFailedCodeSchema`, excluding the unrelated Git code. Missing and unknown categories still use `model_request_failed`. Pi's classifier regexes and user-facing diagnostic details remain in harness-pi. No retry, model default, paid call, persistence or protocol mechanism is added.

The parent shared `AGENTS.md` was already 8,164 bytes. Adding the required invariant exceeded its 8 KiB limit, so its existing credential rules moved verbatim into `src/AGENTS.md`, with a mandatory read pointer and `CLAUDE.md` symlink. This follows the documentation routing policy without dropping or changing an existing rule.

The CLI's personal-memory lease check, `embedded-harness.ts` split, other deepening candidates and `CONTEXT.md` are outside scope. Spec intent and statuses are unchanged.

## Verification

Table-driven shared tests replace the per-field host/control variants: snapshot round trips, each mismatch field, duplicate MCP identities, metadata bytes, safe optional diagnostics, outcome/stop-reason consistency and exhaustive category mapping. Each side retains one static-code mismatch wiring test. Managed SDK integration and CLI cancellation integration remain unchanged.

`MOLLY_PLATFORM=local pnpm check` passed all workspace typechecks, lint, tests, i18n, and import/platform/public-boundary guards: shared 1,353 tests, harness-pi 260, CLI 2,968 plus three existing skips. The unchanged CLI cancellation integration passed. Component tests passed 3,178 and Electron tests passed 404. `pnpm format` completed; its one unrelated formatting-only change was reverted. `pnpm run docs check` passed with no errors or protected topics requiring SHA review. `pnpm install --lockfile-only` produced no lockfile change because the manifest adds only a subpath export.

Codex CLI `gpt-6-astra` at high reasoning reviewed the uncommitted diff with the read-only sandbox: no P0/P1 findings. Its sandbox could not run tests; the unrestricted parent ran the full check above. It flagged the shared `AGENTS.md` size limit, resolved by the verbatim rule routing above. The required `reviewer` Role completed a separate read-only review before commits: no actionable P0/P1 findings in standards/security or approved-scope correctness, including the verbatim credential-rule move and symlink. Live checks use an already configured model, no image calls and no forced model failures or paid retries. These checks establish runtime wiring and settlement, not human visual-quality approval.

## E2E (Mac mini)

The owner-required live checks ran in this session on the Mac mini through computer-use. The development app was launched from this worktree's Lody terminal with `MOLLY_E2E=1 MOLLY_E2E_LOCAL_CLI_HOST_PORT=17891 pnpm dev:local`, then relaunched detached when closing the terminal panel stopped its initial native build. The completed launch rebuilt and verified both native resources, the CLI/embedded Pi bundle, Bento and the Electron development app. It used the existing DeepSeek V4.1 Flash connection at High reasoning; no credentials or model configuration were added.

| Scenario                | Observed result                                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design turn             | Completed in the UI (39s); a 320×200 cream poster with a blue circle and live heading rendered, saved and returned to editable/autosaved. The native journal settled `completed`.                                                  |
| Mid-turn cancellation   | Stop after confirmed dispatch ended the turn (17s); partial text remained, no error notice appeared, and the canvas returned to editable/autosaved. The native journal settled `cancelled`.                                        |
| One selected MCP server | Selected the existing local `molly-synthetic-protected` connection in the UI; the new worker started and completed (12s). The native run snapshot contained exactly one protected MCP binding and the journal settled `completed`. |

Computer-use screenshots verified the completed canvas, cancellation without an error notice, one checked connection, and final MCP-turn completion. The last scenario establishes selected-server startup and protected-binding transfer; it intentionally made no server tool request. No images, model failures or paid retries were induced. Machine-local journals and captured conversations are not included in the repository. These checks establish runtime wiring and settlement, not human visual-quality approval.
