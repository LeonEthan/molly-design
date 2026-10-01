# Native history belongs to durable Session startup

Status: implemented
Translation: pending

## Abstract

Typing before the first send could start an embedded Molly worker and create an empty native history. When the durable Session supplied design metadata, adoption discarded that worker and started another, leaving two histories for one conversation. Molly preparation now prepares only the workspace; a compatible claim transfers ownership and reuses ordinary durable startup with the final design context. This removes speculative native history and its extra worker startup, while giving up speculative ACP negotiation. Existing histories and exact native restoration remain unchanged.

## Cause and evidence

`SessionManager.createPreparedSessionRuntime` previously started ACP without design hooks.
`finishPreparedSession` correctly discarded a running preparation when durable design
metadata appeared: worker construction freezes the cwd, edit reminder, permission profile,
personal-memory capability and continuation context before spawn. Updating the Session
object cannot update that worker.

The isolated desktop probe selected the synthetic model, typed a synthetic prompt, waited
for preparation publication, and sent it. The model completed once, but the private native
history directory contained two JSONL files. Preparation logs showed a compatible claim
and no model/MCP replacement, locating the second startup in the design adoption fallback.
The focused manager regression also failed before the fix because preparation already
allocated a native history before adoption.

## Responsibility and reuse

The existing preparation service remains the synchronous lease owner. Embedded resources
carry a null ACP result, so cancellation, expiration and replacement can dispose without
waiting for an unstarted worker. Their ACP readiness promises stay pending until disposal;
workspace publication suffices for a claim. Other preparation behavior is retained.

After compatibility and current-launch checks, the manager adopts any speculative worktree,
checks its durable target and directory, and disposes the unused preparation sandbox.
It then calls `createSessionInnerWithAgent`, preserving ordinary workspace setup, design
metadata resolution, credentials, callback ownership and persistence of the native ID.
Resume and fork startup still discard preparation and use their exact native hints.

Reuse ladder: direct reuse of the already-running preparation was rejected because its
frozen design configuration was wrong. Reusing the existing workspace lease with adaptation
and the authoritative cold startup was sufficient. Starting the prepared worker only after
adoption could work, but would add another startup owner and duplicate the final design
initialization sequence. No new storage, protocol, transcript replay or history cleanup was
needed. The read-only Codex CLI recommendation favored workspace-only preparation for the
same ownership reason.

## Verification and limits

The permanent regression exercises preparation publication, compatible durable creation,
design and non-design startup, cancellation, and changed-model cold fallback with an
injected synthetic ACP allocator. It asserts the native identities and design configuration,
not mock call counts. Real desktop verification uses the bundled worker and only simulates
the external model wire.

The focused manager/preparation/design-reminder suite passed all 46 tests. The desktop
probe changed from two JSONL files to one after a completed reply, and the three existing
smoke scenarios passed. The read-only `gpt-6-astra` high-reasoning diff review reported no
P0/P1 findings; it reviewed the supplied runtime evidence rather than reproducing it.
`pnpm check`, `pnpm format` and `pnpm run docs check --base
1ac4363a815839a98784f0af4902e4ebd252053e` passed.

Previously created empty histories are preserved. This fix prevents speculation from creating
them; it does not guarantee one native context across explicit provider changes or recovery
that intentionally creates another context. No startup latency improvement has been measured.
