# Local data-plane status bootstrap

Status: implemented
Translation: pending
PR: [#106](https://github.com/LeonEthan/molly-design/pull/106)

## Abstract

Desktop startup could leave the composer disabled even though the local CLI was
ready. A delayed connection snapshot could overwrite a newer live status event,
invalidate the pending document join, and leave the renderer waiting for a
connection edge the already-connected relay would not emit again. The renderer
now gives live status precedence and ignores replies after disposal. A
deterministic regression reproduces the stalled join without a process restart,
network request, or longer timeout.

## Evidence and ownership

[The failed smoke job](https://github.com/LeonEthan/molly-design/actions/runs/37897784257/job/113713036510)
timed out in `LODY-SESSION-001` while the model picker remained disabled. Its
retained screenshot showed “Reconnecting” and a daemon-starting message. The CLI
reported ready, while the renderer's meta room moved from `connecting` to
`reconnecting` within one millisecond and never joined before teardown. The next
isolated scenario completed its initial sync in 59 milliseconds.

`createLocalLoroDataPlaneConnection` registered both a live `loro.status` feed
and an asynchronous `loro.isConnected` snapshot. Applying the snapshot
unconditionally let an earlier `false` erase a later `true`. The real
`LocalLoroTransportAdapter` responds to that false edge by invalidating the
pending join, so its eventual successful reply is ignored. The regression
reproduces this exact behavior; the CI logs did not record IPC payload ordering,
so they establish the matching symptom rather than independently prove that
ordering.

The renderer bridge owns status ordering. Electron continues owning connection
and redial, and the transport continues owning room joins and synchronization.
No daemon, wire, retry, storage, or E2E timeout change is needed.

## Reuse and alternatives

The existing IPC bridge and `LocalLoroTransportAdapter` remain the only path.
The bridge now attaches its listener before subscribing, applies the bootstrap
snapshot only until the first live status, and fences disposed connections.
Removing the snapshot would leave later workspace runtimes without initial
status when their renderer is already attached to the relay. Extending the E2E
timeout would not repair a false renderer status while the relay stays connected.

## Verification and limits

- The new deterministic suite failed four of five assertions before the fix,
  including the pending room remaining `reconnecting` after its join reply.
- Five regressions now pass: delayed false/true snapshots, an already-attached
  relay, subscription-time status, and disposal before a snapshot reply.
- The focused bridge, IPC, machine-monitor, and reconnect-loop suites pass
  together: 16 tests across four files.
- Components typechecking and a fresh `pnpm e2e:build` pass. The full isolated
  desktop suite passes all four scenarios and 23 steps, including every P0 smoke
  scenario and P1 browser navigation. `LODY-SESSION-001` completes its initial
  document sync in 19 milliseconds in that run.
- The updated GitHub Actions result still needs verification after publication.
