# Session-stable host system prompt

Status: implemented
Date: 2026-10-17
Translation: pending

## Abstract

Rebuilding host time and recalled preferences before every prompt changed the request prefix and prevented conversation history from benefiting from provider caches. The host now builds its complete prompt once and saves the exact string in the existing native session history. Subsequent turns and fresh workers reuse those bytes; new sessions capture current time and preferences. A four-turn live DeepSeek check measured increasing cache hits, while deterministic real-SDK tests cover reload and new-session behavior. Existing conversations deliberately retain their initial context even after memory or host configuration changes.

## Decision and reuse

The owner selected this behavior in [issue #155](https://github.com/LeonEthan/molly-design/issues/155).
The existing `before_agent_start` hook remains the composition boundary. Its first result includes the SDK base prompt, host instructions, one clock sample, the read-before-edit reminder and one preference snapshot. Pi's public `appendEntry` stores a versioned `molly_host_system_prompt` custom entry in the existing session JSONL. Binding a restored session reads that entry before inference; malformed saved data is rejected rather than silently rebuilt.

Reuse ladder: the existing host hook alone could not survive a new worker. The next rung, adapting the existing public `SessionManager` custom-entry API, supplies durable storage and keeps the partitioned history, writer guard and validation path. A sidecar file or new protocol/store is unnecessary. Saving only clock/memory inputs would still let changed SDK base or host configuration alter the prompt after reload, so the complete built string is retained. Published SDK packages remain unmodified.

The snapshot begins at the first actual inference hook. Histories from older builds without the custom entry acquire one on their next inference; their prior prompt bytes cannot be recovered retrospectively. Later host/reminder changes apply to new sessions. This deliberately postpones such updates for already active sessions. Mid-conversation system updates, transport changes and Search/Fetch remain outside this change.

Follow-up: [toolset fingerprint](2026-10-17-host-prompt-toolset-fingerprint.md) ([#157](https://github.com/LeonEthan/molly-design/issues/157)) later rebuilds the saved prompt once when a reload's tool or plugin set differs, and replaces first-entry selection with latest-entry selection.

The preference context is captured once. Extraction still needs current memory records and revision fences, so every run retains its existing pre-inference read solely for extraction once the prompt has been built. The first run also uses that snapshot for prompt context. Keeping this read timing preserves deletion/disable changes during inference as stale-revision fences for the eventual capture; moving the read after inference would weaken that behavior. This preserves current disable/delete/write-conflict checks without rewriting the system prompt. The [memory Spec](../../../../specs/personal-memory.md) now describes the retained prompt and deletion boundary; it remains draft. This supersedes only the per-turn context timing in the [memory integration note](../../proposed/architecture/2026-09-28-memory-component-selection.md), preserving its component/extraction decisions.

## Deterministic evidence

`pnpm --filter @molly/harness-pi test tests/adapter-host.test.ts` uses the pinned real SDK with a synthetic provider. The regression case submits three prompts, advances an injected clock by one minute between them and changes memory records. It compares the complete provider-visible system content and named sections as exact strings, with growing user history. It then disposes the first host, loads that native session in a new host/epoch with changed host instructions and reminder, and verifies identical provider system bytes. A different product/native session captures the current clock and preferences.

Before the fix, the focused case failed with changed time and preference bytes. After the fix, it and all 43 managed-host tests passed. The strengthened all-system-content/sections assertion also passed. Validation totals and desktop evidence are recorded below after completion.

## Live Mac mini evidence

On 2026-10-17, the freshly built `apps/cli/dist/molly-pi-agent.js` ran four sequential ACP prompts through the changed host, pinned SDK 1.0.4 and the user's existing DeepSeek connection, model `deepseek-flash`, thinking off. Personal-memory extraction was disabled for this synthetic check. The existing encrypted connection was read through Electron `safeStorage`; the key was sent directly to the worker's private fd-3 credential pipe. No key was printed or saved in a probe config, argv, environment or native history.

| Turn | Uncached input tokens | Cache-hit input tokens | Output tokens | Total input tokens |
| ---- | --------------------: | ---------------------: | ------------: | -----------------: |
| 1    |                13,265 |                      0 |           172 |             13,265 |
| 2    |                 3,991 |                 13,312 |           181 |             17,303 |
| 3    |                 3,942 |                 17,408 |           177 |             21,350 |
| 4    |                 3,889 |                 21,504 |           171 |             25,393 |

Each completed assistant's native `usage.input`, `usage.cacheRead` and `usage.output` supplied the numbers; no estimate substitutes for usage. The persisted system string's SHA-256 stayed `e794704763ebbb7852a8b0ae8c5c699b627350dbc58e7dd5dc7c88acfdd63180` in all four observations.

Reproduction: build the CLI, launch its managed worker with an isolated private root and synthetic workspace, initialize ACP, create a session, and grant the existing selected connection over fd 3 for each unique run snapshot. Use a fixed synthetic host instruction to avoid tools and write 150 words about imaginary blue squares. Each user turn asks the same and appends 160 numbered fictional-grid fixture lines (with turn/row labels). Submit four prompts sequentially in the same session and read each completed assistant's native usage plus the saved custom entry hash. The four requests completed without additional model calls. Local probe setup initially failed before inference due to an Electron import, catalog selection and a removed development-build path; these supplied no cache measurements. Only the final completed four-turn run is reported here. Synthetic histories and local probe files are excluded from the deliverable.

This measures cache behavior for this provider/model on macOS arm64, not cache guarantees for other providers, real-user content or arbitrary histories. The run does not validate visual design quality or mid-conversation system-message support.

## Validation, independent review and publication

The final `MOLLY_PLATFORM=local pnpm check` passed completely, including 235 harness tests, 2,971 CLI tests (three existing skips), 3,173 component tests, 400 Electron tests, typechecks, lint, i18n and boundary guards. `pnpm format`, the local desktop build, changed-file formatting, documentation checks and `git diff --check` also passed. Documentation reports only preexisting rule-size warnings; no registered SHA-protected topic changed. The default composition's unrelated bug-report test timed out reading this machine's roughly 2 GB Lody log directory; the supported local composition passed without changing test source or timeout settings. Local probe caches remain in the existing ignored artifact directory.

Computer-use launched the built development app with isolated worktree data and the existing E2E host-port override. After the primary computer-use interface timed out, the authorized `@dsh` check used native window capture and process-targeted Accessibility/CGEvent input to open Settings > General; its home and settings screenshots were inspected. No credentials were added. New Session only focused the blank composer, so this proves navigation/rendering rather than GUI inference or canvas creation. One initial global click had an uncertain target because the production window overlapped the development window; no new production window was observed, but that click's effect cannot be proven. Later actions targeted the development process. The separate ACP cache measurements above are unaffected.

The parent inspected the implementation, tests and live evidence with no P0/P1 findings. An independent Lody Codex `@astra` assessment also found no P0/P1, reran all 43 managed-host tests plus documentation/diff checks, and inspected the installed SDK lifecycle, persistence and session isolation. Its additional read-only Codex CLI second-opinion attempt selected `gpt-6-astra` with high reasoning after a successful preflight, but exited 1 before review: “failed to initialize in-process app-server client: Operation not permitted”. That attempt supplied no CLI verdict and was not retried or worked around. The successful independent Lody assessment and unavailable additional CLI verdict are distinct evidence.

Published as non-draft [PR #156](https://github.com/LeonEthan/molly-design/pull/156) against `main`; its remote checks and review threads carry the publication results. The work remains on the issue branch, with no merge authorized. The implementation session's configured runtime model is `gpt-6.1-sol`, for the `Model: gpt-6.1-sol` commit trailer.
