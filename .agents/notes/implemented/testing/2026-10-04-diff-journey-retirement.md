# Retire the desktop diff journey

Status: implemented
Translation: pending

## Abstract

The user retired diff verification after the desktop `LODY-REVIEW-001` journey
failed against a design Session that intentionally has no All Changes panel.
Remove that journey and its Scout and acceptance entry points, together with the
dedicated Review Page Object and synthetic large-diff fixture. The remaining
desktop suite covers onboarding, two Session lifecycles and native browser
navigation. This changes verification coverage only.

## Decision and reuse

The [browser verification record](2026-10-04-browser-local-navigation.md#evidence-and-limits)
established the stale expectation. Adapting the journey to another Session type
would preserve a diff requirement that the user explicitly removed. Retire its
registry row and regenerate the coverage matrix instead of quarantining it or
keeping a backlog replacement.

Reuse the existing Electron harness, Session and Work Page Objects, synthetic
model fixture and coverage generator for the remaining journeys. The Review Page
Object and large-diff fixture have no remaining consumers after retiring the
Scout flow, so remove them and the fixture's dedicated test. Keep generic resource
analysis and failure-video reconciliation; its synthetic marker tests now use
the active browser journey identifier. Historical notes and artifacts retain the
original failure record.

## Verification

`pnpm check`, `pnpm format`, `pnpm e2e:check`, `pnpm e2e:build`,
`pnpm run docs check` and the failure-video reconciliation tests passed. Fresh
post-build smoke passed three scenarios / 18 steps; the full suite passed four
scenarios / 23 steps. The earlier smoke run overlapped the rebuild and is retained
separately; it is not the reported post-build result.

The retired Scout `--journey review` and acceptance
`--subject desktop-review-lifecycle` both fail argument validation before any
desktop launch. Native artifacts stay ignored; retirement does not establish
memory or performance behavior for removed diffs. Execution evidence is local
macOS OSS Electron, not packaged release or Windows desktop acceptance.
