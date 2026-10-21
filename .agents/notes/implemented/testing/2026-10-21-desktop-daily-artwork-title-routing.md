# Desktop Daily artwork-title request routing

Status: implemented
Translation: pending

## Abstract

Issue #49's October 21 Daily failed on both desktop platforms even though native
browser navigation and snapshot succeeded. The synthetic model server treated a
background artwork-title request as a browser journey because the user brief
contained the journey marker. It now recognizes the current naming instruction
before interpreting that marker and reuses its existing synthetic title response.
The browser journey retains its tool-availability assertion; full hosted Daily
recovery remains a separate verification step.

## Evidence and responsibility

[Daily run 39556928402](https://github.com/LeonEthan/molly-design/actions/runs/39556928402)
failed at `BrowserNavigationPage.expectLocalPageWithoutPrompt`'s assertion that
no `browser-tool-missing` event exists. The macOS artifact records one missing-tool
event before the main browser probe, followed by successful navigation and a
snapshot of the synthetic page. This differs from the earlier native null-response
failure tracked in the same Issue.

The current embedded harness's `generateSessionTitle` sends the user brief under
a system instruction beginning `Generate a short artwork title in the language
of the user brief.` without tools. The test server only recognized the older
`You generate titles for` user prompt. A browser marker in the new naming brief
therefore entered the browser branch and produced the missing-tool event.

Only the synthetic external model wire needs adaptation. Production title
generation and native browser behavior remain owned by their existing modules.

## Reuse and alternatives

- Reuse the existing title response and `WorkSessionFixture` model-server process;
  adapt request classification for the current system/developer instruction, as
  the server already does for personal-preference extraction.
- Direct reuse of the old user-prompt matcher cannot recognize the new envelope.
- Removing the missing-tool assertion would hide genuine browser-tool exposure
  failures. Changing the product's title prompt or adding another model server is
  unnecessary for a fixture routing defect.

## Verification

The regression sends a synthetic streaming artwork-title request containing the
browser journey marker to the existing model server. Before the fix it returned
`Synthetic browser tool was unavailable.`; after the fix it returns the synthetic
title and records no missing-tool event.

Command: `pnpm --dir e2e exec node --import tsx --test src/support/fixtures/work-session-fixture.test.ts`.
Both fixture tests pass after the change.

- `pnpm e2e:check`: suite metadata, TypeScript and all 50 helper tests pass.
- `pnpm e2e:build`: desktop and bundled CLI build successfully.
- `pnpm e2e:full`: all 5 scenarios and 32 steps pass locally on macOS, including
  `MOLLY-BROWSER-002`, with its original tool-availability assertion intact.
- `pnpm check`: full repository checks pass with local test endpoints permitted;
  the sandboxed attempt failed because listening on `127.0.0.1` was denied.
- `pnpm format`: completed; unrelated formatter output was excluded from the patch.
- Targeted Oxlint and Prettier checks pass; `pnpm run docs check` passes with
  existing size warnings and no protected topics requiring SHA renewal.

The regression was verified red before the fix and green afterward. The local
full suite uses synthetic model responses and an isolated real Electron/CLI;
Windows and a hosted full Daily have not been rerun. No successful hosted Daily
is claimed and the Issue is not closed by these local results.

This extends the request classification described in the
[deterministic model-wire decision](2026-09-21-e2e-deterministic-model-wire.md).
