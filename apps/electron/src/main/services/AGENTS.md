# Electron service contracts

`CLAUDE.md` links here; edit `AGENTS.md` only.

## Model credentials

Capability IPC reads fixed metadata beside the resolved CLI entry, validates package/catalog
digests and returns public fields. No SDK import or vault access; missing/incompatible
resources mean unavailable.

`model-connection-store`: main-only IPC save/delete/public metadata, never grants.
Persist encrypted bytes; unavailable OS storage/Linux plaintext fail closed.
Endpoint/provider edits need new credentials. Broker grants bind active run, worker epoch
and exact row revision; the vault grants no authority. Model declarations share row/revision,
without keys, headers, scripts or per-model destinations.
OAuth refresh queues per connection outside the vault lock; commit only to the same grant.
Reauth keeps IDs; rollback checks revision. Persist the auth host ID in this vault.
Attempt revocation before deletion/key conversion.
Image grants share the vault. Legacy removal needs durable encrypted backup and exact
current-row match; disclose history/backup residue. Acquisition needs an active run except
explicit main-only saved-destination settings checks.
MCP values share this vault, bound to workspace, server, destination and revision;
a changed URL or stdio command/args needs renewed input. Settings IPC derives
the local workspace, returning no values. Acquisition needs the selected Session and
worker epoch, except explicit Settings tool listing of the catalog row's exact binding,
values going only to the CLI helper's stdin. Saving enables nothing. Header framing
and isolated-process env fields cannot be credentials. Reject writes past the
vault read limit.

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
New canvas instances and container-size changes fit the full artwork to the viewport.
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
snapshot; unknown is readonly. Keep ownership independent of view lifetime, and
reject reload of dirty/composing/saving instances. Bento stays element-naive:
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
Historical files resolve by artwork/digest in the worker; local resources serve
original bytes and embedded assets.

Selecting Git history restores directly into the editable current draft. Save-version
and switch flush through the artwork mutation gate; protect unversioned content in
Git before canonical CAS. Persist selected base and operation identity outside
BentoDoc, and report successful disk writes separately from failed canvas reloads.
Execution and artifact processing block both actions. Source display binds to the
authoritative active turn and excludes unchanged inherited draft bytes.

Element references originate only from visible canonical selections while idle.
Capture IDs before flush and pair them with its saved revision; never rebase stored
composer references. Validate artwork, revision and IDs again before dispatch.

Native toolbar requests bind to their isolated protocol session and retained host;
recheck that identity after asynchronous queries and check the selection epoch at
application/capture. Clean selections reuse their saved revision without freezing
controls. Passive composer mirroring waits for autosave when a sibling is dirty,
composing or saving; explicit reference actions still flush siblings together. Geometry
never travels through IPC. Presentation contains only theme, labels and action availability.

Image context actions check image kinds in that saved canonical document, then
insert a target mention and editable prompt into the ordinary composer; only Ask
Molly may send it as an ordinary turn. None mutates artwork or runs image jobs.

Application quit flushes editors before sealing design-worker requests; cancelled
flush leaves the service usable. Even with no open editor, drain accepted requests,
end worker input and await child exit before quitting. A closed worker never restarts.

## Browser account imports

Reject unsupported source or destination Cookie partitions before import mutations;
never flatten identities for writes or rollback. Native reads stay site-scoped and
Cookie values stay in main. Imports cover Pinterest from Chromium browsers. The native
report deadline includes human Keychain approval; retries require a fresh user
action, and read failures preserve destination cookies.

## Agent browser driver

Keep agent-browser private behind the strict action union. Bind refs to observation,
lease and document. Invalidate untrusted WebMCP handles on events; check once at dispatch.
Use the pinned CDP adapter unchanged, with one token-gated loopback connection for
the granted page and descendants. Revoke detaches synchronously before cleanup.
Open the human-input gate only during synchronous CDP Input dispatch. Own each native
daemon and its private config; unknown outcomes never replay. Polling never cancels
WebMCP work. Retain Chromium network/proxy/TUN behavior and image body/redirect/Cookie
bounds; native downloads never publish design assets. Result/cancel bypass DOM readiness.
