# Electron service contracts

`CLAUDE.md` links here; edit `AGENTS.md` only.

## Model credentials

Capability IPC verifies adjacent CLI package/catalog digests and public fields without
SDK/vault access; absent/incompatible resources are unavailable.

`model-connection-store`: main-only metadata IPC, never grants.
Encrypt; unavailable OS storage/Linux plaintext fail closed. Endpoint/provider edits
require explicit credentials; empty keys are compatible-only, omission preserves.
Grants bind run/epoch/revision; vault grants no authority. Declarations share row/revision;
no keys, headers, scripts or model destinations.
OAuth refresh/mutations queue per row; I/O outside vault lock, CAS the grant.
Sign-in binds ID/revision, preserves IDs; provider collisions fail.
OpenAI: reuse client/host/subject; validate JWT signature/issuer/audience/expiry/nonce.
Auth URLs stay in main; encrypted hints survive refresh, not sign-out.
Sign-out keeps disabled, token-free registration; Delete forgets it. Add cannot overwrite it.
Cancel before revocation/commit; never restore revoked grants. Revoke unretained
provider/client/refresh-token grants; report unconfirmed sign-out revocation.
Image grants share the vault. Legacy removal needs durable encrypted backup/exact row;
disclose history/backup residue. Grants need active runs except main-only saved checks.
MCP binds workspace/server/destination/revision. URL/stdio command/args edits need new inputs.
Settings derives local workspace; returns no values.
Grants require selected Session/epoch, except explicit Settings tool listing of the
exact catalog binding; values travel only to CLI helper stdin. Saving enables nothing.
Header framing/isolated env fields cannot be credentials; enforce vault size limits.

## Design canvas contracts

Views accept validated CLI documents without Node, preload, permissions or network.
Bind saves to Session/host; CLI owns bytes, Electron renders/dialogs. Retain hidden
editors; close saves before disposal. Covered hosts gate native reveals;
compositor captures are transient, never saves or exports.
Canvas leases are exclusive, even for same-artwork siblings, with fresh origins.
Dispose payload callbacks before handlers and contents. Reuse requires destruction,
drained requests and successful storage/cache cleanup; failures stay denied.
Recheck lease liveness after awaits before mutations; Session identity is reusable.
Hidden editors retain their lease. Run native `canvas:resources` for lifetime changes.
Source previews never register for save/flush; preserve
canonical instances and reject late results after consumer/source changes.
Source previews share exact dependency watches and serialized conversion only
while consumers exist; release both with the last consumer. Re-observe new
dependencies after installing watches. Watch `design.yaml` and needed `media/`; leftover `.pptd` is not a watch or import source. Reject
old source/turn/view generations; previews never commit or update Agent baselines.
Valid frozen frames may publish while newer bytes are queued; render serially.
New instances/container-size changes fit the full artwork to viewport.
Unchanged retained instances keep manual zoom across hide/show.
For visible windows, keep outgoing pixels until the replacement has decoded resources,
fitted its viewport and completed a compositor capture. Promote before disposal; turn completion does
not close the visible preview before the canonical editor is ready.
Preparation may precede input identity: establish the entry watch and bind that
identity on observation. Reconcile this startup handoff even without another file
event; stop the reconciliation when bound or released. Cancellation retires loading native surfaces as well as
the visible preview; late loads cannot reveal a closed canvas. Canonical editors
may finish loading while hidden, but initial display and viewport fitting
must recheck the current host's visibility intent.

`design-canvas-access` gates actual human writes and flushes all artwork instances
before dispatch. Execution state comes from the versioned daemon canvas-host
snapshot; unknown is readonly. Ownership is view-independent; reject
dirty/composing/saving reloads. Bento stays element-naive:
it receives generic readonly/flush plus zod-validated selection property and
element-creation commands (`window.molly.applyCommands`, one kernel batch per
command) and reports
zod-validated selection summaries; every element semantic lives in
`@molly/shared/design-selection-commands`, never in Electron. All canonical attaches
share the pending opening and wait until Bento publishes its generic
state/snapshot/flush/readonly/commands API and reports the real ready state; a navigation or
DOM load event alone is not canvas readiness. Before changing these boundaries, read
[design resources](../../../../../packages/design-bento/README.md).
The preview host uses the same local socket, independently of canvas preparation.
Keep render policy in Node-testable `design-render-host-core.ts`: no retries, repair or
per-turn thumbnails; sidebar ones cache the saved revision. Previews use canvas size.
Worker history resolves files by artwork/digest; local resources serve original
bytes/embedded assets.

Git history restores into the editable current draft. Save-version/switch flush through
the artwork mutation gate; protect unversioned content in Git before canonical CAS.
Persist base/operation identity outside BentoDoc; distinguish successful disk writes
from canvas reload failures. Execution/artifact processing blocks both actions. Source
display binds to the authoritative active turn, excluding unchanged inherited draft bytes.

Element references originate only from visible canonical selections while idle.
Capture IDs before flush and pair them with its saved revision; never rebase stored
composer references. Validate artwork, revision and IDs again before dispatch.

Native toolbar requests bind to their isolated protocol session and retained host;
recheck that identity after asynchronous queries and check the selection epoch at
application/capture. Clean selections reuse their saved revision without freezing
controls. Passive composer mirroring waits for autosave when a sibling is dirty,
composing or saving; explicit reference actions still flush siblings together. Geometry
never travels through IPC. Presentation: theme, labels and action availability only.

Image context actions check image kinds in that saved canonical document, then
insert a target mention and editable prompt into the ordinary composer; only Ask
Molly and numbered notes may send as an ordinary turn. None mutates artwork or runs image jobs.

Quit flushes editors before sealing design-worker requests; cancelled flush leaves
the service usable. Drain accepted requests even without open editors, end worker
input and await child exit before quitting. Closed workers never restart.

## Browser account imports

Import reads metadata; one profile continues, multiple need selection. Preserve
typed file/Keychain failures; settings only for EPERM file denial. Prepare before
Agent pause/isolation. One raw profile read; main filters IDs, validates fields and keeps
values/keys. Count CHIPS/expiry skips. Isolate pages/Workers/network; preflight quotas,
merge exact identities, verify writes/rollback. Failed recovery holds browsing until
explicit clearing. Revoke late reads; retain native leases until settlement, drain
writes on quit. Retry is explicit; never auto-resume.

## Agent browser driver

Keep agent-browser private behind strict actions; bind refs to observation/lease/document.
Invalidate untrusted WebMCP handles on events; check once at dispatch. Keep the pinned
CDP adapter unchanged: one token-gated loopback connection to the granted page/descendants.
Revocation detaches synchronously before cleanup. Human input opens only during synchronous
CDP Input dispatch. Own each daemon/private config. Unknown outcomes never replay;
polling never cancels WebMCP work. Retain Chromium network/proxy/TUN and image
body/redirect/Cookie bounds. Native downloads never publish assets; result/cancel bypass readiness.
