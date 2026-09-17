# Complete design acceptance and release evidence

Status: implemented
Translation: pending

## Abstract

T29 now has installed macOS evidence for three synthetic design journeys, a real
four-asset poster and 12-image artwork, same-profile restart, and a copied-profile
fresh-process reopen. Native Claude's synthetic-provider rounds prove protocol
behavior, while the later real-asset runs prove the recorded save, PPTD, version,
export and reopen behavior. The user has now accepted the four real assets, both
artworks, editing, autosave/version/reopen, and PNG/JPEG results in the 567741b
review copy, the original edit target and all three human scene journeys overall.
Supplemental real-image replacement, commit, export and reopen coverage is complete,
and the reported intermediate-preview defect is fixed with scoped installed
evidence. T29 is complete at this recorded scope; general model quality, universal
performance limits and public release are not established.

## Three-scene human verdict and preview regression (2026-09-12)

The user confirmed that all three human scene journeys are complete and passed
at their overall reviewed scope. The local guide is
`/Users/macmini/FolioReview-70c9932-20260912-journeys/三场景完整人工旅程.md`.
This supplements the earlier six checks and edit-target acceptance. Individual
unfilled checklist fields remain unfilled; they are not a reason to request the
same overall human verdict again or evidence of specific unreported observations.

The same review reported that the open canvas showed only the final Agent output,
not valid intermediate edits. Track that defect separately from the accepted
scene quality. The [preview correction](../../implemented/bug-fix/2026-09-12-auto-open-agent-source-preview.md)
records the failing default-view regression, installed intermediate-file behavior,
and the retained fixture bookkeeping failure. Supplemental
real MCP results and free retained-output recovery now complete the remaining
technical coverage, as recorded in the live-image TODO. No public release was authorized.

## Identity and evidence boundaries

2026-09-12 acceptance addition: the [real image MCP and multi-image TODO](2026-09-12-live-image-mcp-acceptance.zh.md)
requires actual provider generation/editing and substantial real image assets in
the design journey. Its AruHub connection is test-only; the key stays in existing
secret configuration. The rounds and measurements below remain synthetic evidence,
not a pass for this new workload or real visual quality. Later normal-package
rounds issued three real generate requests and one real edit and retained four
decoded assets; the original tool receipts for generate outputs two and three
remain failures even though a later native round read the recovered bytes. The
same TODO now records a real four-image poster and 12-image long-artwork journey
through save, PPTD roundtrip, versioning, PNG/JPEG export, same-profile restart
and a copied-profile fresh-process reopen. The six requested human checks for
these two artworks now pass; see the human review supplement and bounded
workload recommendation below. The subsequent overall three-scene human verdict
and final supplemental image evidence complete the remaining local acceptance scope.

The original three synthetic journeys use the copied arm64 application built from
`b86a1c92aa529511c4390dc057649bbb00a53f50`, including the attachment-history repair.
DMG SHA-256 is `22fb673c62f4277386f15c5f47689a53fcc59e486d87ef3935884b9274a16a20`;
ASAR SHA-256 is `eef1beb7a270afb515db8c1d04e09da3f2c4c8c00f8250a766a0b3a10144d5bb`.
The package round is the local temporary directory
`folio-t28-b86a1c92-24v1tix4`, with `package-identity.json` and copied
`installed/Folio.app`. Its executable supplies its own entry and resources, with
no development entry injection. Each round verifies embedded source identity and
owns separate Electron/CLI profiles and an endpoint. Logs/transcripts stay outside
Git. The earlier T27 and 9ef packages are historical evidence, not this result.

The real-asset completion supplement uses the normal installed application built
from `567741bde4b0459e33711687ab438aaae70caafb` (DMG SHA-256
`d46c66a26c99d45857ed8238205698ea5e5d1558b9c7c77fdc828ecb68efd7aa`, ASAR
SHA-256 `033586c1079167f3f752bdfb6c0fc0046b80e03c00e6d1405c53ff9a2ef5ebdd`).
Its full journey is `/tmp/folio-t29-real-images-nPfTcw/evidence/result.json`;
the copied-profile process result is
`/Users/macmini/copied-profile-verification-akD0AA/result.json`. Both verify the
embedded source identity and clean owned-process/endpoint teardown. The copied
review artifact remains at `/Users/macmini/FolioReview-567741b-20260912`; the user
has filled in its six human checks.

## Human review supplement (2026-09-12, 567741b)

The user completed `开始验收.md` in the copied review profile and explicitly
requested that its conclusions be read. All six fields accept the real assets'
content/clarity, poster quality, 12-image artwork quality, crop/scale/text/Undo/Redo,
autosave/version/reopen experience, and PNG/JPEG visual results. This supplements
the immutable automated results; their original pending human fields are not
rewritten. Earlier pending statements below describe earlier rounds.

The review also raised the absence of conversation history in these two sessions.
These particular fixtures were seeded through `design.create` and PPTD import,
without Agent messages. The preparation script
`/tmp/folio-t29-real-images-native-14.mjs` creates their associations at lines
320–330 and copies the source files at lines 350–355. The review export in
`e2e/src/support/electron-harness.ts` copies the complete stopped profile; it does
not strip messages. There was no creation conversation to display for these
fixtures. This explains their empty chat area and does not claim a new regression
test of ordinary conversation-history persistence. The review instructions should
have made this fixture boundary explicit.

The verdict covers the inspected local package and workload, not Windows/Linux,
all three original scene journeys, numeric memory/latency thresholds, or release
authorization. The user subsequently also accepted the original-versus-edited
image target comparison recorded in the live-image TODO. Remaining coverage
continues to follow the installed matrix and live-image TODO.

### Workload recommendation after human review

The recorded measurements and accepted interaction experience support local use
on this Apple M4 / 16 GiB machine at the tested workloads: a 1200 × 1800 poster
with four image nodes and a 1200 × 2400 artwork with twelve nodes reusing four
distinct real assets. This is a workload recommendation, not a supported maximum
or a requirement for another user-approved numeric threshold.

The 567741b real-asset result above contains one journey per workload. Its
observed load-and-import times were 1.66 s and 1.68 s; PNG exports were 1.52 s
and 2.34 s; JPEG exports were 1.39 s and 1.94 s, respectively. The poster's
10.79 s crop/scale/replace/undo/redo/autosave sequence includes multiple actions
and is not input latency. Nine poster disk/PPTD readback checks took 29–44 ms;
the long artwork's single check took 40 ms. These readback timings do not measure
the whole automatic-save interval. Maximum sampled main RSS was 505 MiB and
458 MiB; maximum sampled sums of owned-process RSS were 2202 MiB and 1933 MiB.
The sums can count shared pages more than once and are not exclusive footprint.

Existing applications remained open; these are observed operation timings, not
an isolated benchmark. The earlier synthetic table below retains three samples
per scene on smaller assets. Neither set establishes p95, leak/soak behavior,
application cold startup, a universal latency budget or a maximum image count.
The human verdict accepts the named interactions and visuals, not each memory
measurement. These limits satisfy a bounded scope recommendation without
inventing an additional numeric-approval gate.

The [procedure](../../../../e2e/DESIGN-ACCEPTANCE.md) remains the human workflow;
the [installed matrix](2026-09-11-installed-five-agent-matrix.md) owns the five-Agent
verdict. The later normal `dcc3c975` package passes the original Pi cold/resubmit
round and a separate zero-Bento worker-quit round; see the
[normal repair regression](2026-09-11-installed-five-agent-matrix.md#normal-design-worker-repair-regression).
Earlier b86 cleanup failures remain historical failed rounds. This limited
regression does not replace the b86 three-scene measurements or human review
package, establish every recovery path, or complete T29. The b86 Pi catalog
limitation and earlier full-hook blockers describe those historical revisions;
current MCP exposure and read-before-edit reminders follow the
[installed matrix](2026-09-11-installed-five-agent-matrix.md) and the revised
Spec. Generation-level read proofs are no longer a current acceptance gate.
Ordinary execution and image reading remain separately evidenced. The b86 rounds
used no paid provider; the later real-image rounds use the explicitly authorized
test connection. No normal user profile, public release, Developer ID identity,
notarization or update system was used.

Local evidence names below resolve under macOS's task temporary directory
`/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/`, unless a repository artifact
path is stated. These are local review artifacts, not portable CI attachments.

## Original Issue 31 criteria audit

| Criterion                                                                                                                 | Evidence and exact scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Remaining boundary                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Three complete scene journeys and separate human verdicts                                                              | `folio-t29-poster-tmUzEb`, `folio-t29-infographic-W8bEBY`, `folio-t29-long-image-OPseXd`, each `evidence/result.json`, exit 0 with clean teardown. Native Claude receives the attached bytes, reads/writes drafts, renders and actually reads the PNG; DOM edits are flushed before continuation, observed preview matches the new background/manual text, formal save/reopen and decoded PNG/JPEG succeed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | These are synthetic-provider and programmatic UI runs. The procedure's richer physical edits, creative quality, reference use and separate visual/editing judgments remain human work.                                                                                                                                           |
| 2. Roundtrip, isolation, flush, whole-lifecycle multi-instance readonly, version conflict/resubmit/continue               | Existing authoring roundtrip, CLI sync/turn-outcome and canvas-access tests; three native journeys assert actual continuation Read tool-result contains MANUAL text and both canonical hosts reject execution-time mutation. `folio-root-processing-poster-j0P1Ss` proves both canonical hosts reject mutation during actual finalization. T28's installed native Pi/Claude probes cover their recorded conflict/resubmit/recovery cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Earlier b86 Pi rounds retain teardown failures; the later normal dcc3c975 cold/resubmit and zero-Bento quit rounds pass at their recorded scope. Full recovery was not repeated on that package. The current public-reminder/current-PPTD combinations are tracked in the installed matrix; historical strict-hook gaps are not current runtime-patch requirements. The controlled finalization contention is explicitly disclosed below. |
| 3. File lifecycle, consumers, exact-source import and no loops                                                            | Native scenes exercise multipart writes, missing dependency retaining the last valid frame, page rename, continuous writes and close/reopen/Refresh. Long-image commits a background turn with no Bento consumers. Installed b86 P1 validates native source changes and exact clicked-source import against refresh/version changes. `design-canvas-sync-core.test.mjs` tests shared consumers, dirty/closed publication suppression and dependency reconciliation; `design-source-preview.test.tsx` tests reconnection/finished-history refresh without a new design-preview event and subscription release. Source previews leave canonical content unchanged before formal commit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Reconnection/turn-end compensation is deterministic evidence, not injected OS-event loss. Native scenes are not a separate proof of closing one of two simultaneous source-preview consumers; that boundary uses the existing deterministic test. No new watcher fault engine is warranted.                                      |
| 4. No CLI, image configuration failure, disk failure, cancel/quit/reopen, old content, render/read and retired thumbnails | With Agent setup skipped, the fresh-profile measurement round completes nine actual Bento edit/save/PNG/JPEG export iterations; copied-profile verification independently reopens and saves all three Sessions. Separately, Poster terminates its actual bundled daemon, observes stopped/readonly state and preserved canonical content, then restarts successfully. All scenes exercise real EACCES preserving unsaved edits, then successful save. Infographic cancels, quits the full app and restarts the same durable profile with a new PID/endpoint before explicit native continuation. T13 image-connection tests and b86 image probe own explicit configuration failures. Native Read consumes a legacy PNG, and render output is actually read; file inventories remain unchanged with no dedicated thumbnail producer, including background work. The bounded legacy-file supplement also opens the PNG through the installed ordinary image-preview dialog; a later `5b21c6a` round opens the original-format JSON in the ordinary file editor and preserves its exact bytes. The `81d54b6` historical-receipt round opens that receipt’s original-file button and preserves history, canonical content and JSON. | Daemon unavailable is not physical absence of a bundled executable. Historical receipt UI evidence uses a synthetic old-format entry through existing offline storage APIs; it does not establish migration of every real historical profile.                                                                                    |
| 5. Existing deterministic facilities and separate native/human evidence                                                   | Reuses the Electron harness, resource probe, authoring intake/projection and P0/P1 verification. External synthetic probes identify new cross-behavior failures without a second regression registry, scheduler or product test protocol. Raw traces/scripts/requests are retained per round.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Native macOS evidence does not establish Windows/Linux or human behavior. Prior deterministic coverage is retained at its actual scope, not postponed wholesale or promoted to a native verdict.                                                                                                                                 |
| 6. Measurements, acceptable range, user/release guidance | Nine original installed samples and process trees remain in `e2e/artifacts/acceptance/design-measurement-lbmkAx`. The later real-image measurements and six accepted human checks support the bounded M4/16 GiB workload recommendation above. README and the procedure distinguish operation timings, hardware and Agent limits. | Neither set establishes p95, leaks, maximum scale or a universal performance threshold. The user subsequently accepted all three scene journeys overall; unfilled per-step T22 fields are not fabricated. The preview correction has scoped installed evidence; a new universal numeric tolerance is not an additional gate. |
| 7. Preparation only, no implicit publication or human approval | The local package is ad-hoc signed; no public release, notarization, Developer ID authorization or update system. The six real-artwork checks and original edit-target comparison are accepted at their recorded scope; all three human scene journeys are subsequently accepted overall, without filling unreported per-step observations. | Release decision is pending. Existing human approval is preserved without extending it to unreviewed journeys. |
| 8. Documentation, decision record and proportionate checks                                                                | This note, README pair and existing acceptance procedure record current evidence, failures and limits. Harness restart/profile-export tooling passed full checks and development build plus 3-scenario/18-step smoke when committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Supplemental documentation checks are reported with the final patch; passing checks do not approve the Spec or close Issue 31.                                                                                                                                                                                                   |

## Native rounds and retained failures

The three input fixtures contain 10/10/16 editable elements. Actual saved exports
contain 11/11/17 after the post-Agent edit. Their revisions are respectively
`ca79adb93934afed44acd387418e123d855467359f2aacee94798774339b838d`,
`a964b5b6c25854bf187a42496328a32cf92b7c858a5a3ef93ddc11adc607dcd7`, and
`cf4a8d28faec9e2c00e64c5610d5097cb17769c5f83c9fd34d9907cd83e5c641`.
The infographic's later restart/continue and long-image's later background commit
have separate recorded revisions; the human exports correspond to the revisions
above. Each round retains the original script, package identity, native tool
requests, screenshots, exports, CLI logs and result, not just a screenshot verdict.

Poster rounds 1–5 remain failed evidence: duplicate button selection; an extra
fixture asset correctly rejected by the read baseline; a hidden title clone;
incorrect fixture copy nesting; and the finalization observer described below.
Infographic round 1 misclassified native startup traffic as design traffic. No
product success was inferred from these failures; corrected rounds use new
artifacts. The local logs are `/tmp/folio-t29-poster-{1..6}.log`,
`/tmp/folio-t29-infographic-{1..2}.log` and `/tmp/folio-t29-long-image-1.log`.

Finalization observation initially watched the logs directory. The failed
`folio-root-processing-poster-P7lHoK` records no watch events even though the exact
CLI trace entered `designTurnOutcome` 22 ms after provider release and remained
blocked on the existing design lock. macOS directory watching did not report that
existing-file append. The corrected external observer watches the actual prepared
trace file; it keeps the same five-second bound, ten-second lock wait and all
assertions. In `folio-root-processing-poster-j0P1Ss`, provider release is
14:30:54.977Z, stage entry 14:30:55.004Z, and assertion/release 14:30:55.032Z.
Both canonical hosts report `{readonly: true, unchanged: true}`; canonical storage
stays unchanged while locked, followed by normal formal commit and cleanup.
This is controlled contention on an isolated artwork, not a fabricated runtime
stage. The immutable result's old static `NOT PASSED` label is stale;
`actualResultProcessingReadonly` and the exact trace establish the later pass.
The original poster5 and directory-observer failures are not edited or erased.

## Measurements

The installed measurement round ran serially with other native probes/builds/checks
idle on Apple M4, 10 logical CPUs, 16 GiB RAM, macOS 26.6.2 / Darwin 25.6.0,
Electron 39.5.1, 1920×1080 display at scale 2. Historical acceptance applications
were part of the recorded background environment; no process was killed by name.
These are seeded/no-Agent/no-human measurements. The reference image is tiny and
the canvases are intentionally modest; neither realistic asset load nor maximum
scene scale follows from them.

Every sample below is milliseconds; rounding here does not replace raw JSON.
Attach means a new Bento view in an already running app, **not application cold
start**. Edit means a programmatic shape click through snapshot observation,
**not physical input-to-screen latency**. Save/export include IPC and result
validation; export files are real and decoded. R1/R2 reopen the saved scene.

| Scene / iteration | Attach or reopen | Edit |  Save |    PNG |   JPEG |
| ----------------- | ---------------: | ---: | ----: | -----: | -----: |
| Poster 0          |           293.16 | 4.30 | 26.67 | 362.08 | 332.59 |
| Poster 1          |           269.57 | 4.39 | 22.58 | 334.72 | 333.82 |
| Poster 2          |           264.48 | 3.91 | 20.85 | 345.35 | 300.46 |
| Infographic 0     |           270.55 | 4.52 | 20.31 | 365.47 | 331.77 |
| Infographic 1     |           267.43 | 3.99 | 24.42 | 339.82 | 329.76 |
| Infographic 2     |           264.36 | 4.10 | 23.01 | 370.95 | 332.56 |
| Long-image 0      |           273.05 | 4.19 | 21.95 | 366.31 | 355.61 |
| Long-image 1      |           288.92 | 4.10 | 23.67 | 376.99 | 358.77 |
| Long-image 2      |           268.25 | 4.18 | 23.80 | 407.84 | 352.11 |

Each scene's final iteration also encounters actual export `ENOENT` with the
saved design unchanged. This is separate from native-journey canonical EACCES.
Ambient snapshots retain main, shell renderer and all child processes at each
checkpoint. Maximum sampled values in MiB are:

| Scene       | Main RSS | Shell JS heap | Bento renderer RSS | Sum of owned process RSS |
| ----------- | -------: | ------------: | -----------------: | -----------------------: |
| Poster      |   334.80 |         79.98 |             186.73 |                  1974.31 |
| Infographic |   370.91 |         56.99 |             186.75 |                  1962.47 |
| Long-image  |   428.69 |         57.08 |             186.80 |                  2048.42 |

Bento is identified as the new renderer process absent from bootstrap's renderer
set, not conflated with the shell's heap. RSS sums may count shared pages more
than once; they are not exclusive physical memory. These ambient maxima are not
post-GC retained-memory measurements or a leak verdict. No p95, universal budget
or supported maximum is declared; human tolerance remains part of acceptance.

## Persistent human review package

The ignored artifact directory
`e2e/artifacts/acceptance/t29-b86-human-review` contains the Chinese entry
`开始验收.md`, `Open Folio Review.command`, identity/hashes, three exact editable
PPTD projections, saved canonical documents, actual PNG/JPEG exports, all nine
measurement samples and three imported Session identities. The launcher uses
`/Users/macmini/FolioReview-b86-20260911` and a fresh isolated endpoint without
external provider credentials. A reviewer must configure an authorized connection
for their own Agent journey. The supplied provider-wire results are not a claim
of creative quality.

The existing harness exports a verified owned profile only after successful
process/endpoint teardown, to a new external destination. Copy failure retains
the original evidence; successful export performs normal source cleanup. A new
storage migration/protocol was rejected: source paths naturally resolve from the
new data root. The initially long destination hit the existing Unix socket path
guard, so the closed profile was moved to the short path without editing Loro.

`copied-profile-verification-3/result.json` proves a fresh b86 process opens each
imported Session, matches both canonical and Bento snapshots, is editable, saves,
and refreshes the actual source preview from the new short root. It records owner
and view URLs/bounds and passes owned-process and port cleanup, preserving review
data. The earlier copied-profile rounds retain two fixture failures: selecting a
previous Session's retained view and reading a new view before its interface was
ready. The corrected probe selects the actual `ws` Session parameter and awaits
interface readiness; no equivalence assertion or timeout was weakened. Screen
lock prevented physical inspection, which is still pending.

Tooling commits `8300769` and `d37ebf8` were checked with repository check/format,
docs and E2E contracts; the profile-export build and smoke logs are
`/tmp/folio-t29-profile-build.log` and `/tmp/folio-t29-profile-smoke.log`, both exit 0
(3 scenarios, 18 steps). This documentation does not change product bytes or
require rebuilding the b86 package. Final human and release fields stay pending.

## Bounded legacy-file UI supplement

A fresh b86 installed round, `folio-t29-legacy-ui-akqZf0/evidence`, exits 0 with
owned process/endpoint cleanup. It opens an existing synthetic `legacy.png`
through the ordinary composer attachment button and **Image preview** dialog;
the image is visible, fully loaded and 32×32 pixels. Its screenshot, trace,
CLI logs, external script and before/after file hashes are retained. The
unsubmitted attachment is removed without dispatching an Agent. This supplies
ordinary old-image UI reachability for criterion 4, not a historical result-card
or historical receipt interaction. No human visual verdict follows.

The same round prepares an original-format candidate JSON with T07's existing
`historical-candidate.fixture.ts` and the existing Bento sample. Both JSON and PNG
remain byte-identical. The composer JSON attachment block has no open handler;
no JSON UI-open claim is made, and no historical Session data was fabricated.
T07's `candidate-file.test.ts` independently verifies ordinary preview returns the
original JSON bytes, document and extractable assets, while
`design-file-receipt.test.tsx` verifies the historical receipt's ordinary-file
button and failure behavior. Those are deterministic evidence, not native
historical-receipt acceptance. This closes the recorded ordinary PNG UI gap while
retaining the native historical JSON/receipt boundary explicitly.

The log is `/tmp/folio-t29-legacy-ui-1.log`; its execution handle was 40199.
The harness and product were unchanged, no model call was sent, and the persistent
human review profile was not touched. UI ownership was released after successful
teardown. This supplement changes no earlier immutable result or human field.

### Original JSON through the ordinary file viewer

The normal `5b21c6a` installed package subsequently passed a bounded JSON round,
handle 42712, with evidence in `folio-t29-legacy-json-K62tb0/evidence` and
normal-package log `t29-legacy-json-native-3.log`. An existing scripted ACP fixture
supplied a Markdown file link; this is a synthetic UI test, not a native model or
replayed historical Session. The original JSON format came from T07's existing
`historical-candidate.fixture.ts` and the Bento sample, validated with the existing
candidate reader. Production candidate creation remained absent.

Clicking the actual **Open agent file** button opened the existing Monaco file
view, showing version 1, candidate identity, the synthetic historical turn and
original document/assets. Root also inspected the captured screenshot. The JSON
was byte-identical before/after, with SHA-256
`30a5f4e8727dd371743e53652d33dfe75823f637572e5aef9ab948d8ac5ee7e4`;
re-reading the original file through the compatibility reader preserved identity.
Diagnostics reported no failures, and the normal harness completed owned-process,
endpoint and directory checks at 18:12:30.004Z. Exit-time socket closure messages
remain in the evidence and are not removed from logs.

The preceding `t29-legacy-json-native-2` attempt exited 1 **before App launch**:
its fixture path validation omitted the `@` in the actual Node 22 executable path.
Its original JSON and failure record remain at `folio-t29-legacy-json-4wanEQ`.
The next script added only that literal path character; source-visibility, exact
file bytes and teardown assertions were unchanged. Neither round supplies old
Folio `designOutcome` storage; ordinary JSON reachability establishes only that
narrower criterion. The separate historical receipt round below uses the existing
offline storage API to exercise the missing UI path.

### Historical receipt opens its original JSON

The normal `81d54b6` installed package passed handle 15509, with evidence in
`/tmp/folio-hist-JYtVG6/evidence` and package log
`t29-history-receipt-native-2.log`. After the app closed and all owned processes
exited, the fixture used existing `SessionDocument.initOffline`, `updateHistory`
and repository flush APIs to seed a new isolated profile. Its one handled user
entry and version-1 candidate outcome follow the original `f243a1ae` production
shape and test fixture. No real history or raw database encoding was altered.

Reopening the installed app displayed the actual historical receipt. Clicking
its original-file button opened that JSON in Monaco; root inspected the captured
screenshot. The final offline comparison found the exact same history, canonical
document and original JSON bytes, SHA-256
`03f86706b63229d716dfe17772929029c9d108f5b577df1eabcaa8877af34ce3`.
Full CLI logs through quit and the unchanged one-entry handled history show no
automatic prompt dispatch during this observed interval. Diagnostics were empty,
owned-process and endpoint checks passed, and teardown finished at
18:32:12.740Z. This is synthetic native UI evidence, not a human quality verdict
or a guarantee about unobserved future sessions.

The earlier handle 99786 exited 1 during fixture preparation: the existing history
reader adds an own `inputConfig: undefined` property that the expected object
omitted. Its seeded profile and failure remain in `/tmp/folio-hist-MbNcWw`; no
receipt interaction ran. The next fresh fixture accounts only for that known
normalization, retaining strict history, canonical-content and byte comparisons.
Runtime code and the human review profile were unchanged. Full T29 acceptance and
human judgments remain pending.
