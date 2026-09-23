# Shared protocol and workspace catalog contracts

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Read before changing daemon negotiation, MCP/Role catalogs or UI, per-turn MCP
selection, or Role dispatch. These contracts bind producers and consumers.

## Machine protocol negotiation

- Daemon-backed workflows negotiate versions through
  `MachineMeta.protocolCapabilities`; never infer from the CLI release. Missing
  capabilities mean unsupported. Set and version checks share one binding in
  `packages/shared/src/machine-protocol-capabilities.ts` so a key never travels
  without its version.

## Workspace MCP and Agent Roles

- MCP catalog writes own monotonic revisions; caller revisions and clocks confer no
  execution identity. Historical rows remain readable until explicitly saved.

- Workspace MCP has exactly two durable layers: catalog entries in the workspace Flock
  document and selected ids in each user turn input config. Do not add machine bindings.
  Preserve `mcpServerIds: []` as an explicit empty selection; dispatch must carry the
  driving turn's selection into ACP startup rather than rereading session history.
- MCP/Role writes resolve on local Flock durability, then upload. Settings neither
  await nor report upload; its failure cannot fail or roll back the write. CLI
  reports sync results. See
  [catalog explanation](../../.agents/docs/workspace-catalog-durability.md).
- Roles share one Flock `agentRole` family; sharing changes `visibility`. Exclude
  secrets, API keys, MCP selections and memory; apply
  `isSensitiveAgentRoleConfigOptionKey` on read/write. Permission pins
  (`runConfig.modeId`/`_permission`) hide the composer permission button but retain
  visible warning modes. Role-level auto-approval policy stays out of scope.
  Settings/mentions use `canReadAgentRole`/`canManageAgentRole`; MCP resolves explicit
  catalog ids without mention-scoped authorization.
- Explicit Role migration commits an immutable, normalized source backup and the
  new config in one row. Recheck source before writing; reject stale retries and
  backup removal. Backup run options are history only, never execution defaults.
- Roles bind exact `machineId + agentConfigId`, never fall back, and remain listed
  with reasons but unmentionable for retired engines, overrides, stale catalogs or run config.
  Before Operation acceptance, MCP resolves the current `agentRoleId` row and freezes
  canonical Prompt, target, Role revision, and dispatch config into the Operation;
  edits/deletion cannot change recovery or retry. `SessionMeta.agentRoleId` and
  `agentRoleRevision` are display-only creation provenance.

## Embedded harness credentials

`harness/host` v1 is main-process-only; renderer generic Machine RPC rejects it.
It carries ciphertext-store metadata and in-memory credential reports over the
owner-only local control socket, never Loro. Only a dispatcher-owned active
run/epoch lease can consume a matching report. RPC results contain pending work,
not secrets. Never log exchange bodies or return validation inputs in errors.
`embedded-harness` schemas separate connection references from model selection;
no empty-model fallback, snapshot secrets or dispatched-work replay. Session
dispatch owns runtime availability; schema presence does not enable execution.

## Image connection RPC

- `design/image-connection` carries `ownerSessionId`. Secret-free `available` requires
  design meta and complete protected metadata. `acquireCredential` additionally requires
  an active dispatcher-owned run; only then may `ready` carry a credential. Renderer
  generic RPC rejects this method. Missing/deleted/unreadable meta is unavailable;
  lookups never create/write Session documents. Settings discovery uses main-only
  vault IPC; the legacy daemon probe refuses. `artworkWorkdir` and `workspaceRoot`
  come from the live Session and frozen context, never MCP caller paths.
- Image models are user-required: preserve explicit stored models, never fill empty ones.
  Generate/edit share readiness; image-reading, attachments and rendering remain independent.

## Machine RPC: render bridge

- `design/render-preview` asks the daemon's render host to rasterize ONE session's project; it
  carries `ownerSessionId` and the daemon resolves the workdir from it, never from a caller path.
  `design/render-host-status` is its availability probe, and `design/render-host` is the host's own
  poll: the desktop calls the daemon, never the reverse, so the bridge adds no inbound surface.
- The preview answer uses a nested `ok` union within `type`; add variants at the
  correct nesting level.
- Capability exists only while a host polls within `DESIGN_RENDER_HOST_TTL_MS`, and the poll
  interval must stay well under it. Both ends bound one exchange at 8 items (work out, reports
  back); the daemon's queue ceiling and the request schemas must move together.
- Preview work uses document canvas dimensions. Turn completion never generates
  thumbnails. Ignore legacy optional outcome fields without rewriting history;
  image reading and PNG/JPEG exports remain independent.

## Browser RPC

`browser/execute` uses the owner-only socket and binds run/launch/page.
Recheck results; never replay uncertain actions. Import Chrome accounts in
Electron main only. Models see flat `AgentBrowserToolInputSchema`; validate
with `AgentBrowserCommandSchema` before execution. See
[browser docs](../../.agents/docs/sessions-browser.md).

## Installation identity

Molly's public local profile uses machine token `molly`. Isolate its data,
endpoint, protocol, app ID, packaged identity and CLI markers from Lody.
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
