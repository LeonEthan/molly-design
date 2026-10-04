# MCP redesign acceptance probes

Status: implemented
Translation: pending

## Abstract

The MCP redesign still needed native desktop discovery, Windows helper cleanup
and cold-start evidence. This verification branch adds a manually dispatched
Windows cleanup probe while local desktop and SDK measurements use isolated
acceptance artifacts. The probe invokes the existing private-helper method with
real processes and tests its cancellation, timeout, output-limit and completion
paths against an MCP server with a surviving descendant. It changes no product
behavior; execution results and any remaining failures must be reported separately.

## Reuse and scope

Reuse the existing Electron harness for local Settings acceptance and the service
test's compilation pattern for the helper probe. The latter substitutes only
Electron/profile composition with an owned temporary directory; the bundled CLI,
stdio transport, child process API, platform identity and operating-system tree
termination remain real. A synthetic loopback readiness channel supplies explicit
descendant-start and closure signals. All PIDs belong to this probe; failed rounds
clean up only their still-connected children.

The existing CI workflow already supports manual dispatch and read-only repository
permissions. This branch adds a Windows-only acceptance job to that event and
uploads synthetic result metadata. It introduces no signing secret, paid model
request, user profile access or automatic inference retry. The branch is for
verification and is not a proposal to merge additional runtime behavior.

## Execution

Build the current bundled CLI, then run
`node e2e/scripts/mcp-helper-cleanup-probe.mjs`. Results are written to the ignored
`e2e/artifacts/helper-cleanup/result.json`. On Windows, the probe observes actual
`taskkill /PID ... /T /F` completion and descendant socket closure. Local POSIX
execution passed all four paths; that result does not establish Windows behavior.

Built OSS Electron Settings passed native discovery against
`https://mcp.deepwiki.com/mcp`: three tools (`ask_wiki_question`,
`read_wiki_contents`, `read_wiki_structure`), adding a tool rule, and disabling
listing after an unsaved connection change. Listing took 2936 ms; the fresh
desktop became ready in 1840 ms. This exercises the built main/preload/renderer
and bundled CLI, not an installed signed package. Only metadata was requested.

Pi 1.0.0 cold-start measurements used separate Node processes and temporary
profiles, the real ACP adapter/native SDK, and a synthetic model response. The
one-server topology took 43.1 ms to construct the session and 4.1 ms for its first
prompt; three servers took 42.5 ms and 4.6 ms. All configured server descriptions
reached inference and neither topology started an MCP process before the reply.
These single samples establish lazy startup, not a statistical performance
comparison or provider/network latency. Import time was 429/444 ms respectively.

These are acceptance measurements, not deterministic CI regression; raw artifacts
remain outside Git. Windows outcome is pending this branch's dispatched run; a
build or a fake Windows platform value does not prove process-tree cleanup.
