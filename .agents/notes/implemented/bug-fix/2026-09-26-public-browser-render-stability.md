# Keep the native Browser stable while editing its address

Status: implemented
Translation: current

[中文](2026-09-26-public-browser-render-stability.zh.md)

## Abstract

Opening an existing public page caused the native Browser to flicker and erased
address edits, blocking website login persistence verification. The surface now
retains its IPC bridge across renders, and the controller updates the address only
when the observed page URL changes. Deterministic tests reproduced both failures
before the fix and pass afterward. This repairs renderer lifecycle and input state
without changing browser permissions, cookie storage or navigation ownership.

## Cause and decision

`getPublicBrowserBridge()` creates a wrapper on every invocation. The surface used
that wrapper as an effect dependency, so state updates cleaned up the layout effect,
hid the native view, then attached it again. Create/bounds responses updated React
state and perpetuated the loop. The controller also copied every browser state URL
into its editable input, even when only the title or loading state changed.

Retain the bridge in mounted component state and remember the last public URL at
the controller boundary. Explicit navigation still sets the input; real redirects
and history navigation update it normally. Hidden panels and blocking dialogs keep
their existing visibility behavior. A global IPC singleton or main-process visibility
throttle would add scope or mask the erroneous renderer lifecycle, so neither is needed.

## Evidence and limits

The real pre-fix signed app immediately replaced a typed draft with its previous URL.
A surface test uses the real IPC wrapper and controlled bounds responses to detect
unrequested hide transitions without timers or a network. A controller test verifies
that same-page updates retain a draft and changed URLs still replace it. Both tests
failed before the fix; all eleven focused browser tests pass afterward.

Focused red/green output:

```text
FAIL keeps the native page visible across state-driven renders and hides it on detach
expected [ true, false, true, false ] to not include false
FAIL preserves an address draft during same-page state updates and follows navigation
Expected: "https://example.com/new-draft"
Received: "https://example.com/docs"

Test Files  2 passed (2)
Tests  11 passed (11)
```

`pnpm format`, `pnpm check` and `pnpm run docs check` pass. The full check includes
typechecking, the component and Electron suites, and the public boundary guard.
Following **repro-before-fix**, both regressions were run red before runtime edits;
local Git closeout was subsequently authorized in the linked workflow record.
Following **prove-on-the-real-surface**,
the updated Apple Development signed package was opened after normally quitting
the old app. `pnpm build`, packaging smoke checks and `codesign --verify --deep
--strict` passed. Real UI checks confirmed keyboard draft editing and continued
editing, Escape restoration, successful Pinterest navigation, and canvas/browser tab
switching with the page retained. The page visibly showed the signed-in account and
search results after restart without re-importing or signing in. No repeated blanking
was observed during these interactions. A process snapshot showed the main process
at 1.4% CPU and the app renderer at 0%, versus the reported sustained >100% before
the fix; this is a snapshot, not a performance benchmark. The four reported old PIDs
were absent after normal quit, so no forced termination was required. The signed test
app is left open; notarized distribution and a new paid Agent run were not tested. No cookie
values, private screenshots or captured conversations are included. Related acceptance
context: [layered-design workflow](../../implemented/feature/2026-09-24-generative-layered-design-workflow.md).
