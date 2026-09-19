# Shared protocol and workspace catalog contracts

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

These contracts bind producers and consumers, including UI and CLI callers outside
this package. Read them when changing daemon protocol negotiation, MCP/Role catalogs,
per-turn MCP selection, or Role-based session creation and dispatch.

## Machine protocol negotiation

- Daemon-backed workflows negotiate versions through
  `MachineMeta.protocolCapabilities`; never infer from the CLI release. Missing
  capabilities mean unsupported. Set and version checks share one binding in
  `packages/shared/src/machine-protocol-capabilities.ts` so a key never travels
  without its version.

## Workspace MCP and Agent Roles

- Workspace MCP has exactly two durable layers: catalog entries in the workspace Flock
  document and selected ids in each user turn input config. Do not add machine bindings.
  Preserve `mcpServerIds: []` as an explicit empty selection; dispatch must carry the
  driving turn's selection into ACP startup rather than rereading session history.
- MCP/Role catalog writes resolve on local Flock durability, followed by explicit
  upload. Settings neither await nor report upload; upload failure must not fail or
  roll back a durable write. CLI reports its sync result. See
  [catalog explanation](../../.agents/docs/workspace-catalog-durability.md).
- Roles use one workspace Flock `agentRole` family; sharing updates `visibility`.
  Store no secrets, API keys, MCP selections, or memory; apply
  `isSensitiveAgentRoleConfigOptionKey` on read and write. Roles pin permission via
  `runConfig.modeId` or `_permission`; hide the separate composer permission button
  when pinned, but keep warning-tone modes visibly marked on every such surface.
  Role-level auto-approval policy is out of scope. Settings/mentions use
  `canReadAgentRole`/`canManageAgentRole`; MCP resolves explicit Role ids from the
  catalog without requiring mention-scoped authorization.
- Roles bind exact `machineId + agentConfigId`, never fall back, and remain listed
  with precise reasons but unmentionable when machine/config/model/mode is unavailable.
  Before Operation acceptance, MCP resolves the current `agentRoleId` row and freezes
  canonical Prompt, target, Role revision, and dispatch config into the Operation;
  edits/deletion cannot change recovery or retry. `SessionMeta.agentRoleId` and
  `agentRoleRevision` are display-only creation provenance.

## Machine RPC: image connection

- `design/image-connection` answers the capability question for ONE session: it carries
  `ownerSessionId`, and `ready` (with a non-null `credential`) requires that session to have
  design meta AND the machine's row to be complete and enabled. Absent, deleted, or unreadable
  session meta is unavailable, and the lookup must stay read-only — never create or write a
  session document to answer it. `design/image-connection-test` is machine-scoped and carries no
  session identity: a settings surface must work before any session exists. Optional
  `artworkWorkdir` and `workspaceRoot` come only from the live Session and validated
  frozen context; image calls require both, never fall back to an MCP-provided path.
- Image models are user-required: preserve explicit stored models, never fill empty ones.
  Generate/edit share readiness; image-reading, attachments and rendering remain independent.

## Machine RPC: render bridge

- `design/render-preview` asks the daemon's render host to rasterize ONE session's project; it
  carries `ownerSessionId` and the daemon resolves the workdir from it, never from a caller path.
  `design/render-host-status` is its availability probe, and `design/render-host` is the host's own
  poll: the desktop calls the daemon, never the reverse, so the bridge adds no inbound surface.
- The preview answer is a **nested** union — rendered and refused share the `type` and differ in
  `ok` — because a discriminated union cannot hold two options with the same discriminator value.
  Adding a variant means adding it to the nesting level it belongs to.
- Capability exists only while a host polls within `DESIGN_RENDER_HOST_TTL_MS`, and the poll
  interval must stay well under it. Both ends bound one exchange at 8 items (work out, reports
  back); the daemon's queue ceiling and the request schemas must move together.
- Preview work renders at the document's canvas dimensions. Turn completion never
  generates dedicated thumbnails or writes their references. Legacy optional
  outcome fields are ignored in the read view without rewriting history or deleting
  files. General image reading and PNG/JPEG exports remain independent.

## Installation identity

The public local profile is Molly (machine token `molly`). Keep its data
directory, host endpoint, protocol, app ID, packaged desktop identity, and every
CLI marker store isolated from Lody.
Update both TypeScript and CommonJS installation profiles together; never migrate
or delete Lody data.

## Local reference attachments

- Negotiate `localSessionAttachments` before reserved-session uploads or attachment
  identity parameters on `file/resolve-local`. Only the local desktop may stage
  bytes before Session creation; the reserved Session ID remains their storage owner.
- Attachment reads match the sent history's file ID, hash and owning machine,
  validate blob bytes, and reuse Electron's opaque local resources. Never derive a
  blob path from a caller filename or fall back to authenticated cloud reads.

## Machine RPC: canvas preparation

`designCanvasSerialEditing` versions the desktop flush handshake. The daemon's
visible-turn owner supplies whole active snapshots; a preparation report is bound
to artwork and owner token, never an unlock signal. View removal and transport
failure leave ownership intact. Keep this independent of preview rendering.

## Historical design files

`design/source-path` may report active canvas/source turn identities for display
isolation; these facts confer no commit authority.
`design/source-path` uses trusted Session workspace metadata, including archived
Sessions. An omitted turn resolves today's expected entry even before creation.
Supplied turns require the frozen original root and an existing regular entry;
never substitute today's draft, trust a manifest path as authority or start an
Agent. Ordinary file preview transports bytes.

## Native design hooks

`design/tool-hook` version 2 binds native settlement and explicit submission to the
live Session launch/client/source, never caller provider names. Reject retired
version 1 generation/read events. Exact resubmission checks supplied revision and
draft digest for all supported design Agents, independently of hook/image/render
support; it grants no commit authority. Pi native settlement remains separate.
Public reminder hooks do not establish read proofs or authorize writes.

Design continuation freezes `ACPSessionConfig.agentConfigId`; normalization and
dispatch preserve it. `SessionMeta.acpSessionAgentConfigId` identifies the provider
that owns the persisted ACP ID, independently of the next selected provider.

## Isolated title defaults

Unconfigured title models retain the new ACP session's current model; catalog order
never chooses a model or endpoint. Persist model keys only for explicit title
selections. Preserve existing stored overrides without inferring their provenance.
