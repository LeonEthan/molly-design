# Drain isolated title agents during shutdown

Status: implemented
Translation: pending

## Abstract

The installed Codex acceptance run retained an Agent runtime PID after Electron quit.
Its exact title/main role was not captured. Independently, source inspection found
that MessageHandler tracked session-title promises but neither cancelled nor awaited
them during cleanup. The isolated title agent is owned outside SessionManager, so
terminating main sessions did not cover it. A branch-name fallback could also start
an untracked isolated title run. This repair follows [T21](https://github.com/LeonEthan/Folio/issues/23)
shutdown ownership; it does not attribute that PID or the separate Pi mkdir race.

## Change

One handler-owned cancellation signal stops new title work and cancels its existing
isolated runs. Startup uses the existing ACP start gate's signal; pending config,
prompt and output waits unwind into the existing child shutdown finally block.
Cleanup drains the owned runs and session-title promises before closing documents.
An optional signal in the existing conditional title setter checks cancellation
after metadata reads and before starting publication.
Successful title generation and its original output timeout remain unchanged.

Both isolated callers are tracked, including branch-name generation without a reusable
session-title promise. Cancellation blocks metadata publication and branch fallback;
the branch-rename caller checks shutdown before resolving the workdir. No new scheduler,
retry, grace period, harness exception or runtime-specific behavior was introduced.

## Evidence and limits

The focused suite passes 50 tests, including deferred startup, config, prompt,
output and child-exit fixtures that verify cancellation
and the shutdown barrier. Handler tests verify drain, no late title publication, no
new title after cleanup, and cancellation of both branch-name reuse and standalone
fallback. Existing title sanitization and successful native-prelude handling remain
covered. Verification results are recorded in the handoff. No native/UI run was made
on the worker source before integration; the installed follow-up is recorded below.
The existing bounded ACP SIGTERM/SIGKILL shutdown policy is unchanged; deferred
fixtures prove awaiting that routine, not elimination of native process survivors.

Integration source `609b2fe2` was rebuilt and privately installed with its source
identity verified inside the ASAR. The unchanged Codex input/Stop/explicit-continue
probe then exited zero, including owned process, endpoint and directory cleanup.
The unchanged cold-cache Pi/resubmission probe still failed directory cleanup with
`ENOTEMPTY` after its functional assertions passed. This establishes the Codex
round's clean exit, not the historical survivor's identity or a repair of the Pi
failure. Exact package identities, scripts and retained evidence are in the
[installed matrix](../../implemented/testing/2026-09-11-installed-five-agent-matrix.md).

The referenced legacy `context/message-flow.md` is absent from this checkout. Current
agent README and lib/ACP shutdown rules were used; no replacement historical content
was fabricated.
