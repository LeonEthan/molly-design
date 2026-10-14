# Browser handback after a taken-over turn completes

Status: implemented
Translation: pending

## Abstract

Resume Agent could leave the built-in browser permanently paused when the taken-over
turn had already finished. The daemon rejected the old run identity, preventing
Electron from clearing its local human-account pause. Resume now accepts the exact
recorded takeover while idle, preserving rejection when another invocation is active.
A deterministic test drives the renderer button through the existing IPC and daemon
paths; packaged native validation remains separate.

## Cause and ownership

Electron retains the human takeover and shared-account pause until explicit handback
or native page destruction. The daemon's previous `browser/resume` check required an
active invocation matching the recorded takeover. A completed invocation has no active
source turn, so the RPC returned `ok: false` and `PublicBrowserIpc` never reached local
cleanup. Closing and reopening a panel did not release the retained account pause.

This violates the existing explicit handback and re-observation intent in the
[browser Spec](../../../../specs/agent-browser-webmcp.zh.md#执行取消与人工接管),
rather than introducing a new browser authorization mode. The Spec remains draft.

## Reuse and security boundary

The existing renderer bridge, local takeover record, `browser/resume` method and
BrowserHost exchange are reused. Adapting the daemon's acceptance condition is enough;
no new protocol, storage, automatic retry or Agent lifecycle is needed. Clearing the
local flag before a successful daemon response was rejected because it would bypass
coordination. Removing run checks was rejected because a different active invocation
must not inherit handback of an unrelated saved scope.

The daemon still requires the requested run to match its recorded takeover. It only
allows handback when the same run is active or no invocation is active. An active
different run and an unknown takeover identity remain refused. A later browse still
requires an authorized active design invocation, matching launch identity and host
capability; handback does not grant a completed run execution authority.

## Verification

The regression uses synthetic session/window/driver dependencies with explicit queue
signals, injected host time and fake timers. It runs the actual SessionBrowserPanel
button handler, renderer IPC proxy, PublicBrowserIpc, MessageHandler, BrowserHost and
PublicBrowserService. Before the fix, three ownership cases passed and the completed
turn case failed because `agentControl` remained `human-takeover`. After the fix all
four cases passed, including a successful browser command from the next turn.

```sh
pnpm --dir apps/cli exec vitest run tests/message-handler-browser-resume-ipc.test.ts tests/message-handler-browser-pause-rpc.test.ts src/browser/browser-host.test.ts
```

The combined targeted run passed 10 tests. These deterministic tests do not establish
native driver, signed-package, website login or WebMCP compatibility. No model or image
call is needed to confirm this local failure.
