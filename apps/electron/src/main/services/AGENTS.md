# Electron service contracts

`CLAUDE.md` links here; edit `AGENTS.md` only.

## Design canvas

Views accept validated CLI design-worker documents without Node, preload,
permissions or external network.
Bind saves to Session/host; CLI owns bytes, Electron renders and shows dialogs.
Retain hidden editors; explicit close saves before disposal.
Source previews never register for save/flush; preserve
canonical instances and reject late results after consumer/source changes.
Source previews share exact dependency watches and serialized conversion only
while consumers exist; release both with the last consumer. Re-observe new
dependencies after installing watches. Watch `design.yaml` and needed `media/`; leftover `.pptd` is not a watch or import source. Reject
old source/turn/view generations; previews never commit or update Agent baselines.
Valid frozen frames may publish while newer bytes are queued; render serially.
The single canvas retains its camera across source replacements and store reloads.
For visible windows, keep outgoing pixels until the replacement has decoded resources,
restored its camera and completed a compositor capture. Promote before disposal; turn completion does
not close the visible preview before the canonical editor is ready.
Preparation may precede input identity: establish the entry watch and bind that
identity on observation. Reconcile this startup handoff even without another file
event; stop the reconciliation when bound or released. Cancellation retires loading native surfaces as well as
the visible preview; late loads cannot reveal a closed canvas. Canonical editors
may finish loading while hidden, but initial display and viewport restoration
must recheck the current host's visibility intent.

`design-canvas-access` gates actual human writes and flushes all artwork instances
before dispatch. Execution state comes from the versioned daemon canvas-host
snapshot; unknown is readonly. Keep ownership independent of view lifetime, and
reject reload of dirty/composing/saving instances. Bento stays element-naive:
it receives generic readonly/flush plus zod-validated selection property and
element-creation commands (`window.molly.applyCommands`, one kernel batch per
command) and reports
zod-validated selection summaries; every element semantic lives in
`@molly/shared/design-selection-commands`, never in Electron. A canonical attach
completes only after Bento publishes its generic
state/snapshot/flush/readonly/commands API and reports the real ready state; a navigation or
DOM load event alone is not canvas readiness. Before changing these boundaries, read
[design resources](../../../../../packages/design-bento/README.md).
The preview host uses the same local socket, independently of canvas preparation.
Keep render policy in Node-testable `design-render-host-core.ts`: no retries, repair,
per-turn thumbnails or thumbnail IPC. Previews/PNG/JPEG use canvas dimensions.
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
insert only a target mention and editable prompt into the ordinary composer.
They never mutate the artwork or dispatch a separate image job.

Application quit flushes editors before sealing design-worker requests; cancelled
flush leaves the service usable. Even with no open editor, drain accepted requests,
end worker input and await child exit before quitting. A closed worker never restarts.
