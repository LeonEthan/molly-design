# Workspace catalog durability and Role configuration

Local catalog persistence and remote sharing finish at different times. This explains
the [root catalog rules](../../AGENTS.md#repository-boundary); it does not introduce
another catalog or write path.

An MCP server or Agent Role row already exists once its local Flock write is durable.
The explicit upload follows that write, and a joined room can carry the document
when the one-shot upload cannot. Waiting for that upload in Settings confuses a
sharing delay with a failed edit. Reporting it as an edit failure can prompt a
duplicate retry; an upload banner offers no actionable correction to the saved row.
The CLI's explicit sync result answers a different question and remains visible.

A Role is a row in the workspace document even when its visibility is private.
Visibility does not prevent the underlying row from reaching other workspace
members' clients. This is why sensitive configuration is filtered on reads as well
as writes and why private visibility cannot make the catalog a secret store.

Permission mode is an agent-published run-config value, not a secret or a separate
auto-approval policy. A Role can pin it with the rest of its configuration, making a
second composer permission control redundant. When that control disappears, its
warning must remain visible for full-access or skip-permission modes. Presentation
details live in [composer run config](sessions-run-config.md).

An accepted Operation captures the resolved Role configuration rather than rereading
a mutable catalog on retry. Otherwise editing or deleting a Role could change what
an already accepted request executes. Session provenance describes creation; it is
not another configuration authority.

## Explicit Role conversion to Molly

Settings can convert an owned legacy Role to the same machine's built-in Molly.
The Role retains its id; its current row gains a versioned `embeddedMigration`
source snapshot in the same write as the new target. This is a non-executable,
normalized backup of Role fields, not a copy of AgentConfig, environment or
credentials. Historical secret-shaped options are filtered; existing CRDT history
and older backups are not erased by this conversion.

The editor clears CLI model, reasoning and permission settings and requires an
explicit Molly connection/model. The writer rechecks the target's machine/engine
and compares the current source with the editor's backup before its synchronous
single-row commit. Repeating the same result is a no-op; an edited or deleted source
is a conflict. Later edits retain the original backup, which is viewable read-only.
Local durability and best-effort upload keep the catalog contract above.

No Session is opened, native identity adopted or model called. Existing Sessions
and accepted Operations retain their original provenance and frozen config. This
conversion does not retire other legacy execution paths. Earlier binaries can read
the ordinary v1 Role fields, but their editors may discard the additional backup;
editing converted rows with such binaries is not a supported rollback procedure.
