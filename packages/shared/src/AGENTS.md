# Shared source contracts

`CLAUDE.md` symlinks here; edit `AGENTS.md` only.

## Embedded harness credentials

`harness/host` v1 and `mcp/catalog-entry` stay main-only; renderer Machine RPC rejects them.
Vault metadata/reports use the owner-only socket, never Loro. Consumption requires a matching
dispatcher-owned model run/epoch or selected MCP session/epoch lease; only explicit Settings
`ListMcpToolsSchema` discovery of the exact binding is exempt. RPC returns work, never secrets;
no body/validation-input logs. Empty model grants need compatible bindings; signed-out
metadata is main-owned. References stay separate from selection: no empty-model fallback,
snapshot secrets or dispatched-work replay. Native `models` only narrows the picker;
dispatch, not schemas, owns availability.

Compatible connections preserve their protocol across saves, reloads and run grants;
missing protocol means OpenAI Chat Completions. Responses/Gemini base normalization
is shared by discovery, response checks and runtime. Final model diagnostics expose
static failure categories only, including endpoint-not-found and unreachable.

Compatible Responses/Gemini require nonempty keys; legacy Anthropic Messages and
Chat Completions retain explicit keyless connections.

## Title input provenance

The optional Turn `titlePrompt` is captured before internal prompt construction and
canvas-size scaffolding. Preserve it through input normalization independently of the
execution `prompt`; absence provides no safe naming input. Runtime title ownership:
[CLI Agent rules](../../../apps/cli/src/agent/AGENTS.md#capabilities-and-titles).
