# Molly design acceptance

The DSL redesign additionally requires the real Kimi Code CLI
[golden reference replication case](KIMI-REPLICATION-ACCEPTANCE.md): the frozen
user-supplied MagSafe image plus the exact prompt `复刻这个设计`. High visual
consistency needs a human verdict alongside editable-design checks. This case is
specified; real-run integration and execution are pending. The synthetic scenes
below do not substitute for it.

This is the T29 review procedure, not human approval. Detailed installed-round,
measurement and audit records are retained locally.
Three synthetic native journeys and copied-profile mechanical verification pass.
The user accepted six visual/editing checks on the later 567741b real-asset poster
and 12-image review copy; that does not complete the original three-scene human
journey or the explicitly recorded remaining scope.
Use the final
combined installed macOS application. The earlier T27 package, development
Electron, unit tests and screenshots do not establish this journey or a human
visual verdict. Keep failed and repaired rounds separate under the existing
ignored `e2e/artifacts/acceptance/` lane, with captured logs outside Git.

## Package and evidence identity

Record the source commit embedded in `app.asar/package.json`, DMG SHA-256, ASAR
SHA-256, installed executable path, macOS build, architecture, CPU, RAM, display
scale, Electron version and native Agent/adapter versions. Run the existing
`ElectronHarness` with T28's installed-executable selection and expected source
commit. Its separate Electron/CLI data directories and endpoint must remain in
force. A source mismatch, teardown failure or surviving owned child is a failed
round. Do not use a normal user's app or data for fault injection.

The reviewer receives the copied app, synthetic input directories, actual PNG and
JPEG exports, checkpoint images, measurements and failed-step diagnostics before
being asked to judge. The reviewer records visual and editing verdicts separately
for each scene, including concrete defects. An Agent cannot sign those fields.

## Synthetic scenes

The [fixtures](fixtures/design/) contain independent, editable PPTD projects and a
small redistributable synthetic reference image copied from the existing minimal
PPTD example. They contain no captured user or Agent content. They are controlled
inputs, not evidence of model quality. A provider-wire run may use their exact
bytes; a real model run starts from the brief and image and may choose its own
composition. Do not call a paid provider without an authorized connection.

| Scene | Canvas | Brief | Human edit, then Agent continuation |
| --- | --- | --- | --- |
| `poster` | 800 × 1100 | Community workshop poster, “MAKE SOMETHING”, Saturday 14:00; use the reference colors and editable text | Change the time to 15:00 and move the title; ask the Agent to improve spacing while preserving both edits |
| `infographic` | 1200 × 900 | Explain gathering references, arranging the message and reviewing a design in three steps | Rename the middle step and recolor its panel; ask the Agent to improve alignment and preserve the revised wording |
| `long-image` | 800 × 3200 | Six-stage studio walk with a title, readable sections and footer | Edit the fifth section and reposition the footer; ask the Agent to improve section rhythm while retaining those changes |

For each scene, follow requirement/reference attachment → Agent design → manual
edit → Agent continue → watch file preview during execution → formal commit →
manual edit/save → leave and reopen → PNG and JPEG export. Check the actual
exported dimensions and decode/open both files; a window screenshot is not an
export. Judge readability, clipping, hierarchy, reference use, alignment, image
fidelity, text selection/editing, undo/redo, zoom/scroll and long-canvas navigation.
Record attachment transport, render-preview success and actual image-tool read as
three separate observations. A model's “I reviewed it” sentence is insufficient.

## Shared workbench human check

Once across the three journeys, also complete T22's human acceptance in a wide
and a narrow window. Check Focus canvas and Properties hide/show, readable
conversation/canvas balance, toolbar density, light/dark appearance, normal Chinese
candidate selection, Shift+Enter and dialog/Tab focus. Physically paste and drag a
reference image through the OS clipboard/Finder and confirm its attachment is
usable. Existing synthetic paste/drop handlers and native IME checks establish
technical behavior but do not substitute for these human observations. Record one
shared verdict and concrete problems; do not repeat these checks for every scene.

## Cross-behavior evidence

Existing deterministic coverage is the starting point below; it does not replace
native watcher, installed runtime or human evidence. Reuse these seams for a
specific newly discovered gap instead of creating another test engine or registry.

| Required behavior | Existing source coverage | Installed round observation still required |
| --- | --- | --- |
| Editable roundtrip, projection/draft separation | `packages/design-authoring/tests/roundtrip.test.ts`; `apps/cli/src/design/sync-service.test.ts` | Manual edits survive actual Agent continuation for all three scenes |
| Dispatch flush, all-instance readonly through result processing | `apps/electron/src/main/services/design-canvas-sync-core.test.mjs`; `apps/cli/src/design/bento-readonly.test.ts` | Keep two hosts open; attempt editing during execution and processing; reopen one host mid-turn |
| Final version conflict, same-byte explicit resubmit, post-turn continue | `apps/cli/src/design/turn-outcome.test.ts`; `sync-service.test.ts`; native Pi resubmit probe | Stale final write preserves current save/draft, does not restart; explicit continuation rereads and resolves |
| Multipart writes, replaced/renamed media, missing dependencies, continuous writes, missed notifications | `apps/electron/src/main/services/design-source-preview-verification.ts`; `design-canvas-sync-core.test.mjs` | Observe actual macOS file events and explicit refresh reconciliation; no partial/old snapshot advertised as current |
| Multiple consumers, release, background with no consumers | Same source-preview verification and canvas-sync core | Close one consumer while another remains, then close all during a background turn; no extra commit or retained preview producer |
| Exact viewed source import, no sync/commit loops | Source-preview verification; `packages/components/tests/design-source-preview.test.tsx` | Change source after displaying preview; import must save the displayed snapshot or reject, never silently switch |
| No CLI, image configuration error | Existing onboarding journey; `apps/cli/src/design/image-connection.test.ts` | Without a configured external Agent, manual editing/save/export remain available. Separately inspect visible recovery wording and protected artwork while Molly's bundled daemon is stopped, then editable recovery; image calls fail explicitly without a default model or paid retry |
| Disk write failure, cancel, quit/reopen | `apps/cli/src/design/turn-outcome.test.ts`; canvas-sync core; installed P1 `design-verification.ts` | Use isolated data only; preserve edits/draft, show failure, reopen last confirmed data; do not count schema rejection as disk failure |
| Old files/receipts, actual image read, no result cards or thumbnail production | `apps/cli/src/design/candidate-file.test.ts`; `turn-outcome.test.ts`; render tool tests | Open synthetic legacy content, render and read exported pixels; compare files before/after a background turn, with no dedicated thumbnail producer |

## Measurements and acceptance limits

Reuse `collectRuntimeSnapshot` / `collectPostGcRuntimeSnapshot` in
[`resource-probe.ts`](src/support/resource-probe.ts) and the existing harness.
The acceptance-only [measurement entrypoint](scripts/measure-design-acceptance.mjs)
uses these existing facilities, seeds the three synthetic canvases, and performs
three edit/save/export/reopen iterations per scene. It records a real export
filesystem `ENOENT` after timing completes and checks that the saved design is
unchanged. This proves neither canonical-store disk-failure recovery nor the
Agent/human journey. Native save-dialog selection is simulated. Run only after
T28's harness and final package are sealed and other builds/probes have finished:

```sh
MOLLY_E2E_INSTALLED_EXECUTABLE=/path/to/Molly.app/Contents/MacOS/Molly \
MOLLY_E2E_EXPECTED_SOURCE_COMMIT=<sealed-commit> \
corepack pnpm --filter @molly/e2e exec tsx scripts/measure-design-acceptance.mjs
```

The script refuses a missing installed target/source identity and preserves
`measurements.json`, native canvas screenshots, actual exports, runtime snapshots
and trace in a fresh acceptance directory. `measured` is not human approval.
Measure elapsed monotonic time from each action to its observable completion:
attach to ready editor, edit to changed editor snapshot, save to persisted revision,
PNG/JPEG export to decoded file, and reopen to matching saved content. Do not time
builds, model/network latency or a fixed sleep as editor performance. The current `coldAttach` field measures a new canvas view in an already running
application; application cold startup is not measured. Keep every sample, dimensions, element and
asset counts, byte sizes, and success/error status, rather than only averages.

Capture memory after bootstrap, loaded scene, edits, saves, each export, and closed
scene. Report main RSS, renderer heap and process-tree RSS separately; summing
Electron's overlapping metrics double counts memory. Include canvas-view renderer
processes in process-tree evidence: the shell page's CDP heap alone omits Bento.
Use the same idle/GC checkpoint semantics for before/after comparisons and describe
that forced GC differs from normal use. Soak growth remains the separate Scout
lane; a handful of acceptance samples cannot prove absence of leaks.

Choose acceptable ranges from the target machine's measured distributions and
reviewer's interaction tolerance. No universal latency or memory limit has been
established. The original nine-sample round remains measured evidence. The later real-image
workload has six accepted human checks and a bounded recommendation;
the user subsequently accepted all three human scene journeys. Preserve the
unfilled per-step fields rather than inventing observations or requiring the same
overall verdict again. The newly reported intermediate-preview bug has separate
regression work. Do not report
zero, a guessed budget or “fast”. Retain
slow and failed samples. A scope recommendation must state hardware, scene sizes,
sample count, worst observed values and remaining limits. Export quality and edit
usability require human review even when every timing fits the selected range.

## Release decision

The release remains pending until this round is complete. A local-only installed
matrix records runtime identities and scoped evidence for all five Agents, including
switching and recovery. The current contract uses automatic PPTD saves and public
read-before-edit reminders. Pi's installed public extension now exposes Molly's
image MCP; the older adapter-catalog limitation is historical. Codex, Kimi and
Grok have scoped installed reminder/current-file/collector evidence. Kimi's
actual-user plugin registration remains unexecuted; isolated-home acceptance is
not an installation for the user. Retain the matrix's failed fixture rounds and
unexecuted assertions rather than restoring retired generation-proof blockers or
claiming full design support from ordinary Agent availability.
Windows/Linux cross-host resource collection does not establish native usability.

The installed app in this round is locally ad-hoc signed only. This procedure
neither authorizes nor performs public release, Developer ID signing, notarization,
update-feed changes or publication. The public README describes usable workflows
and limitations; this document records how their evidence must be established.

For cancellation followed by a complete application restart, `ElectronHarness.restart()`
retains its own profile and artwork only after the same process and endpoint checks
as final teardown pass. It uses the original executable/source target and a freshly
reserved endpoint. The subsequent `close()` removes the isolated directories.
A teardown error aborts restart; closing and reopening a Session inside one running
application is separate evidence.


## Local human review handoff

The prepared local directory `e2e/artifacts/acceptance/t29-b86-human-review`
contains `开始验收.md`, `Open Geon Review.command`, three actual editable Session
sources and matching PNG/JPEG exports, package identity, measurements and the
copied-profile verification. Its launcher uses the independent short profile
`~/GeonReview-b86-20260911`, a fresh endpoint and the original b86
installed executable. All three Sessions were mechanically reopened, compared,
saved and source-previewed from that new root after the original temporary data
was removed. This does not sign the human fields above. Keep the app and profile
paths stable; no external provider credentials are supplied. A human configures
an authorized Agent connection to perform their own complete creative journey.
