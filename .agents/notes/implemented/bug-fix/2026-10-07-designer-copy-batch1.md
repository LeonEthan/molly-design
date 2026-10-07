# Designer copy cleanup, batch 1

Status: implemented
Translation: pending

## Abstract

The 2026-10-07 UI/UX audit of `a93b3838` found coding-tool residue on designer
surfaces: branch-review suggestions in a new conversation tab, a project path
and machine hostname in the conversation menu, "MCP" wording in the composer,
file-path receipts, syntax hints and a context ring in the composer, an
ambiguous canvas focus label, and alarming Advanced copy. Batch 1 removes or
rewords these without changing Spec intent, storage or execution. Layout
changes and items that change intent (per-turn restore points, one artwork
list) are deferred to later batches.

## Decisions and reuse

Every item keeps the existing component and changes only what it shows. No new
component, state or protocol was added.

- **Conversation tabs.** The child-tab empty state offered only "Review /
  Summarize / Simplify the changes on this branch". It is deleted, along with
  its now-unused `isChildTab` and `parentSessionTitle` props. Child tabs use
  the ordinary empty conversation.
- **Conversation menu.** The context group showing repository, branch, project
  path and `Machine: <hostname>` / Local is removed. The Copy submenu still
  offers Copy path. "Rename Chat" and "Find in session" now say "conversation",
  matching Archive conversation.
- **Composer.**
  - The placeholder is always "Describe a design or a change…". The resolver
    that advertised `/`, `@` and `$` is deleted; those features still work when
    typed.
  - The ⌘L focus chip is removed.
  - The usage ring appears only at 70% or more, or while context is being
    compacted (`SESSION_USAGE_TRIGGER_MIN_PERCENT`). Rate-limit details stay
    reachable at that point.
  - Recently-used rows lead with the model, because Molly is the only agent;
    the agent name is the fallback when a row has no model.
  - The per-turn MCP submenu is kept and named "Tool connections".
- **Receipts.** Commit receipts and draft access must be preserved, so the
  links stay. Their labels change from `candidates/<id>.json` / `design.yaml`
  to "Open draft", with plain wording. Moving receipts from the user turn to
  the reply needs cross-row plumbing, so it is deferred.
- **Canvas toolbar.**
  - The ⋯ menu contained only "Save as new design", so it becomes a direct
    icon button.
  - The expand button now reads "Focus canvas" / "Show sidebar". Its behaviour
    still hides only the navigation sidebar.
- **Stopped runs.** "Retry Stop" re-sends the stop for the paused turn, so it
  now says "Stop again". The banner says "Molly stopped. Anything you queued
  will wait until you continue."
- **Settings.**
  - Advanced names "Tool connections" in place of MCP servers.
  - The engine summary no longer lists code mode or tool search.
  - The safety-net copy drops the home-folder example and keeps its "not a
    full sandbox" limit.
  - About folds the commit hash into the build-date tooltip, and its link
    buttons use verbs ("Report an issue", "Read the guide").
- **Dead strings.** Unused locale keys are removed.

## Verification

- `pnpm check` passed (types, lint, tests, translations, boundary guards).
  `pnpm lint:i18n`, `pnpm run docs check` and the OSS desktop build also
  passed.
- After the final label change, re-run checks covered component typecheck,
  i18n lint and 5 focused suites (52 tests). The suites cover the header menu,
  canvas receipt and toolbar labels, receipts, usage threshold and recent runs.
- The rebuilt app was inspected against real local data with the interface font
  overridden to Inter in memory. Confirmed: the home placeholder, the
  "Tool connections" menu, the conversation menu, the new-tab empty state, the
  canvas toolbar labels, the stopped-run banner with "Open draft", and the
  Advanced/About text. No artwork, setting or Agent turn was changed; no paid
  model request was made.
- Not covered: Chinese UI, dark mode, and a fresh paid Agent turn.
