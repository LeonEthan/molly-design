# MCP display names at the native Pi boundary

Status: implemented
Translation: pending

## Abstract

Molly's connection catalog permits readable labels containing spaces and non-ASCII
characters, while Pi's native MCP configuration only permits letters, digits,
underscores and hyphens. Passing the catalog label directly caused selected servers
to fail during session creation. The existing ACP-to-Pi adapter now derives a short
native identifier for incompatible labels and preserves the readable label in the
server description. Synthetic tests reach actual Pi startup and MCP calls; packaged
desktop and real-service regression remain separate acceptance work.

## Cause and repair

The catalog validator in `packages/shared/src/workspace-mcp.ts` accepts nonempty
display names. The guarded selector in
`apps/cli/src/agent/session-mcp-resolver.ts` already supplies the catalog identity
and revision through `_meta.mollyConnection`. Pi 1.0.4's
`validateMcpServerConfig` requires `/^[A-Za-z0-9_-]+$/`, so the unadapted display
label was rejected before the user's model request began.

`packages/harness-pi/src/mcp.ts` now uses this existing metadata when adapting an
incompatible label. A short SHA-256 identifier preserves its native identity across
changes between incompatible labels and revisions. Standalone ACP entries without
catalog metadata derive the identifier from their original name. The readable label
precedes any existing description in Pi's native server summary. Valid native names
remain unchanged, avoiding changes to previously usable tool names. Duplicate native
identifiers fail before registration rather than overwriting a selected server.

Only in-memory native configuration changes. Catalog entries, selected IDs, revision
fences, protected credential bindings, tool exposure rules, saved histories and the
published Pi package remain unchanged. Renaming between an incompatible label and a
valid native name intentionally changes the native tool namespace; recorded history
remains historical and is never replayed.

## Reuse and alternatives

The existing `acpMcpConfig` boundary, catalog metadata, native description and Pi
registration API supply the required seams. Directly reusing the display name fails
Pi validation, so this adapter needs a small naming adaptation. Rejecting descriptive
labels only in the settings form would leave historical saved entries broken. Replacing
every name with an identifier would unnecessarily change existing usable namespaces.
Simple punctuation-to-underscore replacement would collapse distinct labels to one
namespace. No new UI field, catalog storage, transport or dependency patch is needed.

This repairs the existing selected-server startup behavior without changing the intent
of the draft [embedded harness Spec](../../../../specs/molly-embedded-pi-harness.md).
The native MCP lifecycle remains owned by Pi as described in the
[integration record](../simplification/2026-09-28-standard-pi-mcp-integration.md).

## Verification and limits

- `pnpm --filter @molly/harness-pi exec vitest run tests/adapter-mcp.test.ts`:
  18 tests pass, including actual native Pi initialization and synthetic MCP calls
  with English spaces and Chinese punctuation in selected connection labels.
- `pnpm --filter @molly/harness-pi run typecheck`: passes.
- Additional assertions cover readable summaries, identity retention after a catalog
  rename/revision change, distinct punctuation labels, and collision refusal with an
  explicitly named native server. Existing valid-name, credential and literal-value
  coverage remains in the same suite.
- The fixtures use an owned synthetic stdio server and a synthetic model provider;
  they make no real model or image request. Packaged UI, real Filesystem MCP,
  repository-wide checks and the independent review are delegated to the parent task.
