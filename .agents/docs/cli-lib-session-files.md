# Session file attachments in the CLI

Local attachment bytes live in `session-file-blob-store.ts` under the Molly
installation profile. `message-handler.ts` stages user-picked files through
`session/file-send-local`; MCP `molly_upload_files` and `molly_upload_images` also stage
agent-shared files locally, with workspace containment for agent paths. New history
blocks use `transport: 'local'` and the owning machine ID. No new attachment is
uploaded or backfilled to the retired product relay.

`materializeSessionFileAttachments` copies the bytes to the session workspace's
attachment directory and sends ACP `resource_link` blocks with `file://` URIs. A
human reference image also keeps its ACP image block for visual context. Local
`file/resolve-local` resolves a sent attachment from Session history identity,
checks machine ownership, blob size and hash, then lets Electron issue a bounded,
renderer-lifetime resource URL. An RPC turn may arrive before its history entry;
the resolver waits for the existing `TurnHistoryGate` and rechecks history. A
staged blob without a durable history block never receives a resource capability.

For a historical `transport: 'r2'` row, the same RPC may read a byte copy left
by an older Molly relay backfill under `_backfilled/`. Because the history row
contains the relay id while that directory contains the former local id, lookup
matches the recorded byte length and SHA-256 before Electron receives a resource.
These legacy bytes are no longer quota-purged: the retired product cloud cannot
serve as their recovery copy. A row with no retained Molly byte copy stays
unavailable and never causes a product-cloud request.

Agent ACP `image`, `resource`, and local `resource_link` output is materialized as
local file blocks. Supported raster image files display inline through the same
local resource channel; other files offer bounded text preview and raw-byte
download. `resource_link file://...` output is accepted only inside the session
workspace. Retired relay file records and `.r2meta` markers may still appear in
historical data, but this local runtime neither creates nor advances them.
