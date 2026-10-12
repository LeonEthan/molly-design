# Browser import starts with explicit intent

Status: implemented
Date: 2026-10-11
Translation: pending

## Abstract

Opening the browser-account dialog read profile metadata before the user requested
import, and an access failure disabled the action that should initiate authorization.
The revised flow discovers installed apps first and prepares the selected browser
only after Import, using native system prompts and an explicit profile choice when
several exist. Confirmed file-access denial retains a direct settings fallback and
Continue import without a manual refresh; cancellation and denial never silently
retry. The trade-off is a later profile choice for multi-profile users; repository
checks, synthetic native/UI validation and the local OSS desktop build passed.
Final live development acceptance imported 13 real Chrome/Pinterest Cookies and
opened Pinterest with its account navigation already available. Real file denial,
the settings fallback and Continue import completed without a profile refresh.
First-prompt grant continuation remains unverified: the initial Keychain approval
was late and its import failed, and macOS refused a fresh file-access prompt for
the development launcher. These are separate acceptance limits.

## Problem and decision

The former dialog depended on successful profile enumeration to enable Import.
Its source-unavailable error combined missing data, unreadable browser files and
Keychain failures, and offered Files and Folders settings for all of them. That
made users diagnose permissions before they could express import intent and could
send them to the wrong settings page. Opening settings also left a separate profile
reload step.

The same dialog now initially lists installed Chromium applications only. Import
owns a cancellable source operation that enumerates the chosen browser's metadata.
Real native access may invoke macOS authorization; Molly supplies a neutral waiting
message and neither imitates nor guarantees a system prompt. One profile proceeds
directly; multiple profiles return to the same picker for an explicit choice before
Cookie decryption. Main enumerates and validates the profile again on every selected
request, eliminating stale cached authorization or profile assumptions. A missing
selected profile returns current choices and requires selection again, even if only
one replacement remains; it never silently changes the requested identity.

A successful grant continues the same live request. OS cancellation or denial
leaves browser/profile/site selections in the open dialog for explicit retry.
Application Cancel closes the dialog and revokes pre-write work; a newly opened
dialog resets website selections under the existing rule. Only typed browser-file
access denial offers Files and Folders settings. Keychain denial and unavailable
sources retain separate errors. Opening settings preserves the dialog; Continue
import retries explicitly without Reload profiles, focus-driven checks or automatic
sensitive reads. Development access may still belong to the terminal or coding
agent that launched Molly.

## Responsibilities and reuse

Reuse ladder: adapt `BrowserAccountImportDialog` because its pre-read and valid-profile
button gate cause the deadlock; retain its Dialog, Select, Checkbox and Collapsible
primitives. Reuse application-only discovery, the pinned native addon, the existing
native operation lease, and the write/verified-rollback transaction. The original
native reader flattened filesystem errno and Keychain OSStatus; resource version
`0.6.0+molly-native-keychain.2` narrowly preserves selected-source EPERM and explicit
Keychain cancellation/authentication failure rather than guessing from generic error
strings. EACCES and general permission-denied failures do not offer system settings;
locked/disallowed/missing Keychain items remain generic unavailable sources. Discovery
denials in unselected browser channels or profiles do not block usable profile choices.
No permission wizard, SDK, folder bookmark, permission database or other store is
introduced. A retained successful import is not evidence of current authorization.

Live acceptance exposed another adapter mismatch: upstream snapshot normalization
omits invalid header octets across the whole profile and warns about unparsable
partitions before Molly selects websites. Those aggregate warnings blocked a real
selected-site import despite successful native authorization and decryption. The
`.3` resource adapts the same bounded read with a private inventory mode, preserving
decoded fields/context for main-side selection and conservative candidate validation.
Default snapshot behavior is retained. Genuine row/decryption/host failure and
unknown warnings remain fatal; JavaScript-unrepresentable expiry is rejected in
native code. This corrects the adapter rather than allowing incomplete selected data.
Selected values permit printable ASCII, including quotes, JSON, commas, internal
spaces and backslashes, while rejecting semicolons and outer spaces. Electron's
actual destination transaction preserves the permitted syntax exactly; normalized
values fail readback and trigger verified rollback. Invalid selected names, paths
or values still fail before writes, and unselected rows do not become candidates.
The existing report API was rejected because its Node projection loses partition
context and lacks the cancellation-handle port. A warning whitelist was rejected
because it cannot recover or account for previously omitted selected rows.

Source preparation remains outside Agent pause and destination isolation. One
bounded whole-profile native read feeds curated-ID filtering; only its ready source
enters the existing write phase. Cancellation discards late output but cannot close
an OS prompt or release the native slot early. Accepted writes and rollback drain;
the dialog reports finishing rather than promising cancellation at every stage.
Agents never restart automatically, and Cookie counts never establish website login.

The smaller alternative retained profile pre-read and merely enabled an access/retry
button. It was rejected because opening would still read protected metadata and
there is no proven non-interactive permission probe for this path. Earlier profile
listing would help already-authorized multi-profile users select their identity
before Import, but last-success memory is insufficient to justify that branch.

This partially supersedes the profile-discovery and retry interaction in
[whole-profile import](../feature/2026-10-11-whole-profile-browser-import.md), preserving
its native-read, transaction and signing decisions. The
[launcher-attribution record](2026-10-05-browser-import-launcher-attribution.zh.md)
retains its historical finding, while its manual refresh guidance is no longer the
current dialog flow. Both [Spec languages](../../../../specs/graphic-design-platform.md)
remain draft; authorizing this implementation does not approve the entire Spec.

## Evidence and validation limits

### Final real development acceptance

- The final worktree application was rebuilt through ordinary `pnpm start:local`,
  using Electron 44.7.0 / Chromium 152.0.7977.130 on arm64 and the sealed `.3`
  resource. It read the user's real, running Chrome. The destination began with
  zero Cookies and uses the normal development memory-only session.
- Opening the dialog allowed Import without reading profiles. Import discovered
  multiple real profiles; the user-selected active profile and Pinterest-only
  scope then imported 13 Cookies, skipping two expired and zero partitioned
  Cookies. Done updated Website accounts to 13 without refreshing profiles.
- Opening Pinterest in Molly's Browser panel reached its business hub and exposed
  profile, notification and account navigation without manual sign-in. Subsequent
  website responses added Molly-only Cookies, taking the settings total to 16.
  The live website navigation, rather than the import count, establishes this
  particular account's sign-in. No Agent was started or resumed for this check.
- With explicit action-time consent, the launcher's existing Chrome file access
  was temporarily disabled. Final `.3` Import returned typed file denial and
  retained the selected profile and single-site scope. The dialog's fallback
  opened Files & Folders and changed the primary action to Continue import.
  Restoring the original Chrome grant and clicking Continue import imported 13
  Cookies directly, with no profile reload. Chrome permission ended enabled;
  other privacy categories were unchanged. This verifies the real denial/settings
  recovery path, separately from first-prompt authorization.
- A separately authorized reset of only the launcher's application-data category
  succeeded. The following Import made a real TCC request attributed to the coding
  launcher; macOS rejected prompting an unentitled binary and returned denial.
  No system approval appeared. The user clarified that they had also clicked the
  launcher's Chrome permission ahead of continuation. Continuing after the settings
  fallback succeeded, but this attempt does not establish a first prompt or
  same-request grant continuation. Keychain ACLs and other privacy categories
  were not reset. Neither this development result nor a usage-description string
  guarantees a prompt in a signed distribution. Apple's
  [usage-description documentation](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppDataUsageDescription)
  explains prompt wording; it does not supply a separate grant mechanism.
- Account identifiers, Cookie names/values, source profile paths, screenshots and
  captured user/system transcripts are excluded from the tracked record. Runtime
  screenshots remain temporary local evidence, and all tracked regression
  fixtures are synthetic. Source Chrome data was not modified.

### Earlier failures retained

- The initial `.2` development request triggered a real native `Chrome Safe
Storage` Keychain approval. Computer-use tooling explicitly excludes
  SecurityAgent, so the human handled approval. It arrived about fifteen minutes
  after the request and the dialog returned an unavailable-source error. A native
  five-minute deadline is a plausible explanation, but the original diagnostic
  was not retained; this is not a successful automatic-continuation result.
- Immediate explicit `.2` retries reproducibly failed with `source-incomplete`.
  A separate sealed-reader diagnostic returned matching identities, no decryption
  warnings, 54 `invalid_octets` and four `unparsable_partition_key` warnings. It
  exposed whole-profile snapshot normalization preceding selected-site filtering;
  it did not write destination data or establish login.
- The earlier `.2` real file-denial/settings test already preserved choices and
  re-enumerated automatically after Continue import, but stopped at that separate
  normalization failure. The final `.3` recovery above supersedes that completion
  limit without erasing the failed attempt.
- After inventory mode, real candidate validation also exposed printable quoted
  values rejected by the portable-header octet rule. Synthetic fixtures and the
  real Electron transaction probe established exact destination support before
  widening selected-value validation. Values normalized by Chromium remain
  rejected and are covered by verified-rollback evidence.

### Final automated and advisory validation

- `pnpm check` passed, covering workspace type checks, oxlint, all CI tests, i18n
  and the CodeCollab/platform/public-boundary guards. Targeted source/service
  suites passed 41 tests; the final source suite, including terminal control
  characters and unknown/saturated warning rejection, passed 18 tests.
- `test:cookie-reader` passed three Node tests, including eight pure Rust typed
  permission/inventory fixtures and sealed-addon/synthetic SQLite/WAL budget
  checks. The final production isolation/transaction probe on Electron passed
  six checks: running/stopped Worker isolation, full website-data clearing,
  exact metadata/CHIPS rollback, printable Chromium Cookie syntax round trips,
  and rejection/recovery when the destination normalizes a value.
- `.3` arm64 staging/build and its sealed resource checks passed. The `.3` x64
  native addon cross-compiled successfully and was verified as Mach-O x86_64;
  it did not replace the live arm64 resource. Earlier `.2` x64 sealing is historical
  evidence. No `.3` Intel-host execution or signed distribution was performed.
- The complete local OSS build passed, and final `pnpm start:local` rebuilt CLI,
  main, preload and renderer before the real tests above. Scoped formatting,
  `pnpm run docs check` and `git diff --check` passed. There are no registered SHA
  topics; existing documentation size warnings do not establish Spec approval.
- Browser observation of the actual Storybook component verified enabled first
  Import, post-click reporting, explicit multi-profile choice, the denied-file
  settings-return Continue state and no file-settings action for Keychain denial.
  Controlled stories and synthetic source/service/renderer fixtures cover
  same-request grant continuation, classified denial, owner cancellation,
  late-result rejection and retained transaction boundaries. They cannot replace
  real first-prompt approval acceptance.
- The read-only design second opinion used Codex CLI `gpt-6-astra`, high reasoning,
  and recommended delayed enumeration with separate file/Keychain handling. The
  subsequent inventory opinion classified the normalization gate as a P1 import
  blocker and recommended the bounded inventory adaptation. Both completed
  successfully, were considered advisory and did not modify files.
- Final Codex CLI `gpt-6-astra`, high, read-only review completed with exit zero
  and reported no demonstrated P0/P1 in the uncommitted change. It checked source
  and synthetic fixtures, including native version/mode gating, warning rejection,
  cancellation, selected-field validation and verified recovery. It did not run
  the app or inspect private data; its opinion does not establish real authorization
  or approve the Spec. An earlier review's blocked nested CLI attempt is not
  additional successful verification.
- First-prompt approval followed by successful automatic completion, Developer ID
  signing/notarization, grants across upgrades/restarts, Intel execution and the
  other 26 catalog websites remain separate acceptance limits. The development
  session loses imported sign-ins on quit. Live acceptance kept the app running
  and did not publish account data.

Implementation evidence: [dialog](../../../../packages/components/src/components/settings/browser-account-import-dialog.tsx),
[source preparation](../../../../apps/electron/src/main/services/browser-account-source.ts),
[operation and destination lifecycle](../../../../apps/electron/src/main/services/public-browser-service.ts),
[native reader patch](../../../../apps/electron/native/browser-cookie-reader/embedded.patch),
[write and recovery](../../../../apps/electron/src/main/services/browser-account-import.ts).
