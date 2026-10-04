# Settings MCP discovery credential and platform fixes

Status: implemented
Translation: pending

## Abstract

The tool-listing feature in [PR #76](https://github.com/LeonEthan/molly-design/pull/76)
could expose decoded Basic-auth credentials, use saved credentials after their removal
was staged, and inherit the wrong platform identity. The fixes extend the existing
metadata sanitizer, compare the draft credential reference with the saved reference,
and give the helper the supervised CLI's local environment overrides. Deterministic
tests reproduce each failure against the reviewed commit and pass with the fixes.
Real third-party server and packaged desktop acceptance remain unverified.

## Cause and fix

The sanitizer previously knew the complete Authorization header and its Base64 payload,
but not the decoded Basic-auth value or its username/password components. The helper
now adds all nonempty decoded components before projecting tool metadata: matching names
are omitted and titles/descriptions are redacted. Splitting at the first colon preserves
colons inside passwords. A second length filter in discovery also had to be removed;
otherwise it discarded short decoded credentials even after they were identified.

The existing four-character floor still applies to other saved values, including
ordinary environment values such as `DEBUG=1`. Explicit Basic authentication identifies
its decoded components as credentials, so they bypass that heuristic. Short Basic
credentials can hide more tools or redact more text; preventing their disclosure takes
priority. Arbitrary secret transformations are outside this substring sanitizer's scope.

The form's endpoint comparison did not include protected credential metadata. Removing
the reference could therefore leave the listing action enabled while its callback
still used the saved entry. The dirty comparison now includes that metadata.

The private helper supplied no runtime environment overrides, allowing shell or process
values to choose the cloud profile or cause an invalid-platform startup failure. It now
reuses `buildCliRuntimeEnvOverrides()` for the local platform and resolved data directory.

## Reuse and scope

The existing SDK discovery transport, metadata projection, form dirty check, and CLI
environment builder provide the required seams. Direct reuse suffices for helper
launch; the sanitizer and dirty check need small adaptations to recognize the missing
credential state. No new discovery client, credential store or runtime protocol is needed.
The Electron regression follows the existing service-test pattern: compile the real
service and replace native process/Electron dependencies with deterministic fixtures.
These changes repair existing guarantees and do not revise Spec intent.

## Verification

- Against PR commit `c438527`: six Basic-auth metadata cases fail, staged removal
  incorrectly leaves listing enabled, and all four inherited-platform cases fail.
- With the fix: 13 CLI discovery tests, 13 form tests and four helper environment tests
  pass. Basic-auth cases cover short and empty components and a colon in the password;
  helper cases cover both cloud and invalid values from the process and user shell.
- `pnpm check`, `pnpm format` and `pnpm run docs check` pass. The full run includes
  3,102 CLI tests, 3,311 component tests and 272 Electron tests. Existing lint and
  documentation-size warnings remain; the checks report no errors.
- The read-only Codex CLI second opinion (`gpt-6-astra`, high reasoning) found no
  actionable P0/P1 issues and independently passed the 30 focused tests. Its attempted
  additional nested review was blocked by sandbox permissions; that nested review
  contributes no evidence.
- No real third-party MCP endpoint, packaged desktop UI or Windows process-tree
  cleanup acceptance was performed for this fix.
