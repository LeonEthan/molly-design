# Image MCP request cancellation

Status: implemented
Translation: pending

## Abstract

Native Stop cancelled the Agent's MCP request, but Pi's isolated HTTP client could close before sending the SDK cancellation notification and the built-in image handler discarded the server-side signal, leaving the paid upstream HTTP request open until fixture cleanup. The correction gives the ordinary SDK notification the existing 30-second MCP delivery allowance before per-call cleanup, then threads its signal through generation, edit uploads, returned-image downloads and the existing fetch transport, where it is combined with the 180-second deadline. Cancellation is checked before the atomic asset rename so a late upstream result cannot publish a new workspace asset. A corrected installed Pi round now closes the held synthetic image response before fixture cleanup and completes owned teardown; paid-provider cancellation and other Agents remain outside that result.

## Problem and evidence

This corrects a boundary left implicit by the earlier [image MCP client deadline](2026-09-12-image-mcp-client-deadline.md). Extending the MCP client deadline supplied Pi's native signal to `Client.callTool`, but the HTTP branch also registered an earlier listener that closed the per-call client. SDK 1.29 sends `notifications/cancelled` asynchronously before rejecting the call; closing the Streamable HTTP transport first aborts that send. Even if delivery succeeded, the server callback in `lody-mcp-server.ts` accepted only tool arguments and dropped the SDK handler's `extra.signal`. The generation service and shared image HTTP request therefore had no cancellation input, while `fetchImageHttpTransport` created only its own deadline controller.

The normal installed source `5d03ea7e58acb1095fe6d1c3e8fbe006bbc6da58` Pi cancel-only probe `/tmp/folio-t28-pi-installed-cancel-1.mjs` (SHA-256 `b826c81cd202b385c82e1914f3a5dd9784365b7b5fd5cb16cecbca0ba714ddee`) reproduced the defect. The image HTTP request arrived at `05:50:11.403Z` on 2026-09-12 and native Stop occurred at `05:50:12.379Z`. ACP reported cancellation, but the HTTP connection stayed open and closed only during fixture cleanup at `05:51:12.529Z`. Cleanup succeeded and all 14 owned process IDs were absent afterward. The retained evidence is under `/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-t28-kimi-input-43BZNC/evidence`; the MCP HTTP host startup line alone is not treated as proof of which call transport remained open.

## Decision

Pi's isolated call transport records the SDK's standard cancellation-send promise. Routine per-call cleanup lets that promise settle for up to the existing 30-second MCP delivery allowance before closing the client; a failed send settles cleanup immediately, while a stalled send yields to `Client.close()` at that boundary so Stop cannot wait forever. A separate temporary listener still closes a client cancelled while it is connecting, before any MCP request exists. This preserves session shutdown cleanup without inventing another cancellation protocol.

`ImageHttpRequest` carries an optional `AbortSignal`, alongside its existing timeout. The production fetch transport combines caller cancellation with its private deadline signal, reports its own timer as a timeout, and otherwise preserves caller cancellation. Generation and edit pass the same signal into the paid POST and any returned-URL GET. Edit input reads and the asset publication path check the signal at their existing asynchronous boundaries; the temporary file is removed if cancellation arrives before rename.

The server uses the normal MCP SDK handler context and does not add a cancellation registry, scheduler, forced process termination or runtime patch. Paid requests still have no automatic retry, the model remains user-required, and credentials retain the existing redaction path.

## Verification and limits

Deterministic tests use the real MCP SDK `Client`, `McpServer` and linked `InMemoryTransport` for both generate and edit. One test delays the SDK cancellation notification itself and proves Pi's tracked transport waits for delivery before cleanup; the server then observes its request signal abort. A fake-timer test holds delivery forever and proves cleanup is released at 30 seconds. An injected held image transport separately observes that server-side signal after client cancellation, and no `media` asset is published. A returned-URL test lets an intentionally cancellation-ignoring transport finish late and verifies that the post-request guard rejects without writing. Fetch tests separately prove caller cancellation and the deadline with explicit signals and fake timers; they use no network or wall-clock sleeps.

The focused cancellation suite passes 67 tests across four files. CLI typechecking and the repository-wide `pnpm check` pass, including platform and public-boundary guards. Formatting and documentation checks are recorded at the correction commit.

The corrected normal macOS arm64 package source is
`47c0808d354ce2227e4fed288a748f4fec9e2435`, which contains this correction as
ancestor `16a5940`. The retained `package-identity.json`, installed boot record
and direct hashes agree on that source: DMG SHA256
`f50900870ca1442feee70f6f391e633e6ef330420935ec8a1875a09e11300a62`
and installed ASAR SHA256
`6925f94faae19bfc002973a50cf5c527b05a42363a990e7a7d2ebe6a5781ce0a`;
strict deep signature verification passes.

The installed Pi cancel-only round retained at
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/folio-t28-kimi-input-EeOUGj/evidence`
uses a unique isolated synthetic image request and actual desktop Stop. The image
request arrived at `07:46:42.504Z`; the probe recorded the UI Stop action at
`.652Z`, the daemon received `session/cancel` at `.717Z`, and the held provider
response closed at `.750Z`. The original timeline classifies this as
`nativeCancelled=true`, `fixtureCleanup=false` and `writableEnded=false`: 98 ms
after the Stop marker and before fixture cleanup, rather than a provider release
or late cleanup close. Provider drain and application cleanup then completed;
endpoint release, isolated directory removal and harness teardown finished by
`07:46:43.386Z`. The isolated data root is absent and the 15 recorded owned
processes are absent.

This installed result closes the earlier Pi synthetic image-request cancellation
regression while preserving the 5d03ea7 failure above as its before-correction
record. It does not complete generation or editing, publish/read an asset, use a
paid image provider, establish remote billing behavior, or validate cancellation
for Codex, Claude, Kimi or Grok. No actual user setting or credential was read or
reused, no automatic retry ran, and the installed probe does not broaden the
source tests' per-call cancellation guarantees.
