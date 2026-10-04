# Align the desktop browser journey with native local navigation

Status: implemented
Translation: pending

## Abstract

The desktop browser journey still required public-address filtering after that
restriction had been removed, so the full suite failed on an obsolete guarantee.
The corrected journey opens and reads a synthetic local page through the real Pi,
MCP, daemon and Electron browser path. It reuses the isolated model fixture's
random loopback port and checks returned page data rather than a simulated
success flag. This verifies native local navigation without contacting a user's
service or an external website; it does not establish real-model browsing quality.

## Cause and scope

`LODY-BROWSER-002` asserted the retired `Agent browser requires a public website.`
error and targeted the unowned fixed port 8333. The baseline failed because the
expected private-host refusal was absent; the unreachable target instead returned
a browser-operation error. The [native transport decision](../simplification/2026-10-03-native-browser-transport.md)
and current [Spec](../../../../specs/graphic-design-platform.zh.md#内置网页调研与素材)
already permit Agent loopback navigation. No product code or Spec intent changes
are needed. Embedded Pi tools execute without permission checks, so this journey
does not invent an interactive browser approval path.

## Reuse and verification design

Adapt the existing scripted model server with one static HTML route, borrowing
the synthetic loopback-page pattern from the native browser navigation probe.
The server already owns its random port, event log and lifecycle. A separate
server process or production test seam would duplicate those mechanisms. The
existing Page Object and stable journey ID remain, with navigation names replacing
obsolete permission names. Registry metadata owns the changed coverage, and the
coverage matrix is regenerated from it.

The scripted model calls `molly_browser.navigate` and `snapshot` through the
existing `codemode` interface and reports the actual MCP replies. Assertions
require the exact owned URL and title, the native accessibility heading, an
untruncated snapshot, a served-page event, the terminal Session response and no
approval card. Errors remain visible in the returned replies. The synthetic HTML
has no scripts, external resources or account data.

## Evidence and limits

The original focused journey failed at its obsolete private-host assertion in
the built OSS desktop. The corrected focused journey passed, including actual
native URL/title/snapshot replies. Changing only the expected snapshot heading to
an absent value made the journey fail on the actual returned accessibility text;
the exact original Page Object bytes were restored before the final suite.

`pnpm install`, `pnpm format`, `pnpm check`, `pnpm e2e:check`, `pnpm e2e:build`,
`pnpm e2e:smoke` (three journeys) and `pnpm run docs check` passed. E2E sources were also formatted with the workspace
Prettier because that package has no recursive format command.

The full desktop suite passed four of five journeys, including this browser
journey and all three P0 journeys. `LODY-REVIEW-001` timed out waiting for the
All Changes menu item: its fixture creates a design session, whose menu
intentionally excludes code diffs after preexisting commit `4cecb532`. The
owning [sessions README](../../../../packages/components/src/components/sessions/README.md)
documents that behavior. Its feature, Page Object and causal product code are
unchanged by this patch; its model events contain ordinary successful replies
and no browser probe. That separate stale journey is not repaired here.

The advisory read-only Codex CLI review used `gpt-6-astra` at high reasoning and
found no P0/P1 issues. Its syntax, metadata, TypeScript and docs checks passed;
desktop execution was not available in its read-only environment. Its own nested
second-opinion initialization failed with `Operation not permitted`, so that
nested call supplies no additional review evidence and was not retried.

Only the external model wire and target page are synthetic; Electron, its IPC,
the bundled CLI, Pi, MCP and the native browser run normally. Local macOS evidence
does not prove Windows/Linux desktop execution, account import or live website
compatibility.
