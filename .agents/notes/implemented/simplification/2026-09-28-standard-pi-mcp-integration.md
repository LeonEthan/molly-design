# Standard Pi MCP integration

Status: implemented
Translation: pending

## Abstract

Molly's embedded Pi runtime now loads the unmodified `pi-mcp-adapter` 3.2.0 through its public extension factory. The built-in image server saves generated or edited images and returns ordinary file results; the client-specific bridge, paid MCP journal, private image import and recovery tools are removed. MCP connections and protected credentials last for the selected session, while existing host catalog revocation and permission handling remain. Synthetic source and packaged-runtime checks cover file use, history, approval, cancellation and multi-turn execution. Subsequent user testing confirmed image generation and website research after separate browser fixes; that evidence does not establish complete provider or release acceptance.

## Decision and ownership

This implements the ordinary chain selected in the [migration triage](../../proposed/architecture/2026-09-28-pi-mcp-adapter-triage.md): `Pi Agent → pi-mcp-adapter → Molly image MCP server → image service`. It replaces the MCP-specific guarantees in the earlier [embedded harness implementation record](../../proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md) and image-client portions of the [layered design implementation](../feature/2026-09-24-generative-layered-design-workflow.md). Those records and prototype archives remain historical evidence. The [Spec](../../../../specs/molly-embedded-pi-harness.md) remains draft; implementation and tests do not approve it.

The supported `createMcpAdapter({ config })` factory receives selected server configuration. Pi's ordinary extension loader and lifecycle own tool discovery, results, reconnect behavior, resources and scripting. The published approval event connects individual MCP calls to Molly's existing permissions. Molly does not patch the dependency, substitute a transport, replay private receipts, or require an upstream PR. The host continues to own selected catalog identity, credential storage/revocation, agent execution and native tool guards.

Protected MCP values arrive over the existing private pipe before session creation and stay available for that session. Catalog or credential revision changes retire the worker, including while idle. Model credentials remain run-scoped. Ordinary prompt completion does not reconstruct the native session or reconnect MCP. Closing a worker emits Pi's standard session shutdown event. Existing saved native history, artwork and asset files are not rewritten or deleted.

The image MCP server always uses its existing ordinary generation/editing path and returns saved paths and media facts. Generic file reading supplies pixels back to the model. Removed machinery includes the alternate inline-byte response, private host import/recovery callbacks, MCP operation journal, per-turn preparation RPC, client image mapping execution and the mapping editor. Legacy saved mapping metadata remains readable but is not executed.

## Packaging and trade-offs

The dependency is pinned at 3.2.0 with its full resource/dependency closure. Build-time esbuild compiles the published TypeScript entry to JavaScript and adjusts only the staged package entry points. The original source is not patched; scripting workers, skills and native resources keep their relative paths. Exact minimum-release-age exceptions admit `pi-mcp-adapter@3.2.0` and its published `smol-toml@1.9.0` dependency without changing the workspace age policy globally.

The stock adapter owns its timeout, cancellation, recovery and output semantics. There is no Molly exactly-once paid MCP guarantee, private recovery ledger or automatic repair. User-selected image models and server-side credential/parameter/file validation remain. A cancellation cannot establish that an external service did not charge or finish work.

Stdio configuration uses the adapter's published literal environment and no-inheritance options. HTTP header command prefixes are escaped using its documented literal syntax; values containing supported environment-interpolation expressions are rejected because this release has no literal-header option. This is an explicit configuration limitation rather than a dependency patch. HTTP credentials use the selected destination and explicit `auth: false`; no new OAuth setup is introduced.

## Verification

- Real Pi sessions with the published adapter: ordinary generated file followed by native image reading, service errors, two turns on one connection, saved-history continuation, denied approval, cancellation with a late approval, and the stock scripting worker's per-tool approval path.
- Host tests: private credential delivery before session creation, multiple turns on one MCP lease, idle credential rotation retiring the worker, native permissions and image MCP generate/edit/file results.
- Standalone sealed bundle: startup, protected MCP, question UI, compatible model, two synthetic turns, active model-stream cancellation and a subsequent turn. No external model or image endpoint is contacted.
- Full Electron build and unsigned macOS arm64 packaging passed. After-pack checks loaded the sealed Pi closure and native image/SQLite dependencies. The packaged Helper executable passed the same multi-turn protected-MCP and scripting probe with synthetic credentials.
- `pnpm check` passed: workspace type checks, lint, script tests, package tests, translations and platform/public-repository boundary checks. This includes 213 Pi harness tests, 1,319 shared tests, 3,198 component tests and 3,031 CLI tests (three existing CLI skips). Synthetic Git remote tests required process-local `GIT_CONFIG_COUNT=0 GIT_CONFIG_GLOBAL=/dev/null` to omit this runner's injected URL rewrites; no user Git configuration was changed.
- Prettier checks for changed source/configuration files and `git diff --check` passed. At initial verification, `pnpm run docs check` reported three preexisting metadata errors in the unpacked `molly-mcp-integration-review/REVIEW.md` bundle; the later [rejected candidate record](../../rejected/architecture/2026-09-28-molly-mcp-host-managed-candidate.md) preserves that bundle intact and corrects its documentation placement. Historical links affected by deleted source use the base-commit permalink; no registered SHA topics required confirmation. No commit, push or publication is part of this change.

The required advisory Codex CLI second opinion was attempted earlier and failed before analysis with `failed to initialize in-process app-server client: Operation not permitted (os error 1)`. It was not retried or treated as an approval. Signed installers, other platforms and real provider billing remain outside this synthetic verification.

Subsequent user-run desktop tests exercised real image generation and reported no
further crash after the [navigation fix](../bug-fix/2026-09-28-browser-response-navigation-crash.md).
The user also confirmed website research after the [IP normalization fix](../bug-fix/2026-09-28-browser-response-ipv6-normalization.md).
The [chat image fix](../bug-fix/2026-09-28-chat-local-markdown-images.md) was visually
verified in the existing conversation using already-saved images, without a new
Agent turn. These are scoped acceptance observations, not evidence that every
provider, image-edit operation, interrupted-run recovery, or release journey has
passed manual testing.

## Integration with personal memory

[PR #48](https://github.com/LeonEthan/molly-design/pull/48) merges the personal-memory
feature from main without changing either lifecycle. The existing daemon memory
service and run-bound callback are reused; their constructor/configuration wiring
is adapted to the standard adapter. The host retains active run identity for memory
authorization, while removed image callbacks and per-turn MCP preparation remain
retired. Recall follows the duplicate-run fence, and extraction uses the owning
run's model credential before retirement. Choosing either conflicting file wholesale
would discard memory or restore the retired bridge, so the resolution preserves the
independent responsibilities. Regression coverage checks memory during its owning
run and refusal after cancellation or settlement, alongside the existing adapter
and extraction tests. No live provider request is needed for this merge validation.

## Stdio environment review follow-up

Codex's [PR #48 review](https://github.com/LeonEthan/molly-design/pull/48#discussion_r4130731223)
identified missing sanitized launch variables in the explicit stdio environment.
The pinned MCP SDK supplies PATH and HOME itself, so the bare-command failure
claimed in the review did not reproduce. The real adapter probe did reproduce
missing LANG and ELECTRON_RUN_AS_NODE, which are allowed by Molly's existing tool
environment policy. Configuration now reuses `createToolEnvironment(process.env)`
before applying server settings and protected credentials. Unrestricted inheritance
is unnecessary; the adapter and transport remain unmodified.

Before the fix, the actual child omitted those two approved variables and the
configuration omitted PATH. After the fix, the same synthetic stdio probe launches
a command available only in a temporary PATH, generates a file, and observes the
approved environment without parent model credentials or private control values.
A separate test verifies override precedence and exclusion of runtime injection
and proxy variables. This is synthetic process evidence, not acceptance for every
user-installed MCP package or native platform.
