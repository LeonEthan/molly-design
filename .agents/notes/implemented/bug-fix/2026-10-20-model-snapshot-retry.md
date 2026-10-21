# Language-model snapshot recovery

Status: implemented
Translation: pending
Issue: https://github.com/LeonEthan/molly-design/issues/171

## Abstract

A failed first read of saved language-model connections left onboarding unable
to finish until its panel remounted. The shared connection settings now show a
specific localized error with a manual Retry, log the underlying error and report
readiness after a successful retry. This adapts the image card's existing pattern
without changing connection eligibility or daemon gates. Deterministic component
tests cover recovery; they do not establish recovery from an actual Keychain fault.

## Decision and ownership

The owner confirmed the failure copy, adjacent small outline Retry button and
loading/recovery interaction on 2026-10-20; that decision is recorded in #171.
The issue remains a follow-up for the next release rather than a blocker for the
2026-10-20 release. The existing shared `ModelConnectionSetting` remains the owner
for Settings and onboarding. Its `onConnectionsChange` callback already supplies
the parent with readiness inputs; no new readiness state is stored by onboarding.

Directly reusing the image settings component would load the wrong connection
schema and callback shape. Adapting the language component and borrowing the image
card's `loadAttempt`/`loadFailed` pattern provides the existing interaction without
a new component, hook or retry framework. Snapshot loading is a separate effect
so manual retries do not also reissue catalog and model-metadata reads. Initial
read failures are separate from the existing mutation error state, so a failed
save or delete never presents a snapshot Retry action.

Pending reads hide Retry and keep readiness unknown. Another rejection restores
Retry; success parses the snapshot through the existing schema and publishes
the saved connections through the existing callback. An empty success opens
the normal first-connection form. Effect cleanup retains the existing protection
against results updating an unmounted panel. There are no automatic retries,
credential writes or model requests in the recovery action.

## Verification

The new snapshot regression was run against the old implementation and failed
because the initial failure still showed the generic read/save error. After the
fix, model-connection, image-connection, onboarding-provider and shared readiness
suites pass: 172 tests. Controlled promises cover a pending retry, repeated
failure and eventual success with the same mounted component; assertions inspect
the UI, callback values and underlying error logging rather than mock call counts.
An onboarding view test composes the real language panel with the existing shared
readiness predicate and verifies Finish becomes enabled and actionable on recovery
when the other prerequisites are already satisfied. Storybook provides loading,
persistent-failure and retry-recovery states in both toolbar languages.

The full repository `pnpm check` passes, covering typechecks, type-aware lint,
workspace tests, translation keys and repository boundary guards. Documentation
checks also pass without errors; lint and documentation checks still report
warnings. Browser inspection of the real Storybook panel
confirmed the English error with its adjacent Retry and the Chinese failure-to-
saved-list recovery after clicking Retry, using the synthetic story transport.

The transport fixtures are synthetic and do not reproduce a macOS Keychain prompt
or establish packaged-app recovery. The onboarding view fixture supplies the
already-ready image, catalog and built-in Molly prerequisites; it does not replace
their independent integration coverage.
