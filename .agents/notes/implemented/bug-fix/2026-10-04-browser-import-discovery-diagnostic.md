# Browser import rejected an unrelated service directory

Status: implemented
Translation: pending

PR: [#80](https://github.com/LeonEthan/molly-design/pull/80)

## Abstract

Chrome account import reported that cookies could not be fully decrypted even when the selected profile's Pinterest cookies had all been read successfully. The pinned reader emits an error for an excluded Chromium service directory at report scope, and Molly treated every report error as a selected-profile decryption failure. The importer now recognizes only that unscoped discovery diagnostic as informational while retaining every selected-profile/source failure and other request error. Synthetic transaction regressions, a native before/after read and actual Settings import followed by an authenticated Pinterest page establish current-machine account reuse; signed distribution and restart persistence were not revalidated.

## Evidence and reuse

This follows the [development-import decision](../feature/2026-10-03-development-browser-account-import.md). The development terminal's existing Chrome data permission allowed an isolated Electron probe to read the same selected Chrome profile. Direct tool-launched Node and Electron probes failed discovery because they did not inherit that terminal's permission attribution; neither failure was evidence of a missing profile or a decryption problem. No OS permission was changed.

The native report completed with `status: partial`, twelve Pinterest cookies in its successful selected source, and no profile or source issues. Its only report issue was `profile_excluded_service_directory`, with `stage: discovery`, `severity: error`, and `profileId: null`. Molly's production reader rejected that report before the detailed read. The deterministic synthetic transaction reproduced the screenshot's exact fixed error before the patch.

The [pinned upstream source](https://github.com/teng-lin/rookie-cookies/blob/c934548faa1bab23984a9d82e4d62bd67230a1f9/rookie-rs/src/browser/registry/chromium.rs) excludes reserved service directories from profile discovery; its registry calls the exclusion informational, while the compatibility report severity mapping falls through to error. This is a diagnostic mismatch, not failed Cookie decryption.

- Unchanged reuse of `selectedSources` failed because its report-wide error check rejected this advisory discovery result.
- Adapt that existing validator with the exact diagnostic code, discovery stage, and explicit null profile scope. All three must match, and the exception applies only to report issues. No other error is downgraded.
- Reuse the pinned native reader, detailed comparison, context validation and existing import transaction. Alternative readers, dependency upgrades and custom decryption are unnecessary for the established defect.

The [workbench Spec](../../../../specs/graphic-design-platform.zh.md#内置网页调研与素材) remains draft; its site-scoped import intent is unchanged. Timeout/manual retry, no-write-on-read-failure, CHIPS rejection and rollback remain in force. No source paths, Cookie values or captured user transcripts are committed.

## Validation

- The new excluded-directory transaction regression failed with `This browser profile’s cookies could not be fully decrypted.` before the patch and succeeds after it.
- The source suite passes sixteen tests. Additional negative cases retain profile/source diagnostics, explicitly scoped diagnostics, unknown request errors, decrypt warnings and missing scope, with unchanged destination cookies after rejection.
- The same native report succeeds through the patched production reader with twelve cookies, including its real domain-filtered detailed read and multiset comparison. The original reader rejected it. Probe output contains only diagnostic metadata and counts.
- The read-only Codex CLI second opinion (`gpt-6-astra`, high reasoning) found no P0/P1 issues in the validator, tests and README. It independently ran fifteen in-memory cases and checked the detailed-read, partition and transaction guards; it did not rerun native account reads. Its optional parallel helper failed to initialize and its additional nested CLI check was denied by the read-only sandbox; the direct advisory review completed.
- `pnpm install`, `TMPDIR=/tmp pnpm check`, `pnpm format` and `pnpm run docs check` passed. The existing repository size warnings remain; no registered SHA-protected topics were present. The temporary-directory override avoids the known macOS socket-path-length artifact.
- `pnpm start:local` completed the OSS desktop build and launched Molly from the already authorized development terminal. A single manual Settings import from the selected Chrome profile succeeded, retaining six site cookies without the previous error. Opening Pinterest in the actual Molly browser redirected to its authenticated account home and exposed profile, notification and account controls; no manual website login was performed. This establishes current-machine account reuse, not signed distribution or restart persistence. The development build remains memory-only.
- Temporary native probes and their isolated user-data directory were removed. No release publication was performed.
