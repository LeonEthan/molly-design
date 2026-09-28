# Memory component selection for issue #36

Status: proposed
Date: 2026-09-28
Translation: pending

## Abstract

Molly needs reusable local memory without replacing its agent lifecycle or silently sending user data to another service. Following inspection of the published packages, the owner selected mem0 TypeScript OSS and automatic capture of shared personal preferences on 2026-09-28. A subsequent synthetic probe confirmed that stock automatic extraction can report intended memories after failed inserts and can treat malformed extraction as empty success. Component choice, capture policy and product scope are settled; the owner also approved Molly-owned extraction and safe saves with mem0 storage/retrieval. Production acceptance remains open.

## Decision and scope

The [owner rejected the original A/B/C product proposals](https://github.com/LeonEthan/molly-design/issues/36#issuecomment-5865852157) and requested existing, free components. This note checks the [subsequent survey](https://github.com/LeonEthan/molly-design/issues/36#issuecomment-5865931245), rather than reviving its rejected file/confirmation workflow. Component choice and memory-write policy are separate decisions. Free software also does not imply free remote inference.

**Owner decisions, 2026-09-28:** select mem0 TypeScript OSS and capture shared personal preferences automatically, without a confirmation prompt for each extracted entry. Brand/project facts are outside v1. Use inspected `mem0ai/oss` 3.3.1 as the implementation-planning baseline. This records the owner's choices in this working session; no GitHub approval link is available. It does not establish an embedding model, approved Spec revision or production readiness. The comparisons below preserve the research rationale rather than leaving component selection pending. Popularity and vendor benchmark scores did not decide the recommendation.

### Automatic capture integration

Automatic capture should use the existing selected-model transport inside the owning active run, with no new memory-service account. Retrieval should supply bounded, untrusted context to subsequent prompts. The user retains view, edit, delete and disable controls. Local storage does not mean remote-model extraction is offline; the settings explanation must identify that remembered information and extraction inputs can be sent to the user's configured model.

Capture must finish or cancel before run settlement and credential retirement; no shutdown summary or detached background inference is proposed. A cancelled or retired run must not initiate later writes or provider requests. Source inspection of `MollyAcpAdapter.prompt` and `createMollySession` establishes where the existing dispatch/accounting and credential lifetime must be preserved, not that the mem0 adapter already satisfies it.

The owner confirmed shared personal preferences only and the public memory operations/existing ACP lifecycle test boundaries. Implementation now includes public memory service and ACP lifecycle tests. Default ACP submodules were initialized and repository dependencies installed to prepare the checkout; no legacy vendor runtimes were initialized.

### Automatic API probe and integration decision

An isolated temporary installation exercised the actual `mem0ai/oss` 3.3.1 public API with `@langchain/core` 1.1.47, synthetic model/embedding adapters, and `better-sqlite3` 13.0.2 to match Molly's N-API baseline. Telemetry was disabled before import, all paths were temporary, and history was disabled. No remote inference or real user content was used. This was a diagnostic probe, not packaged-app acceptance or a production dependency change.

| Input/fault                                                                   | Publicly observed result                                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Valid synthetic extraction and three-dimensional vectors                      | `add(..., {infer:true})` returned one record and `get(id)` recovered the expected personal preference.               |
| Model returned non-JSON text                                                  | `add` resolved with `results: []`, without rejecting the malformed extraction.                                       |
| Batch embedder returned two-dimensional vectors for a three-dimensional store | Insertion reported a dimension error, but `add` resolved with one intended record; `get` for its ID returned `null`. |

The final case demonstrates misreported persistence under an injected storage-boundary failure; it is not evidence that valid embeddings normally fail. Source inspection additionally found no signal/commit hook on `Memory.add`, swallowed entity-cleanup failures, and fallback embedding attempts. Disabling history prevents source-message history in this configuration but does not disable entity records or prove complete forgetting.

A second read-only Codex CLI architecture opinion (`gpt-6-astra`, high) recommended one existing daemon owner and the exported `MemoryVectorStore` APIs, with automatic extraction delegated to the run's journaled `ModelRuntime`. The owner would validate an extraction plan, obtain embeddings and check cancellation/revisions immediately before a serialized save. Human edits/deletions invalidate stale pending extraction. There would be one durable memory store, no stock history/entity store, and no private-field or global-fetch patches.

The owner explicitly selected this boundary: mem0 supplies storage/retrieval while Molly owns automatic extraction and safe saves. The implementation uses mem0's public list/insert/delete operations in one daemon, with no stock Memory wrapper. V1 recalls all of a bounded set of 32 personal preferences (300 characters each); sentinel vectors satisfy the store format, but no semantic retrieval or embedding quality is claimed. This avoids a separate model download and cache for a small shared preference set. Extraction updates or adds up to eight entries through the run's selected ModelRuntime. One persisted settings row and record content define a revision; serialized commits reject stale snapshots and check cancellation immediately before mem0's synchronous SQLite transaction. User edits, deletions and enable changes invalidate pending captures.

This is proposed architecture research, not an amendment to the [design Spec](../../../../specs/graphic-design-platform.zh.md). Existing shared notes concern agent hooks, transport, and runtime memory ownership; none found in the scoped search owns durable preference-memory selection. Related integration history is [Pi design hooks](../../implemented/architecture/2026-09-11-pi-design-hooks.md).

## Evidence snapshot

The following npm tarballs were downloaded and inspected as text on 2026-09-28 without installing or executing their lifecycle scripts. Registry timestamps are publication dates; repository activity is not a quality measure. These exact artifacts make the findings reproducible even if `main` changes.

| Package                                       | Published         | Declared license              | Evidence                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mem0ai 3.3.1                                  | 2026-09-25        | Apache-2.0                    | [manifest](https://registry.npmjs.org/mem0ai/3.3.1), [tarball](https://registry.npmjs.org/mem0ai/-/mem0ai-3.3.1.tgz); inspect `package.json`, `dist/oss/index.js`, `dist/oss/index.d.ts`                                  |
| @memtensor/memos-local-plugin 2.0.20          | 2026-09-21        | MIT                           | [manifest](https://registry.npmjs.org/@memtensor/memos-local-plugin/2.0.20), [tarball](https://registry.npmjs.org/@memtensor/memos-local-plugin/-/memos-local-plugin-2.0.20.tgz); includes `core/` and adapter TypeScript |
| pi-memory 0.4.2                               | 2026-08-11        | MIT                           | [manifest](https://registry.npmjs.org/pi-memory/0.4.2), [tarball](https://registry.npmjs.org/pi-memory/-/pi-memory-0.4.2.tgz); includes `index.ts` and `LICENSE`                                                          |
| @mastra/memory 1.32.1                         | Version inspected | Apache-2.0                    | [manifest](https://registry.npmjs.org/@mastra/memory/1.32.1), [tarball](https://registry.npmjs.org/@mastra/memory/-/memory-1.32.1.tgz)                                                                                    |
| @modelcontextprotocol/server-memory 2026.8.31 | Version inspected | Manifest delegates to LICENSE | [tarball](https://registry.npmjs.org/@modelcontextprotocol/server-memory/-/server-memory-2026.8.31.tgz), [repository license](https://github.com/modelcontextprotocol/servers/blob/main/LICENSE)                          |

The three leading repositories were not archived when checked. Their last-push timestamps were September 25, September 23, and September 21 respectively. That supports ongoing activity, not compatibility, staffing guarantees, or a support commitment. [mem0 repository API](https://api.github.com/repos/mem0ai/mem0), [MemOS repository API](https://api.github.com/repos/MemTensor/MemOS), [pi-memory repository API](https://api.github.com/repos/jayzeng/pi-memory).

## What the packages actually provide

### mem0 TypeScript OSS: bounded library, consequential defaults

The published `MemoryVectorStore` uses `better-sqlite3`, opens `config.dbPath`, creates a `vectors` table, and persists vectors and JSON payloads. It is durable SQLite storage despite the official quickstart calling it an in-memory vector store. Search selects all rows and computes similarity in JavaScript; this is suitable to evaluate for a small preference corpus, not evidence of scalable indexed retrieval. Set absolute vector and history paths explicitly: defaults include a separate `memory.db` history file. Source: `dist/oss/index.js`, `MemoryVectorStore` and `DEFAULT_MEMORY_CONFIG` in the pinned tarball above; compare the [official quickstart](https://docs.mem0.ai/open-source/node-quickstart).

The default embedder is OpenAI `text-embedding-3-small`; the default LLM is OpenAI `gpt-5-mini`. Local `fastembed` is available. Its wrapper lists Chinese `fast-bge-small-zh-v1.5` and multilingual `fast-multilingual-e5-large` alternatives to the English default, so Chinese models are not absent. The Hugging Face provider is hosted/endpoint mode, not evidence of local Transformers inference. Thus a separately paid embedding account is avoidable, but a local model download, its distribution/license, inference latency and multilingual performance remain work to verify. The inspected fastembed wrapper initializes with the model but does not forward a cache-directory setting; packaged cache provisioning remains unproven. The package declares `better-sqlite3` as a required peer, with optional fastembed/Hugging Face peers; it is not an entirely dependency-free TypeScript library. Source: published `package.json`, factories and config in `dist/oss/index.js`.

Telemetry defaults on and sends to PostHog. `MEM0_TELEMETRY=false` is read when the module initializes, so setting it after import is insufficient. Constructor initialization can probe the embedder when dimension is unspecified. A local deployment needs explicit configuration before initialization, followed by an egress check; installing the OSS entry point alone proves no privacy property. Source: `UnifiedTelemetry`, `_autoInitialize` in the published bundle.

`add(..., {infer:false})` skips extraction and creates memories from supplied non-system messages, but still embeds them. It is a useful test control, not an approved write policy. The provider factory has no generic `host` provider. A supported `langchain` path accepts an object with `invoke`; adapting Molly's transport through it is plausible, but its interface does not establish propagation of Molly's cancellation/run identity. Direct OpenAI/Anthropic configuration with the same key would bypass Molly's transport ownership. Source: `addToVectorStore`, `LangchainLLM`, and `LLMFactory` in the published bundle.

**Deletion is not complete forgetting by default.** `deleteMemory` removes a vector then records its previous text in SQLite history as a DELETE event. Updates likewise retain history. `disableHistory:true` chooses a dummy history manager for future operations; it does not remove an existing history database. A proposed configuration can disable this retention from first use, or define and implement explicit history purging if history is required. This alone does not establish complete purge: entity linking can create a separate `*_entities.db`, and deletion catches entity-cleanup failures rather than failing the whole operation. Active indexes must be checked as well. Neither choice erases OS backups or already-sent model context. Source: `Memory` constructor, `deleteMemory`, `SQLiteManager` in the published bundle.

SQLite serializes individual writes, but extraction/search/update and history changes span multiple calls and, normally, separate databases. Static inspection does not establish an atomic multi-worker memory operation. Shared global/brand memory therefore needs one existing owner or verified concurrency semantics, rather than one independently mutating instance per artwork worker. Crash consistency and cross-session conflict behavior are untested.

### MemOS local plugin: stronger host bridge, broader lifecycle

The package exports a real `MemoryCore` facade, local SQLite storage, configurable embedders, and `HostLlmBridge.complete({messages, signal, ...})`. Its default embedding provider is local with `Xenova/all-MiniLM-L6-v2`; it has FTS storage and vector retrieval. SQLite defaults include WAL and a busy timeout. This makes it a technically credible embedded candidate, not merely a cloud product. Source: published `core/index.ts`, `core/config/defaults.ts`, `core/storage/connection.ts`, `core/llm/host-bridge.ts`.

However, the host bridge is a **module-scoped singleton**, not a per-core or per-session callback. Registering a second host bridge replaces the first. A single-process integration serving several model configurations must explicitly route originating sessions. The published DSH adapter already demonstrates that pattern: it captures the owning turn's provider/model in async-local scope and keeps credentials in the host. Reuse that evidence rather than treating singleton storage as an unavoidable upstream bug. Molly still needs to connect its own run ownership, cancellation and completion boundary; separate workers would also need shared-storage coordination. The signal-bearing interface is helpful but does not prove end-to-end cancellation in Molly. Source: `adapters/deepseek-harness/README.md` in the pinned package.

Defaults include telemetry enabled, fallback to host enabled, three model retries, automatic episode recovery, and LLM logs without prompt/completion redaction. Hub sharing defaults off. These are separate settings; describing the plugin as on-device is not enough. The full processing system supports episode capture, reflection, policy induction and skill generation, with background recovery. This is not mandatory on every path: the published DSH adapter documents a default lightweight summary pipeline and does not construct a MemOS telemetry sender. A Molly adapter should evaluate that reduced path rather than assume all features or telemetry must run. Full evolution features have not been established as needed by issue #36 and must not silently become Molly's agent lifecycle. Source: `core/config/defaults.ts`, `core/pipeline/memory-core.ts`, `core/llm/client.ts`, and `adapters/deepseek-harness/README.md` in the pinned package.

CRUD is split across traces, policies, world models and skills. `deleteTrace` removes the trace and its episode reference transactionally, while `deletePolicy` deletes a policy; this is not evidence that deleting one fact purges every derived policy, log and skill. The built-in viewer is not a substitute for checking those deletion semantics. Source: `agent-contract/memory-core.ts`, `core/pipeline/memory-core.ts`, `server/routes/{trace,policies,skill}.ts`.

Packaging brings required `better-sqlite3`, `@huggingface/transformers` 4.2.0, `tsx`, Preact and YAML. DeepSeek Harness peers are optional. The registry reports **6,077,924 unpacked bytes**, correcting the earlier memo's 8.1 MB figure; neither number includes the installed dependency/model footprint. A custom Pi adapter and deliberate feature reduction remain necessary.

### pi-memory: actual automatic inference and retention

The published package has no runtime `dependencies`, but requires Pi peer packages and Node >=22.19.0. It stores Markdown and recovery JSON locally; semantic/keyword search invokes optional qmd as a process. This is a native Pi extension, not proof of compatibility with Molly's narrower extension surface. Source: pinned `package.json` and `index.ts`.

**Correction:** the earlier claim that nothing is sent to an extraction model is false for 0.4.2. Exit summaries are enabled by default; `generateExitSummary` calls imported Pi `complete` with the selected model/key. Its shutdown timeout races the promise without supplying cancellation to that request. `PI_MEMORY_EXIT_SUMMARY=0` disables that feature, but the default should not be shipped in Molly as-is. Source: `generateExitSummary`, `isExitSummaryEnabled`, and the session shutdown handler in `index.ts`.

`memory_forget` writes removed text to `recovery/*.json` before rewriting the Markdown file. Forget is recoverable removal, not purge. Several writes read existing content then use `writeFileSync`; no cross-process locking was found in these paths. Multiple artwork workers sharing one directory can therefore overwrite each other's changes; this is a static failure-mode inference, not an executed race test. Default stable memory snapshots also require freshness testing when another session edits shared files. Its minimal core is attractive, but these adaptations plus qmd packaging weaken the plug-and-play argument.

## Alternatives and corrections to the earlier gate

- **Mastra is not necessarily a second Agent harness.** Published `Memory.getContext` and observational-memory `observe` expose standalone operations. Upstream explicitly tests external consumers without a full agent pipeline. It still peer-depends on `@mastra/core`, so dependency and lifecycle costs require measurement, not categorical exclusion. Evidence: pinned package declarations `dist/index.d.ts` and `dist/processors/observational-memory/observational-memory.d.ts`; [upstream standalone tests at inspected commit](https://github.com/mastra-ai/mastra/blob/b8c2be47862a890c6e142b37ad5cf8ccdcdba147/packages/memory/src/processors/observational-memory/__tests__/standalone-observe.test.ts).
- **MCP reference memory server** is an existing small local graph store supported by a transport Molly already has. Its search is substring matching, not semantic search. Atomic temp-file rename protects a single save, but its load-modify-save sequence shows no cross-process transaction; use one server owner if evaluated. The inspected tarball delegates its license to a missing LICENSE file, so verify and retain upstream license text before redistribution. Evidence: pinned package `dist/index.js` and `package.json`.
- **In-process only is an engineering preference, not a user-approved requirement.** Python, Docker, a database service or another runtime can make other candidates disproportionately expensive to distribute, but a local child process is not inherently a cloud/privacy violation. Existing MCP support keeps small Node services plausible. No replacement harness or extra server is recommended by this note.
- **Benchmarks are not Molly evidence.** Mem0's current [benchmark repository](https://github.com/mem0ai/memory-benchmarks) distinguishes managed platform scores from OSS runs; its OSS evaluation setup is not the TypeScript SQLite combination inspected here. None of the inspected materials establishes Chinese/English brand-rule retrieval or visual-preference adherence in Molly. We do not transfer leaderboard scores to this selection.

## Proposed responsibility boundary and next evidence

Molly should keep session identity, selected-model transport, cancellation, permissions, and user controls. The selected component would own memory records and retrieval, with scoped identifiers for whatever product scope is later approved. Memory is context, not tool authority, and does not become another editable copy of BentoDoc. Reuse an existing process/service owner where possible; this note does not approve a new protocol or storage layer around the library.

The [current session factory](../../../../packages/harness-pi/src/session-factory.ts) already supplies question extensions; the extension list is not unused. [Resource loader](../../../../packages/harness-pi/src/resource-loader.ts) support for `contextFiles` is a possible integration point, but it rejects extension command registration and does not itself confer lifecycle compatibility. The current Spec targets macOS arm64, with Intel/Windows experimental; a packaging gate must reflect that scope rather than inventing equal release commitments.

These packages recall textual facts; they do not supply a brand asset manager or guarantee that every mandatory guideline enters the prompt and is applied. The strongest argument against mem0 is that an `infer:false` experiment tests explicit storage/retrieval while evading the hard extraction behavior that could make memory useful. Transport, extraction quality, and deletion still need evidence.

A separately authorized implementation should answer six decisive questions before production acceptance:

1. **Restart and concurrent access:** persist synthetic scoped memories, restart, retrieve them, and exercise simultaneous readers/writers plus interruption between storage steps without cross-brand leakage or silent loss.
2. **Exact forgetting:** list/edit/delete through the candidate API, then inspect active storage, history, derived records, caches and recovery copies. Specify the retention boundary honestly.
3. **Network and model ownership:** initialize and use the configured local embedder with telemetry off; distinguish first model download from steady-state egress. Any extraction call must preserve Molly's selected-model route, cancellation and run accounting with no silent paid retry.
4. **Retrieval value:** compare against a small full-context baseline on synthetic English/Chinese preferences, contradictory updates, scope separation, irrelevant memories, and malicious stored instructions. Measure recall and context cost; no captured user conversations.
5. **Actual packaging:** verify required native modules/model assets in the packaged macOS arm64 app, then experimental targets as appropriate. Report cold-start/download footprint rather than npm tarball size alone.
6. **Minimal adapter:** prove view/edit/delete and bounded context access without importing another agent lifecycle, background skill generation, or a parallel snapshot system. Implement the selected automatic write policy; `infer:false` alone is an experiment control, not automatic extraction acceptance.

## Outcome and limits

A separate read-only Codex CLI review (`gpt-6-astra`, high reasoning) independently recommended mem0 first and MemOS as the strongest alternative. Its strongest counterargument was that mem0's separate extraction client may erase the apparent integration advantage once Molly's credential, accounting and cancellation boundaries are preserved. It also challenged the Mastra exclusion and highlighted MemOS's lightweight adapter mode. Those observations were checked against published artifacts here. The opinion inspected mostly upstream source rather than the exact tarballs, and supplies no runtime or packaging evidence. If supported mem0 APIs cannot preserve Molly's lifecycle without invasive adaptation, evaluate MemOS's host bridge before committing to a fork. This is advisory agreement, not owner approval.

The implementation adds automatic extraction, transient recall, one local mem0 store and Settings > Preferences controls. Synthetic service and ACP tests cover persistence, revision conflicts, deletion, disable/re-enable, cancellation and memory-specific failures. The CLI bundle builds with only the exported SQLite store retained; no extra embedding/native package is staged. Live extraction quality, real-provider billing and visual preference adherence remain unvalidated. No PR or issue comment was published.

### Implementation review and verification

A read-only Codex CLI implementation review (`gpt-6-astra`, high) completed with
no substantiated P0/P1 findings. It confirmed the save fences and highlighted the
context cost of recalling every preference (up to 9,600 characters plus formatting)
as a product tradeoff. Its attempted nested CLI review was blocked by the read-only
sandbox (`Operation not permitted`); that nested attempt supplied no extra opinion
and was not retried. The primary implementation review itself completed successfully.

Executed checks include the final `pnpm check`: 329 harness tests, 3,096 CLI tests
(three existing skips), 3,198 component tests, other workspace suites, typechecks,
lint, i18n and boundary guards. Additional checks include CLI production bundling,
published-import validation, and insert/recall/delete through the production mem0
chunk with both Node and Electron on macOS arm64. The staged Electron probe used
Molly's existing SQLite N-API binary. Typechecks and public-boundary checks pass.
No Windows/Intel native execution or live-model quality evaluation is claimed.

### PR review: fresh-install directory creation

The [PR #43 directory-creation finding](https://github.com/LeonEthan/molly-design/pull/43#discussion_r4123403026)
was not reproducible with pinned mem0ai 3.3.1. Its exported `MemoryVectorStore`
constructor invokes `ensureSQLiteDirectory(dbPath)`, which recursively creates the
parent before constructing SQLite. The existing public-service persistence test
now opens `memory/preferences.sqlite` beneath a fresh temporary root without
creating `memory/`, then saves and recalls a preference after reopening. All seven
service tests pass. No duplicate directory-creation code is needed in Molly.
