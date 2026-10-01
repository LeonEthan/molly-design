# Molly embedded Pi

This package is Molly's Agent engine: the public Pi SDK (`@earendil-works/pi-coding-agent`
0.99.2) plus unmodified published Pi packages, behind an ACP adapter. The CLI host owns
dispatch, credentials, design transactions and session history policy; Pi owns the model
loop, tools, resource discovery and native conversation history.
Intent: [embedded harness Spec](../../specs/molly-embedded-pi-harness.md).

## Pi profile

Each worker runs with `PI_CODING_AGENT_DIR=<molly-data>/harness/pi/config`, Molly's own Pi
agent directory. It never reads or writes the user's `~/.pi/agent`. On startup the worker
writes the profile's `settings.json` from [profile-settings.ts](src/profile-settings.ts):

| Package                              | Purpose                                        |
| ------------------------------------ | ---------------------------------------------- |
| `pi-subagents`                       | Delegation to foreground and background agents |
| `pi-skillful`                        | Skill discovery and inline expansion           |
| `@juicesharp/rpiv-ask-user-question` | Questions through the GUI form dialog          |
| `@zigai/pi-mention-skill`            | Typed `$skill` mentions                        |
| `@ff-labs/pi-fff`                    | Fast file search tools                         |
| `cc-safety-net`                      | Deterministic destructive-command floor        |

Packages are referenced by their absolute paths in the sealed closure and loaded by Pi's
native package discovery; none is patched or forked. `cc-safety-net` is also listed in
`subagents.defaultExtensions`, because sub-agent children load only that list. The
`pi-subagents` built-ins that drive another installed CLI (Codex, Claude Code, Cursor) are
disabled through `subagents.agentOverrides`: they would run on another account and skip that
list.
`defaultProjectTrust` is `always`: Molly owns its session workdirs, and design skills it
materializes in `.agents/skills` load natively. Tools run without permission checks.

In RPC mode Pi binds select/confirm/input/editor/notify to the existing ACP form dialog
([session.ts](src/session.ts), [extension-ui.ts](src/extension-ui.ts)). Terminal components,
widgets, footers, autocomplete and the sub-agent fleet view are unavailable.

## Credentials and models

The host grants the selected connection's key over the private fd-3 pipe for each run.
The worker pins it in memory with `setRuntimeApiKey` and, the first time it sees that key,
stores it through Pi's native `login` in the profile's `auth.json` and writes the
connection's provider entry into `models.json`
([profile-credentials.ts](src/profile-credentials.ts)). Sub-agents, including detached
background runners that outlive the turn, read those files. Connections that share a Pi
provider ID share one entry; the last started worker wins. Deleting a connection does not
yet remove its profile copy.

[model-connection.ts](src/model-connection.ts) registers the selected connection in memory,
including declared OpenAI-compatible models. Model and thinking selection are fixed per
worker; hooks in [host.ts](src/host.ts) retire the worker if an extension changes them.

## ACP adapter

[agent.ts](src/agent.ts) and [session.ts](src/session.ts) adapt the lifecycle of
[`victor-software-house/pi-acp` 0.17.1](https://github.com/victor-software-house/pi-acp/tree/9c027cf6c5fc76ea85433139e750e18f87e706ba)
to the current SDK; [translate/](src/translate) is copied from that revision
([MIT license](src/LICENSE.pi-acp), shipped in the bundle). Success requires native
settlement and a final assistant entry; cancellation, truncation and handled commands are
reported distinctly. Native usage is projected to Core usage notifications
([usage.ts](src/usage.ts)); sub-agent usage is not included.

ACP MCP servers, including Molly's design and image servers, are registered through Pi's
native `createMcpExtension`, `createCodemodeExtension` and `createToolSearchExtension`
([mcp.ts](src/mcp.ts)). Protected MCP credentials arrive once per worker on fd 3.
Known upstream defect: [Pi #10249](https://github.com/earendil-works/pi/issues/10249) — a
server still starting during shutdown can outlive it. Molly does not patch around it.

The managed host ([host.ts](src/host.ts)) validates each run snapshot against the worker,
fences the run with an exclusive record in `<private>/runs` before reading credentials
([run-journal.ts](src/run-journal.ts)), adds Molly's system prompt, host time, the
read-before-edit reminder and recalled personal preferences through `before_agent_start`,
and extracts new preferences after completion ([personal memory](../../specs/personal-memory.md)).

Native histories keep the previous layout,
`<private>/sessions/<sha256(connection)>/<sha256(product session)>/`, so sessions created by
earlier releases restore unchanged ([native-session.ts](src/native-session.ts),
[profile.ts](src/profile.ts)). An `.acp-lock` beside a history records its owner process and refuses a second writer; a
lock whose owner has exited (the host stops workers with SIGKILL) is taken over.

## Build and verification

`apps/cli/scripts/build-embedded-harness.mjs` bundles [entry.ts](src/entry.ts) and stages
Pi and every package dependency into the sealed `harness/` closure with a checksummed
manifest. `molly-pi-agent.js --probe` reports the engine and package count without a key.
`apps/cli/scripts/smoke-embedded-harness.mjs <cli-output> [node]` starts the bundled worker
in a temporary root, checks package commands and tools, runs one turn against a loopback
synthetic model and checks the profile credential.

Package tests use the real SDK with synthetic providers in owned temporary profiles:
[adapter\*.test.ts](tests) cover lifecycle, MCP, trust, usage and the managed host;
[profile-packages.test.ts](tests/profile-packages.test.ts) loads every package natively,
checks the safety floor blocks without prompting and answers a question through the GUI.
One desktop design run (DeepSeek, text and shapes) completed without permission prompts;
background sub-agents, image generation and other providers have not been verified.
