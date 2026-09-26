# Remote daemon lifecycle acknowledgements

Status: approved
Approval: [2026-09-21 owner approval](../.github/spec-approvals.md#2026-09-21-existing-specs)
Translation: pending

## Accepted work and response delivery

An authorized restart that the CLI has accepted must proceed even when its
acknowledgement cannot be delivered. Rejected operations never trigger a
lifecycle exit. Remote upgrade no longer exists in this contract: the former
npm self-install path was removed because the package it installed is not
Molly-owned, and this local product ships updates through the desktop release
channel.

The RPC server first attempts to deliver the accepted response, with a total
five-second budget. Success, exhausted delivery retries, or deadline expiry then
invoke the existing CLI lifecycle callback. An ACK delivery error is diagnostic;
it must not produce a contradictory operation-failed response. Late completion of
that attempt must not invoke the callback again.

The existing process boundary retains its one-time exit guard. This contract does
not add process-wide preparation serialization or cross-restart request deduplication.
The deadline bounds waiting, not cancellation of the underlying HTTP request.
A client timeout means the outcome is unconfirmed; it does not cancel accepted work
or prove that the daemon failed to restart. Completion reporting is separate.

## Implementation evidence

- [RPC acknowledgement handling](../packages/loro-streams-rpc/src/machine-rpc-server.ts)
- [CLI callback wiring](../apps/cli/src/lib/message-handler.ts)
- [Process exit boundary](../apps/cli/src/commands/start.ts)
- [Synthetic transport tests](../packages/loro-streams-rpc/tests/machine-rpc-server.test.ts)
