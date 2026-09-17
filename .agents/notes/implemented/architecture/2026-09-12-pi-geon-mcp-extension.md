# Pi tools through the existing Geon MCP host

Status: implemented
Translation: pending

## Abstract

Pinned pi-acp 0.0.33 receives but does not use ACP MCP server configuration, so
Pi cannot discover Geon image and render tools through that adapter. A public
Pi extension can register tools without modifying Pi or ACP. The implementation
uses the existing MCP SDK and daemon HTTP host for three Geon tools only; it
retains their real catalog, session identity and provider behavior. Source tests and isolated real Pi/ACP transport tests pass. Installed image-service
generation/editing and actual image reading remain unverified for this extension.

## Contract and implementation

The pinned Pi 0.85.1 public extension documentation supports awaited async
factories, dynamic `registerTool`, `before_agent_start`, `setActiveTools` and
`session_shutdown`. Its pi-acp 0.0.33 distribution stores `mcpServers` in the
session constructor but never consumes that field to create tools. Existing
installed catalog evidence remains historical fact, not proof against native Pi
extension capabilities.

`pi-launch.ts` passes only a trusted child configuration built from the existing
HTTP endpoint and `buildLodyMcpHttpHeaders`: Session, workspace, machine, workdir
and task-tool gate. The existing launcher loads a separate extension alongside
the design extension. No hook proof, save, projection or collector implementation
is changed. The three-tool allowlist excludes external MCP servers and unrelated
Lody task/session capabilities; their selection is not copied or broadened.

The extension reads the actual MCP catalog initially and before Agent generation.
Only listed image generate/edit and render tools become active. Existing native
inactive choices survive a refresh. Arguments and schemas come from MCP, results
preserve text/image content, errors remain failures, and calls propagate native
cancellation signals. Ordinary Pi tool policy and user extensions still receive
native tool events; this adapter neither fabricates ACP permission requests nor
answers them automatically. Pi's lack of a Manual mode is unchanged.

The daemon still validates image-connection readiness, required explicit model,
Session identity and owned workspace paths. Image calls create assets only.
MCP credentials remain child environment values and are never logged. Clients close on native session shutdown. HTTP tool calls use independent SDK
connections: closing the actual transport on native abort is necessary because
stateless HTTP cancellation notifications cannot identify another request’s
Server instance. This does not implement or change a protocol. The stdio fallback
uses the existing bundled MCP process and standard SDK cancellation/ownership.

## Limits and verification

The existing HTTP supervisor does not block local readiness, so its endpoint may
be absent at first launch. The implementation therefore reuses the bundled
`__internal lody-mcp-server` stdio entry, Session/workdir/socket context and SDK
transport as the existing AgentClient does. No fixed startup wait or replacement
server is introduced. The isolated data root is forwarded explicitly because the
SDK stdio environment is an allowlist. When HTTP is present it remains preferred.

Two deterministic tests use the real SDK with its in-memory transport: exact
three-tool catalog/schema/arguments/results, error propagation, live removal,
retention of explicit inactive choices, and refusal after shutdown. CLI type
checking passes. The full repository check passes after correcting the SDK stderr type to use a
data listener. The initial full-check type failure is retained in its external
log. Package resource validation and installed Pi image-service
generate/edit/render/read tests remain pending. These results do not establish
paid image quality or satisfy the entire five-Agent acceptance matrix.

## Isolated native transport evidence

Local probes use actual Pi 0.85.1, pi-acp 0.0.33, the existing executable launcher
and the new bundled extension, with a private HOME and Pi provider directory.
The model and MCP endpoints are synthetic loopback services; returned text is
protocol evidence, not generated imagery or actual Geon image-service output.

The first two attempts (`WXCUmo`, `anJxqX`) fail during session startup. Pi’s public
loader makes action methods unavailable during factory loading; moving active-tool
refresh to `session_start` corrects this API misuse. ACP discards native stderr,
so the first errors alone do not prove a unique cause. `sFO6rq` then proves tool
visibility and forwarding, but its held MCP handler does not observe cancellation.
That failure is retained; passing the native signal to `callTool` alone was not
sufficient for stateless HTTP.

After independent HTTP call ownership, `dYVJDo` (handle 15730, exit zero) proves
three actual tool calls/results and held-request cancellation at the synthetic
MCP handler. `9tQDy7` (handle 47491, exit zero) proves the same through the SDK
stdio transport, including the child’s recorded exit. This latter probe checks
the actual null-endpoint launch configuration, then substitutes a synthetic MCP
entry for isolated transport testing; it does not claim the production stdio
entry’s image gates were exercised. Both probes close the original ACP stdin and
await its exit, clean the launch shim and close their hosts. No Electron or paid
service runs. Evidence remains outside Git under `folio-pi-mcp-native-*` in the
system temporary directory.

## Outcome and evidence

Status: implemented. The Pi MCP extension is committed in
`apps/cli/src/design/pi-mcp-extension.ts` with tests in
`apps/cli/src/design/pi-mcp-extension.test.ts`. It registers the allowed
image/render tools through Pi's public extension API, reuses the existing MCP SDK
and daemon HTTP host, and propagates native cancellation. Source tests and
isolated native Pi/ACP transport probes pass. Installed image-service
generation/editing and actual paid image reading remain separate unverified items.
