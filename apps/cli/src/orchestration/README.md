# Reconciliation feedback

Binding constraints live in [AGENTS.md](AGENTS.md). This page explains why
connection lifetime and change notifications matter to the coordinator.

`operation-store.ts` uses SQLite WAL. Closing the last connection checkpoints
and removes WAL/SHM sidecars. Opening and closing for each reconciliation makes
`operation-coordinator.ts` observe its own filesystem churn. Multiple workspace
coordinators share the machine store and can amplify those notifications.
Per-call MCP opens can also perform maintenance writes and trigger lock contention;
the coordinator owns maintenance, while MCP keeps a read-only schema probe before
any required migration.

`operation-progress-history.ts` projects target execution into a requester card.
With nested A -> B -> C sessions, A observes B, while B contains a card for C.
Mirror notifies subscribers even when a state updater returns unchanged history.
Writing the same card can therefore schedule another reconciliation indefinitely.
The preflight comparison avoids entering Mirror; real writes recompute against
current history so a preflight snapshot cannot overwrite an intervening update.

The real-Mirror regression is in
[operation-progress-feedback.test.ts](../../tests/operation-progress-feedback.test.ts).

## Embedded continuation eligibility

Delivery recovery checks both the frozen execution identity and the requester Session,
then point-reads the exact configuration. Only a same-machine Molly target without launch
overrides and a valid frozen model projection can continue. A retired engine, changed
target, missing frozen identity or unsupported model controls use the existing claimed
non-started finalization path: preserve the result in history, consume its Delivery, and
spend no execution attempt. Transient catalog visibility still remains pending until sync
establishes absence; old storage layout alone does not make an eligible Molly config invalid.

Continuation carries the frozen target ID, model selection, MCP IDs (including an explicit
empty list) and Task-tool gate into the execution service. It does not reread defaults or
choose a replacement model. The execution service and protected host independently check
current runtime/credential availability; this offline gate does not prove provider access.
