# Molly embedded Pi harness

Status: draft
Previous approval (before Role retirement): [2026-09-21 owner approval](../.github/spec-approvals.md#2026-09-21-existing-specs)
Translation: current

[中文](molly-embedded-pi-harness.zh.md)

## Problem Statement

Users need a Molly they can install, configure and keep creating with — not an ever-growing verification matrix. The embedded engine, connections, image handling and design transactions already have extensive implementation and verification, but no installer that completes the key journeys. Repeated full checks, performance diagnostics and multi-vendor permutation acceptance have delayed actual delivery.

## Solution

After installing Molly, the user only configures a model connection, an API key and an explicit model to start designing — no separate Agent CLI or global Node/npm install. Image generation and editing continue to use the user-configured image MCP/BYOK; without an image connection, text, shapes, manual editing and rendering remain usable. Different sessions may choose different model connections, but all new executions use the same version of the embedded Pi harness.

This draft follows the "Molly embedded Pi harness transformation plan" v1.0 (2026-09-19), and redefines the remaining delivery scope per the 2026-09-20 convergence requirement: the installer, one complete design journey, key interactions, old-data continuation and delivery notes. Items explicitly deferred below are no longer completion conditions for this round; the original plan's historical goals and executed evidence are preserved, and deferral is not recorded as completed implementation. The implementation plan holds the implementation and check evidence. This revision remains draft; task status or automated checks do not replace human approval of this revision.

This is a follow-up revision proposal to the multi-Agent selection and CLI bootstrap goals in the [design workbench Spec](graphic-design-platform.md), not a description of the current implementation. When implemented, that Spec, the [upstream adoption scope](lody-upstream-adoption.md), the relevant scoped rules and the golden cases are adjusted together: the existing acceptance history is preserved, new embedded-Pi results are recorded independently, and Kimi CLI pass results must not be transcribed as Pi passes. This draft changes neither Bento's editing scope, the design format, the history backend, nor the autonomous-creation principles.

## User Stories

1. As a desktop user, I want to install Molly without installing Pi or global Node/npm, so that I can start designing without managing an agent runtime.
2. As a returning user, I want the installed application to contain the current engine and resources, so that development success also applies to the application I run.
3. As a designer, I want to configure my model connection and explicitly select a model and thinking level, so that I control the service used for my work.
4. As a user with multiple connections, I want each design session to retain its selected connection, so that accounts and endpoints are not mixed.
5. As a user, I want credentials protected locally and absent from prompts and exports, so that configuring a service does not disclose my secrets.
6. As a user, I want unavailable or unverified model capabilities stated clearly, so that I do not mistake a listed model for a tested service.
7. As a designer, I want to create an editable artwork with Kimi, so that I can continue editing the result rather than receive only a flattened image.
8. As a designer, I want to configure my own image service and image model, so that image generation is independent of my language-model connection.
9. As a designer, I want to generate an image and use it in my artwork, so that image results participate in the existing design workflow.
10. As a designer, I want to edit an existing image and apply the result to the intended element, so that I can revise visual content without rebuilding the artwork.
11. As a designer, I want to edit text and shapes without an image-service key, so that optional image generation does not block ordinary editing.
12. As a designer, I want to preview creation progress without committing every preview, so that I can inspect work while preserving the current artwork.
13. As a designer, I want my manual changes saved before the Agent continues, so that it works from the current artwork.
14. As a designer, I want the artwork protected from concurrent edits during Agent execution, so that two writers do not overwrite each other.
15. As a designer, I want to save, export, reopen and continue the same artwork, so that the design remains usable beyond one session.
16. As a user, I want to cancel execution and see an accurate result, so that a stopped or failed run is not presented as completed work.
17. As a user, I want to answer the preinstalled community extension's questions in Molly, so that I do not need a terminal interface.
18. As a user, I want unknown paid-operation results to remain identifiable without automatic resubmission, so that reconnection does not silently charge me again.
19. As a returning user, I want old artworks, assets and conversation history preserved, so that migration does not discard my work.
20. As a returning user, I want an explicit action to continue an old design with the built-in engine, so that historical runtime identities are not silently reused.
21. As a returning user, I want Role selection and execution retired while its historical records remain readable, so that new work uses explicit model and reasoning choices.
22. As a local Pi user, I want Molly to leave my separate configuration and installation untouched, so that adopting Molly does not disrupt other tools.
23. As a user receiving this delivery, I want a runnable package and concise supported-capability notes, so that I know what I can use and what remains deferred.

## Implementation Decisions

### Remaining work and completion conditions

The existing embedded worker, ACP, connections and credentials, MCP, image import and recovery, design transactions, migration gates and community Q&A implementations are reused as-is and not rewritten for this close-out. Only actual defects blocking the completion conditions below get fixed.

| Order | Remaining work                       | Completion condition                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1    | Installer startup and delivery       | Resolve the packaged Helper startup timeout, produce the macOS arm64 local installer; an app installed from the package starts the embedded engine without relying on global Pi/Node and without a first-launch harness download; resources and version identity are consistent.                                             |
| R2    | One complete design journey          | Using the explicitly configured Kimi k3-256k/high and an image service, complete on the same artwork: creation, image generation, basic image edit and apply, continue after manual edits, save, export, reopen and continue; do not build another poster/infographic/long-image permutation matrix.                         |
| R3    | Settings and key interaction wrap-up | During the journey above, check connection/model selection, necessary error messages, cancellation and the preinstalled Q&A; the user can configure and operate, and unverified capabilities carry no full-support promise. Prefer reusing the existing UI and permission flows.                                             |
| R4    | Old-data continuation                | Actually walk through one old design-session continuation and confirm Role entry points are retired; provenance and old data are preserved, and continuation lands on the embedded Pi. Backup, re-entry and the gates on all old execution entries reuse existing regression coverage instead of re-permuting every failure. |
| R5    | Delivery notes and final checks      | Provide the installer, concise configuration instructions, support status and known limitations; complete the checks related to the final changes and the repository's required delivery/commit checks. Existing unrelated failures are listed independently, not masked by deleting assertions.                             |

R1 → R2 is the critical path; R3 is embedded in R2, then R4 and R5 complete. Newly found real defects are reproduced minimally before fixing; scope does not grow over conveniently spotted optimizations. Only when R1–R5 all have corresponding evidence and there are no unresolved core-functionality, security or data-corruption issues may this convergence delivery be recorded as complete; the deferred parts of the original plan are not claimed as done.

### Responsibilities and state authority

| Owner                   | Authoritative state and responsibilities                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Molly Session service   | User tasks, queues, permissions, run-config snapshots, execution results and recovery policy; the sole dispatcher.                                          |
| Embedded Pi worker      | Model loop, tool scheduling, compaction and native model context; uses Molly's private SessionManager storage.                                              |
| Molly ACP adapter       | Follows the existing ACP consumption boundary, mapping native results, events and cancellation to the host; adds only necessary shared extensions.          |
| Design services & Bento | BentoDoc is the single editable truth; the design services own projections, draft collection, asset validation, CAS, receipts and the existing Git history. |
| Electron main           | Protects credentials, verifies callers and secret-receiving targets; provides managed workers/MCP with the necessary short-lived access.                    |
| Standalone MCP host     | Tool connection, discovery, authorized execution, cancellation and result import; tools do not execute on the daemon main thread.                           |

Product Session, one user task, a Pi internal turn, a native session and a worker instance are identified separately. A run snapshot freezes the connection ID/revision, model and thinking configuration, harness build, plugin and tool sets, permission configuration and the related design baseline — and contains no secrets. UI messages are the product read model and are not used to copy and rebuild another full native model history.

Before each user prompt, the worker supplies current host-clock date and time, UTC and the host time zone as model-visible environment context. A later prompt refreshes that context even in a reused native session; work needing a newer instant queries the clock. Host time establishes when the task is running, not the date of an event in the artwork. Geographic location comes only from explicit user information; when unavailable it remains unknown and is not inferred from the time zone, language or file timestamps. This uses the existing public context hook, without another location service or state store.

### Embedded delivery and isolation

The engine baseline is Pi v0.85.1, using the public coding-agent SDK, fixed absolute paths and a separate process. The engine, curated plugins and actually needed resources are pinned at build time and shipped with the package; release artifacts carry the version, dependency/resource digests, protocol versions and a platform manifest. Both development and packaged builds must verify the actual Node version satisfies the engine requirement; the host's development Node must not substitute for an in-package probe.

Molly does not locate, launch or modify a local Pi; it does not automatically read user-level or project-level Pi configuration, parent contexts or global skills, and it does not inherit their authentication. Resource loading comes only from the approved manifest and the host's explicitly prepared inputs for the current run; never run default discovery and filter afterwards. Settings, model catalogs, caches, sessions, plugin state and temporary files all live in Molly's own locations. The worker environment uses a whitelist, keeping the variables the packaged Node needs to start and removing external authentication and code-injection variables. Shutdown cleans up only the processes it owns.

Community native plugins must be reviewed, version-pinned, selectively loaded and verified; this round uses the preinstalled community Q&A plugin, reuses the existing isolation/recovery evidence, and completes one native interaction check. Simple confirm, select, input and notification reuse the existing GUI; unsupported TUI capabilities are explicitly unavailable. The necessary command system is deferred: no slash-command discovery, configuration commands or manual compaction commands are added, and unmapped commands remain non-executable. Timeouts, window closing and cancellation must never default to consent. Plugins get no arbitrary installation, self-updating or a second paid-service configuration entry.

These guarantees target the product path and reviewed extensions; they do not promise a hard sandbox against arbitrary native code, shells or third-party stdio MCP under the same OS user.

### Models, credentials and permissions

Provider presets, user connections and model selection are modeled separately. Multiple connections from the same vendor independently own endpoints, credential references and revisions; ModelRuntime is isolated per session/connection. When no model is explicitly selected, credentials are missing or capabilities are incompatible, fail clearly — never fall back to the first model or another account. Configuration changes take effect at the next safe boundary; revocation may terminate current work but must not switch to different credentials.

Keep the existing native presets, advanced OpenAI-compatible and multi-connection architecture; this round's real-service delivery is based on the configured Kimi k3-256k/high, without expanding per-vendor, per-region and per-model acceptance. The Google integration fix and the Pi SDK upgrade are deferred, and the pinned engine baseline is unchanged. The support matrix distinguishes really verified, mock-verified, blocked and not-executed; only really-passing scope may be called officially supported. A catalog entry does not mean the service is usable, and a model without vision capability must not be shown as having completed a native image review.

Credentials are protected by SecretStore, and ordinary configuration stores only references; after saving there is no general plaintext-read API. Secrets never enter workspace/Loro configuration, Roles, native sessions, model context, tool arguments, command lines, diagnostics or Git; model keys are not passed to shells, and different MCPs do not share secrets. Migrating old image keys must account for CRDT history and backups; deleting the current field must not be claimed as thorough erasure of historical plaintext. When reliable persistence is impossible, fail clearly or use a visible in-memory mode.

Authorization is bound to the actual run, worker epoch, request and connection revision. Out-of-workspace reads/writes, arbitrary shells, stdio command changes and secret-receiving-domain changes have explicit authorization boundaries; paid tools default to per-call authorization, with a user-granted limited count allowed. Authorization checks land on the execution path; a public read-before reminder is not read proof or write authorization. The optional auto-review mode ([generative layered design](generative-layered-design-workflow.md)) replaces per-call prompts with those boundaries: shell runs inside an OS sandbox, Molly design tools and file access within the workspace run, and leaving the boundary is judged by a classifier using the session model, which falls back to the user when it declines or fails. Every automatic approval and user decision is recorded as authorization provenance.

Model requests, compaction and plugin sub-requests are all attributed to an explicit connection and usage record; the first version's title is generated locally from the user's first sentence. Bounded transport retries must not become replays of whole tasks or tool side effects. When cost has no reliable basis, show unknown or estimated.

### MCP and paid images

Reuse the workspace MCP catalog and per-turn selection, preserving the semantics of an explicit empty selection. Support the verified stdio/Streamable HTTP subset; tools have a stable namespace, origin and schema version. The tool set is frozen when a task is accepted, revocation blocks execution immediately, an in-flight schema change fails clearly, and new tools take effect at a safe boundary. Unimplemented capabilities such as sampling, elicitation and OAuth are not claimed as supported.

Keep the session/host capability gating of `molly_generate_image`, `molly_edit_image` and `molly_render_preview`. External image capability is bound through preset adapters or declarative field mapping; when binding is impossible it can still serve as an ordinary tool, honestly showing image capability as not ready. The image model must be explicitly configured by the user — never an LLM model name or a product default.

Built-in preview failures should identify repairable asset or font problems without exposing arbitrary server diagnostics. Asset admission supplies validated categories, safe relative paths and size/type facts through the existing local RPC/MCP boundary; only the built-in preview result can confer that classification. Unknown, external and transport errors remain redacted. These diagnostics do not authorize retries, repairs or a successful artwork commit; see the [approved design workflow](generative-layered-design-workflow.md).

URLs, base64, MCP images/resources enter the existing asset store only after origin, path, MIME, size, dimension and download-boundary checks. A remote file URI does not authorize local reads; redirects re-validate the target, and secrets are not forwarded to a new domain. An asset result itself never commits to or replaces the canvas.

Every managed paid operation persists its identity and authorization facts before sending, with states distinguishing prepared, dispatched, succeeded, failed, outcome_unknown. Protocol replay and reconnection only resume the same operation; the application never resubmits an unknown result. A failed or uncertain call returns to the Agent as an ordinary tool error, and any further call is a new operation the Agent chooses ([generative layered design](generative-layered-design-workflow.md)). A cancel signal does not prove the remote side stopped or that billing is avoided; late results only register as recoverable assets and do not restart an ended task.

### Execution, design commit and recovery

Before dispatch, first block new manual edits and complete the flush of all associated editors, verify the current projection, then freeze the input; the owning artwork stays readonly until execution and artifact processing end. Previews are readonly and subscribe per consumer presence; they do not decide success or trigger commits.

The adapter judges results from native errors, cancellation, unfinished tools and native run boundaries. A Promise resolving, a process exiting normally or a single agent_end does not independently prove success. Ordinary tool errors handled by the model may continue; errors, truncation, disconnection and missing settlement must not be misreported as complete success. Execution results are presented separately from design outcomes such as committed/no_artifact/conflict/validation_failed.

Recovery rebuilds only persisted facts. A task provably not yet dispatched may continue; when dispatch is unknown or the model stream broke, keep interrupted rather than resending just because no ACP output is visible. When execution finished but the commit receipt is unconfirmed, only resume the existing deterministic collection/CAS/receipt — do not re-invoke models or tools. Late events and authorizations from a retired worker must not settle new tasks. When native history is corrupted, keep the original files and diagnose clearly.

Design commits continue to independently validate schema, kernel replay, assets, trusted provenance and the current version; failures preserve the canonical, the drafts and the diagnostics. No new artifact can be a legitimate Q&A answer. No candidate approvals, read proofs, mandatory finalize calls, automatic repair or new history stores are added.

### Migration and support boundaries

Role selection, creation, management, migration, `@` expansion and new programmatic-create arguments are retired. New work selects its connection, model and reasoning directly. Stored Role rows and historical provenance remain readable but are not reapplied to new messages. Already accepted Operations recover their frozen configuration. See the Role retirement decision. This scope change returns this Spec to draft; the previous approval does not cover this revision.

Canvases, assets, drafts, chats and history are preserved in place. Old AgentConfig/Role entries keep their provenance and are not executable; when the user explicitly chooses "continue this design with Molly", a new Pi context is created carrying the explicit historical context and trusted assets. Old tool records serve only as historical data — they are not executed, and no cross-harness native identity is forged.

Migration has versioning, backups, re-entry markers and failure recovery, and sensitive backups remain credential-protected. In release builds, the chat, continue, task, Role, programmatic-creation, recovery, capability-probing and auxiliary execution entries must not start an external harness; reading old history must not secretly start the old runtime. Old caches are only preserved, or cleaned by a separate explicit action.

First-release native acceptance is macOS arm64; Windows/Linux completing builds and resource probes does not equal native support. Real Provider/MCP acceptance requires an explicit account, outbound scope and budget. Visual quality is judged by humans; mock tests, install success and structural correctness cannot substitute. Public release, Developer ID signing, notarization and update channels are handled under their own delivery conditions.

## Testing Decisions

There is exactly one primary test entry: starting from the real macOS arm64 installer, run R2's complete design journey with R3's settings, Q&A, cancel and reopen checks embedded. R4 adds the minimum necessary through the existing migration entries; no new test framework is built.

- Good tests observe user-visible results, actual runtime identity, save/commit receipts and old-data preservation; they do not assert private implementation details or mock call counts. Agent self-assessment is not human visual approval.
- Reuse the existing package resources and startup probes, the real Kimi/image records, canvas save/conflict/export verification, migration re-entry, and permission/ledger regressions; existing evidence is used only for the scope it actually covers.
- New defects get a minimal regression at the highest existing entry that reaches the real problem. Checks expand only for changes, failures or new explicit risks; modules with no related change are not repeatedly run in full.
- Secrets never leaking, unknown results never auto-repaying, cancellation never faking success, saved artworks never being overwritten and old entries never being executable remain the floor. Prefer reusing existing tests; if any of these floors is found broken it must be fixed — "reducing tests" is not a reason to skip.
- Basic image generation and editing use the user-configured service and explicit model. A connection test passing does not substitute for image generation/editing succeeding; complex masks, multi-image and full format combinations are outside this acceptance round.
- The final check round runs the affected scope's type/test/build and repository-required checks together. Before committing, still run the repository's required full check and format commands; documentation changes still run docs status/check. Existing unrelated failures are attributed honestly — never delete checks, rewrite history or investigate without bound.
- Stop adding performance distributions, long-duration stress, GC/object-count diagnostics, all-vendor exception combinations, repeated screenshots, and real calls made just to fill the matrix. Without an actually blocking performance problem, build no new performance gates.
- Keep valuable existing test code; what this round cuts is extra implementation and duplicate verification requirements, not the batch deletion of regression protection to make checks pass.

The test entry and the five close-out tasks' split have been confirmed; task confirmation does not replace formal approval of this Spec revision, which remains draft.

## Out of Scope

The following items move out of this round's remaining-delivery gate, without deleting the existing implementations: the Google fix and SDK upgrade; per-vendor/region/model real acceptance; the plugin command system; dedicated acceptance of complex masks, multi-image and all image-format combinations; the complete poster/infographic/long-image permutation matrices; an actual upgrade/uninstall drill against the user's local Pi; new Windows/Linux builds and native dedicated acceptance; long-term performance/stress/GC diagnostics. Existing automated checks remain; deferral is not a claim of support.

Still not included: a plugin marketplace, arbitrary native plugin installation, full TUI compatibility, external harness selection, local subscription-auth import, cloud-proxy billing, new multi-Agent orchestration, Bento/YAML/history rewrites, or an OS-level hard sandbox. Public release, Developer ID signing, notarization and automatic-update publishing are not part of this local-usable-version close-out.

Real startup problems of the local install artifact must not be filed under "release signing deferred" and skipped; do not bypass OS security prompts or lower existing security policies. While core fixes are incomplete, keep the clearly incomplete status.

## Further Notes

This round does not add another implementation phase or rebuild a verification platform — it converges the remaining delivery. The user stories describe complete user value and do not mean each story gets a new dedicated test. The original plan's A01–A20 no longer all require item-by-item re-runs; this delivery is judged by R1–R5 plus the preserved floors, with uncovered scope explicitly listed.

### Basis and verification status

The remaining work is published as [Installation and Kimi integration #46](https://github.com/LeonEthan/molly-design/issues/46), [Creation continuation and saving #47](https://github.com/LeonEthan/molly-design/issues/47), [Image generation/editing and replacement #48](https://github.com/LeonEthan/molly-design/issues/48), [Old-data continuation #49](https://github.com/LeonEthan/molly-design/issues/49) and [Final delivery #50](https://github.com/LeonEthan/molly-design/issues/50). The tasks use native blocking relationships; Issue creation and the ready-for-agent label are not evidence of implementation completion.

The repository audit baseline is `7c85b3b06cc227a4e9e0c0e61d769352754aaa00`. Implementation evidence, synthetic tests, resource probes and some real Kimi/image calls are in the implementation plan's progress records. The latest desktop rebuild and worker sync are done; the image-decode probe's path-alias false positive has been fixed and regression-passed, but full packaging still hits the Helper startup timeout, whose cause is not yet closed. R1 is therefore not complete. Some services passing does not mean all services, the installer, the community GUI or human visuals are accepted; the remaining work follows this revision's R1–R5, and the historical matrices no longer expand this round's gate.

- [Existing Agent responsibilities](../apps/cli/src/agent/README.md), [design pipeline](../apps/cli/src/design/README.md), [shared contracts](../packages/shared/AGENTS.md).
- [Pi v0.85.1 package manifest](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/package.json): the public package and the Node `>=22.19.0` requirement.
- [Pi v0.85.1 SDK documentation](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md): native sessions, ModelRuntime, resource discovery and default auth/model-selection behavior; closed loading and permission adaptation still need engineering verification.
