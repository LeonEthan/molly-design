# Personal memory

Status: draft
Translation: pending

When a user states a durable personal preference in a design conversation, Molly can remember it automatically and use it in later design sessions. The initial scope is personal preferences shared on the local installation. Project facts, brand rules, artwork state and credentials are excluded. BentoDoc remains the artwork's editable truth.

The selected model extracts preferences during the owning active run after its native response completes. This additional inference uses the same credential, transport, cancellation and usage accounting as that run. It may incur provider charges. Local persistence does not make extraction offline. Failure to recall or save memory is reported separately and preserves the completed native response. Cancellation during extraction retains that response's receipt and prevents a later memory save. Explicit Stop still pauses dispatch and cancels artwork finalization; the native receipt alone does not make the stopped design task successful. No automatic inference retry occurs.

One daemon owns the local mem0 store. Settings > General exposes automatic memory, its current records, editing, deletion and refresh. Disabling stops subsequent recall and capture, retaining editable records. Editing, deleting or changing the enabled state invalidates pending extraction based on older state. Cancellation before the commit prevents that commit; already committed writes are not rolled back.

V1 retains at most 32 preferences, each at most 300 characters, and recalls that bounded set through mem0's list API. It does not perform semantic vector search or download an embedding model. Full capacity rejects new additions without silently evicting an existing entry. Extracted changes are a bounded atomic batch; stale changes are rejected without retry. A later explicit statement can create a new memory after a deletion.

Recall enters transient system context as untrusted information, subordinate to current user instructions, and grants no tool authority. Deleted information is omitted from future memory recall. It can remain in existing conversations and prior model requests; deletion is not a forensic erasure claim. Changes made during a model request cannot retract context already sent to that model.

## Evidence and limits

The owner selected mem0, automatic shared personal preferences and Molly-owned extraction/safe saves in this working session on 2026-09-28. This draft has no linked approval of a Spec revision. [Research and decisions](../.agents/notes/proposed/architecture/2026-09-28-memory-component-selection.md) records upstream defects and the reuse boundary.

Public service tests use the real mem0 SQLite backend with synthetic preferences. ACP tests cover transient recall, extraction, cancellation and separate failure reporting. Extraction records measured provider/model usage through Pi's public `SessionManager.appendUsage` before abort, stop-reason or JSON validation; the existing Core projection includes those records after restore and retains a failed notification for a later cumulative flush without duplicate inference or deltas. No extraction text is appended to model history. These establish lifecycle behavior, not model extraction quality or preference adherence in real designs. No live provider evaluation is claimed.
