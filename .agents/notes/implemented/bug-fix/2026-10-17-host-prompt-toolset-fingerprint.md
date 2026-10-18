# Host system prompt toolset fingerprint

Status: implemented
Date: 2026-10-17
Translation: pending

## Abstract

The session-stable host prompt from #155 includes Pi's base prompt, which lists the tools available at first inference, and restored it verbatim on every later worker. After an app upgrade, MCP edit or plugin change, a resumed session could describe tools that no longer exist or omit new ones. The saved entry now records the worker's tool and plugin hashes; a reload with different hashes, or a legacy entry without them, rebuilds the prompt once with current time and memory and appends a new entry. Unchanged toolsets keep byte-identical prompts, so only the reload after a real change loses the provider cache. Corrupt saved entries refuse the session with a named code instead of being skipped or silently rebuilt.

## Decision and reuse

The owner chose option 1 of [issue #157](https://github.com/LeonEthan/molly-design/issues/157) in the [CTO triage](https://github.com/LeonEthan/molly-design/issues/157#issuecomment-6244858102): fingerprint the entry and rebuild once on mismatch. Option 2 (rebuild only the SDK base section, keep the original time/memory) still invalidates the cache and needs a parser for the composed string. Option 3 (force a new session) visibly disrupts users after every upgrade. Both were declined.

Reuse ladder: the existing `toolsetHash` and `pluginSetHash` that `bind()` already computes for the run snapshot are the fingerprint, so no new hashing or tool introspection is added. The existing `molly_host_system_prompt` custom entry gains `version: 2` with those two fields rather than a sidecar file or new store. The existing `before_agent_start` hook and per-run memory read rebuild the prompt: `bind()` only leaves the prompt unset, and the first inference composes and appends exactly as for a new session. Selection and validation live in a small pure module so the policy is unit tested apart from the SDK.

Policy:

- Latest entry decides. Multiple entries arise legitimately once a session has been rebuilt, so first-match selection would revert to an outdated prompt.
- Version 1 entries have an unknown fingerprint and rebuild once. The rebuilt v2 entry then wins on later reloads.
- Every entry of this type must validate, including superseded ones and unknown future versions. One malformed entry raises `pi_acp_host_invalid_system_prompt_snapshot` from `bind()`; session setup then fails without inference or history rewrite, as with other restored-history corruption. Skipping it would silently swallow corruption; the owner asked for a named failure. The trade-off is that an older corrupt entry blocks reuse even after a later valid one. Molly writes these entries only through Pi's `appendEntry`, so this is not expected outside manual edits or disk corruption.
- Reverting to an earlier toolset after a rebuild rebuilds again, because only the latest entry is compared.

Follow-up: the [Pi 1.3.0 upgrade](../architecture/2026-10-17-pi-1-3-0-upgrade.md) ([#158](https://github.com/LeonEthan/molly-design/issues/158)) later treats a well-formed entry with a later integer version as an unknown fingerprint that rebuilds once, keeping the named error for malformed entries, and sorts the hash inputs by code unit instead of `localeCompare`.

`pluginSetHash` hashes extension paths. Pi packages resolve from the app's `node_modules`, not the per-epoch `PI_CODING_AGENT_DIR`, so unchanged installs keep the same hash across workers; a production-profile test pins this.

## Evidence

`pnpm --filter @molly/harness-pi test` runs unit tests for selection (latest wins, v1, mismatch, five malformed shapes in any position) and real-SDK tests with a synthetic provider across fresh hosts on one native session: adding and removing a tool each rebuild once with fresh clock and memory, record two v2 entries and keep later turns stable; an unchanged production-profile toolset keeps byte-identical provider system content with one entry; a third worker reuses the latest of duplicate entries; a rewritten v1 entry rebuilds once and is then reused; a malformed entry fails session setup with the named `bind()` error, no provider call and an unchanged file. Five of these failed against the #156 host and pass now; the #155 regression test still passes.

Limits: selection reads all native entries in file order, matching #156; Molly does not branch sessions. No live provider run was made for this change; the cache-miss cost is inferred from #156's measured cache behavior.
