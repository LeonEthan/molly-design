# CLI build, runtime, and adapter provenance

Background for `apps/cli`. Binding rules stay in [apps/cli/AGENTS.md](../../apps/cli/AGENTS.md)
and the scoped files under it; this page explains why those rules exist and how the pieces fit
together.

Session/Task MCP tool contracts are owned by
[src/mcp/AGENTS.md](../../apps/cli/src/mcp/AGENTS.md), including callers outside that
directory. Cross-entry model validation, Session provenance, and feedback privacy
remain in the CLI parent rules.

## Embedded Session acceptance

CLI create and MCP pre-accept validation share the same target and effective run-config
resolver in `src/commands/session.ts`. It reads the exact same-machine Molly config and
current runtime catalog before a Session is written. Explicit and inherited controls
are merged before model-specific validation; unsupported inherited fields are rejected,
not silently discarded. MCP option discovery excludes retired targets. Chat validates
both the stored Session engine identity and the current exact configuration before
writing history. It resolves and validates the target's last selected model/thinking
before Operation acceptance, freezing the exact configuration ID and the invoking
Turn's Task gate alongside the effective controls in `targetDispatchConfigs`. MCP
creates (including Role creates) freeze the invoking Turn's MCP ids, not mutable
requester history or Role fields. Chat freezes the target's latest explicit MCP
selection with its model defaults; an explicit `[]` overrides inheritance. Both
single and batch recovery reuse that snapshot and revalidate current eligibility;
changed history cannot replace it. Older accepted chats without a frozen snapshot
fail materialization rather than guessing a new selection (the existing Operation
deadline still owns their final timeout). The snapshot adds an optional exact target
ID, structured model selection and selected MCP ids to the existing stored dispatch object; downgrade to older strict readers is not
verified. These checks do not establish upstream credential availability.
Structured-only model inputs survive history inheritance and CLI history authoring.
Before merging, each structured selection is checked against its own ACP aliases and
projected into the existing selector fields. Explicit model/thinking changes then use
ordinary field inheritance; acceptance validates the result against the current catalog
and freezes its structured selection. SQLite reopens preserve that snapshot without
backfilling older rows or rereading mutable history.
Retired records remain readable. The independent worker execution guard still owns
last-mile refusal. Builds omit retired executable adapters and presets; historical
runtime download/update code and unreachable legacy catalog writers are removed.

## Development build

`pnpm dev` bundles with esbuild (`scripts/dev-build.mjs`, ~3s) into `dist-dev/`, then runs
`node --enable-source-maps dist-dev/index.js`. `pnpm dev:build` builds only. There is no
on-demand TypeScript-loader fallback, so development startup must run built JavaScript.

The dev output layout must match production's — `index.js`, sealed `harness/` and flat
sibling `*-worker.js` — because the Tinypool pools
(`file-index-scan-pool.ts`, `diff-line-count-pool.ts`), the direct `turn-diff-store-worker.ts`
client, and `workspace-watch-coordinator.ts` all locate their child by FILENAME next to
`import.meta.url`. Running directly from `src/` would leave only `.ts` siblings, so pools would
fall back to the main thread (`reason=worker_missing`) and mandatory workers would be unavailable.
`dev-build.mjs` asserts after each build that no worker-resolving module was hoisted into
`chunks/`, because that reintroduces the same invisible fallback.

Two dev-build choices are load-bearing:

- npm packages stay external — that is what makes it fast and avoids inlining wasm — but they are
  externalized by ABSOLUTE path. Bundling a workspace package's `.ts` source moves its imports
  into this bundle, and pnpm's strict layout has no entry for that package's transitive deps under
  `apps/cli/node_modules`.
- `splitting: true` preserves lazy runtime imports. The retired code-review viewer
  is no longer a CLI runtime/download dependency.

The CLI's own `version` comes from `@/pkg` because each build composition aliases it to the
manifest that actually gets published (cloud builds point it at the private composing package). A
relative `../package.json` import bakes the stale OSS version into the published bundle — that is
what made `lody@0.82.1 --version` print `0.76.0`. The package `name` is `molly` in every
composition.

## Retired developer workflows

Molly no longer runs PR discovery/status reconciliation or automatic review/merge.
The CLI review command, viewer download and review submission MCP tool are removed.
Existing scheduling caches, review records, working files and session history are
not deleted. Generic task automation, workspace watchers and Agent tools remain.
See [T24's consumer audit](../notes/implemented/simplification/2026-09-11-developer-workflow-retirement.md).

## Remaining legacy adapter provenance

The public submodule sources remain for history and separate maintenance, but CLI
production/dev builds no longer emit Claude, Codex, Grok or DeepSeek ACP executable
entries or copy DeepSeek presets. CLI direct dependencies on the first three adapter
packages are removed. `assertNoLegacyHarnessArtifacts` rejects stale entries and maps
in dev output, the published bundle, both staging scripts and the packed desktop.
The regular dev commands clean their generated output; the checker never deletes
artifacts or touches user runtime installations.

External managed-runtime and registry installers, background updates, DeepSeek
config/launch preparation and old launch-metadata builders are removed. The only
version-builder consumer was an obsolete session-created legacy catalog writer,
not a history reader. Removing it leaves stored catalogs unchanged and keeps
Molly publication with the protected connection-aware publisher. CLI no longer
depends on DSH profile, Claude SDK, tar or zstd-stream for retired execution.

Startup no longer auto-registers external providers or prepares their runtimes. The protected
desktop catalog publisher registers bundled Molly in the existing machine Flock catalog;
historical configurations and runtime caches are preserved.

`prepare:acp-adapters` retains its script name for existing callers but prepares only
shared Core. It no longer builds Claude/Codex/Grok/DSH
adapter distributions. The Pi closure is built and sealed separately by
`build-embedded-harness.mjs`. Final desktop staging/native installation remains a
separate verification step; a successful CLI build is not installed-app evidence.
