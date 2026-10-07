# Design quality regression eval

Status: proposed
Translation: pending

## Abstract

Molly has no repeatable way to tell whether a new version designs better or worse
than the last one. The existing e2e lanes verify product mechanics with a scripted
model and cannot judge layout. This note proposes a small, owner-judged eval: each
case fixes an input, a prompt and a hidden list of known defects. Each Molly
version runs every case three times, and the owner compares the outputs blind
against the last accepted version. Real-brand cases stay in a gitignored local
directory; the repository tracks only synthetic twins. A runner, a gate checker
and one synthetic twin case now exist; no automatic layout metric is claimed to
predict human judgment.

## Problem

The first observed case is a real coffee-brand endorsement poster (kept private).
Its source has obvious composition problems: the person fills most of the frame
and the headline crowds her face. Given an open-ended "redesign this poster"
prompt plus preservation constraints, one run met the hard constraints (size,
colour, preserved face and product pixels). Its saved design shows the portrait
layer still spans the full canvas at its original position, so the subject was
not resized. The headline column still overlaps the hair line, yet the final
summary claimed a restrained redesign. The brand wordmark and signature are
upscaled crops from the source with visible artefacts. No current check would
flag any of this.

Correction: an earlier reading of the app screenshot said the fine print was
clipped. The full-resolution render shows it complete; the canvas toolbar was
covering it.

## Decisions taken with the owner (2026-10-06)

- Purpose: regression between Molly versions, not comparison with other products.
- Judge: the owner alone. Agent or VLM review may triage but stays advisory, per
  the root rule that human judgment establishes visual quality.
- Privacy: real-world cases (real people, real brands, screenshots from social
  platforms) live in the gitignored `e2e/design-eval/private/` directory. Public
  synthetic twins use a fictional brand and person and reproduce the same
  deliberate defects.
- Runner: an isolated desktop launched through the e2e harness, configured with
  an OpenAI-compatible local endpoint for both the Agent model and the image
  model. Endpoints and keys live in the gitignored `private/connection.json`;
  the owner chose the models.
- First case: open redesign, targeted composition fix and a 1080×1920 resize,
  plus a copy-edit follow-up on the redesign. A synthetic twin is approved.

## Reuse ladder

- Existing synthetic design fixtures (`e2e/fixtures/design/{poster,infographic,long-image}`)
  are reused as the input format for layered public cases. Flat-raster cases
  need only a source image.
- The [acceptance lane](../../../../e2e/README.md) (explicit local run, immutable
  before/after evidence, human reviewer) is the pattern to borrow. It is not
  reused directly because it produces evidence for one delivery, not a fixed
  case set compared across versions.
- The [Kimi golden replication runner](../../../../e2e/KIMI-REPLICATION-ACCEPTANCE.md)
  is the closest existing code: a frozen private reference checked by SHA-256, a
  verbatim prompt, exclusive round directories, recorded source commit and build
  hashes, and no automatic paid retries. Its pattern is borrowed. The code is not
  reused as is, because it is bound to one Kimi case and its isolated profile has
  no model or image credentials.
- The scripted model server is rejected for scoring. It makes runs deterministic,
  so it cannot measure the model-and-skill behaviour this eval exists to catch.
- The existing final-commit checks (schema, kernel replay, assets, versions) are
  reused as the first gate rather than re-implemented.
- Custom work remaining: a case manifest, a runner that records outputs per
  version, and a blind pairwise review sheet.

## Case manifest

Cases are JSON, because the e2e workspace has no YAML parser and the format
needs no comments. The shape:

```yaml
id: string
input:
  type: flat-raster | layered | brief-only
  source: media/source.png # or a design.pptd directory
prompt: string # verbatim user message
followUps: [string] # optional later turns, run in the same session
gate: # automatic pass/fail, read from BentoDoc
  canvas: [width, height]
  requiredText: [string] # must exist as text elements, exact match
  textInsideCanvas: true
knownDefects: [string] # hidden from the Agent; read by the judge
preserve: [string] # regions the judge must confirm unchanged
```

`knownDefects` is the key field. Open-ended prompts rarely name the real problem,
so the case records what an expert would fix unprompted.

## Run and scoring

1. Run each case three times on the candidate version. Record version, model,
   duration, image calls, tool errors and the final summary text.
2. Gate: final-commit checks, canvas size, required text as text elements, text
   bounds inside the canvas. A failure on any run is a regression.
3. Blind pairwise review against the stored outputs of the last accepted version.
   Side order is randomised and version labels are hidden. For each pair the
   owner marks better, same or worse on composition, hierarchy, brand accuracy
   and finish, and ticks which known defects were fixed and whether preserved
   regions survived.
4. Summary honesty: the owner marks whether the final summary matches the visible
   change.
5. A case regresses when the majority of its pairs are worse on any dimension.
   Accepted outputs become the next baseline, so a baseline is never re-run.

Automatic layout metrics (subject area ratio, text-to-subject gap, contrast) are
deferred. They are worth building only once the owner's verdicts show which ones
track real judgment.

## Cost

One candidate pass runs every case three times, and most cases call image
generation or editing. That exceeds the default five-call budget, so each eval
pass needs an explicit budget approval stating the case count and expected calls.

## Starter matrix

Target 10–15 cases across task (open redesign, targeted fix, resize, copy edit,
brief to design), input (flat raster, layered, brief only) and genre (person and
product poster, typography-led, e-commerce main image, infographic, long image,
menu). Several prompts may share one source. For example, the first private case
yields an open redesign, a targeted composition fix, a 1080×1920 resize and a
copy-edit follow-up.

## Implementation

The [eval README](../../../../e2e/design-eval/README.md) owns the layout and the
run command. `run-design-eval.mjs` launches the harness, saves the model and
image connections through the same renderer calls the Settings screen uses,
selects the model and reasoning in the composer, attaches the source, sends the
prompt and follow-ups, and waits for the Stop button to disappear and a commit
receipt to appear for each turn. It records the committed design, an exported
PNG, the artwork directory and the visible conversation. `design-eval-gate.mjs`
is a pure check over the committed design and has a unit test.

`design-eval-review.mjs` serves a local review page. Pairwise mode fixes a
random A/B placement in a key file before the owner sees anything; single-label
mode lets the owner accept a first baseline. Verdicts save as each choice is made,
and scoring un-blinds them and applies the majority-worse rule.

Runs may execute in parallel. The e2e rule to run scenarios serially exists for
OS endpoints that are still fixed. On macOS each harness owns its data directory,
the IPC sockets inside it and a random CLI port, and E2E skips the single-instance
lock. Windows daemon pipes are still named per user, so parallel eval runs stay
macOS-only.

The synthetic twin `bright-hare-holiday` uses one generated photo of an invented
person and brand. A script lays out the copy so the defects are deliberate and
reproducible rather than left to the image model.

## Trial evidence (2026-10-06)

Three trial runs of the synthetic twin's redesign case used `gpt-6-luna` with
high reasoning and `gpt-image-2.5-sunburst`, on a desktop built from
`a93b3838`. Run 1 was stopped by the operator during its first turn and carries
no evidence. Run 2 committed after about 20 minutes. It kept the source raster as
the background, covered the old headline with a new panel and typeset only the
headline and credit, so four product strings stayed baked into pixels and the
gate failed. The runner then could not find the session composer; that selector
is now fixed. Run 3 committed both turns (about 21 and 12 minutes), rebuilt the
copy as editable text, removed the watermark and passed the gate. The follow-up
changed only the requested headline. Its only failure was the final conversation
capture, now fixed. Neither run resized the subject, the main known defect.
The large difference between runs 2 and 3 supports running each case three
times.

## First baseline attempt (2026-10-06)

The first baseline ran six cases three times on six parallel desktops, then
re-ran the failures four at a time. Of 26 runs, 13 produced a valid result. The
rest ended without one: the Agent stopped with `pi_acp_host_execution_failed`
after 0 to 35 minutes, or was still working at the 45-minute limit. The local
endpoint's own error log shows the upstream provider returning
`server_is_overloaded` at the time of the first group of failures; later failures
left no entry there, and the Pi session records were deleted before they could be
read. The runner now keeps the CLI backlog, logs and, on failure, the Pi session
records, and it treats a visible Agent internal error as a failed run rather than
an output. The review tool skips such runs, so an infrastructure failure is never
judged as a design. The twin's redesign case produced no valid run under parallel
load, although it completed twice when run alone during the trial, so parallelism
is not yet proven safe for long turns.

Among the valid runs, most outputs for the private case were a single flattened
image with no editable copy; the gate flags them, and whether that trade is
acceptable is for the owner's review.

## Two-worker backfill (2026-10-06)

The owner selected two concurrent desktops and `deepseek-flash` through the same
local model endpoint. Reasoning remains high, and the image model remains
`gpt-image-2.5-sunburst`. A real source-image/tool-call connection check succeeded.
The desktop main, bundled CLI and design build hashes match the earlier baseline;
the application was not rebuilt for the model change.

The existing runner is reused without implementation changes: `--runs 1` and
repeated `--case` arguments schedule three synthetic redesign attempts, one
synthetic resize and one private redesign. These are the five missing outputs
needed to reach three per case, rather than rerunning completed gate failures.
The private connection file changes only the Agent model ID; endpoint, key and
image configuration are preserved. Earlier successes and failures are retained.

The backfill has its own label, `main-a93b3838-deepseek-flash-fill`. It is a
different model cohort, so combining its outputs with the earlier label would
not establish a version baseline with fixed model settings. Each queued attempt
runs once; a new failure is retained without automatic requeue.

All five attempts completed and passed the design gate, with no execution or
teardown errors in this batch:

| Case               | New complete outputs | Gate passed |
| ------------------ | -------------------- | ----------- |
| Synthetic redesign | 3                    | 3           |
| Synthetic 9:16     | 1                    | 1           |
| Private redesign   | 1                    | 1           |

Initial turns took 537–2108 seconds, and copy-edit follow-ups took 64–106 seconds.
Saved PNGs have the requested dimensions (1126×1500 or 1080×1920), prompts and
source-image hashes are unchanged, and every follow-up changed only the requested
headline in BentoDoc. Commit receipts, designs and exports are retained. The
private connection was checked against its saved predecessor: only the Agent
model ID changed. The review tool loads all five outputs under the new label.

The earlier 13 complete outputs and all failed attempts remain, yielding 18
reviewable outputs across the two model cohorts. Visual quality and baseline
acceptance still require the owner. This small batch does not establish a general
concurrency limit or attribute the earlier failures to load alone, because the
Agent model also changed. Filesystem access remains a limit on independent model
evaluation, described below.

## Website preparation revision (2026-10-06)

The earlier runner delivered the graphic-design research rule in all 18 complete
outputs, but never imported a website account or verified accessible references.
One result explicitly reported a Pinterest login overlay blocking external visual
research. Development browser accounts are memory-only, and every run owns a new
profile, so a login in the owner's everyday desktop cannot prepare these runs.

The owner requested an import before every test, three parallel redesign attempts
with `gpt-6-luna` / high, and no other task variants. The runner reuses the existing
Website accounts import IPC, native browser and isolated harness. Copying an
existing profile is insufficient for development's memory-only Cookie partition;
another credential store or reader is unnecessary. Account import and website
verification run serially before each worker's paid turn. Preparation failures
start no design turn and are retained without automatic retries.

Website readiness requires signed-in controls, loaded Pin images on a design
search page and no login overlay, with private screenshot evidence. The restored
Chrome-access probe reached the business hub; its avatar exposed a false positive
in the initial broad image check. Preparation now opens a design search and counts
only Pin-card images, including the observed business-account header and card
structure. It does not establish that the
Agent used those references; retained private native sessions support a separate
research audit. `--first-turn-only` omits later copy-edit prompts while preserving
the case's original first prompt. The new batch uses a separate label because its
preparation differs from earlier results. The first preparation probe could not
list Chrome profiles because the launching application's browser-data access was
denied. After the owner enabled access for Lody Nightly, native preparation
imported six cookies and showed a signed-in search page with two visible Pins.
Each of the three fresh batch instances independently passed this check before
starting its one design turn.

The three design turns overlapped and completed on the same recorded application
build as the earlier cohorts. The existing CPA provider and image configuration
were preserved. Native session metadata confirms `gpt-6-luna` and high reasoning
in every run. All three turns committed a 1126 × 1500 artwork and exported a PNG;
there were no execution or teardown errors and no additional follow-up turns.

| Run | First-turn duration | Editable text nodes | Gate result                  | External visual research evidence  |
| --- | ------------------- | ------------------- | ---------------------------- | ---------------------------------- |
| 1   | 673 seconds         | 5                   | Failed: 5 required texts     | Not observed                       |
| 2   | 688 seconds         | 0                   | Failed: all 7 required texts | Not observed                       |
| 3   | 1253 seconds        | 7                   | Failed: 4 required texts     | Pinterest search-result screenshot |

The research audit matched actual browser calls to their native tool results.
Only run 3 returned a browser screenshot image to the Agent; it navigated to a
search page, without an observed individual-Pin navigation. Runs 1 and 2 contain
no observed external visual research. Website preparation therefore fixes
environment readiness but does not establish Agent compliance with the research
rule. Run 2 made one image-edit call; no image operation was observed in runs 1
and 3. Automatic gate failures concern missing editable copy, including words
retained only as pixels, rather than authentication or transport failures.

The Chinese review page contains all three completed outputs and their failed
gate details. Historical outputs and review verdicts were preserved, yielding
21 reviewable outputs across the earlier cohorts and this separately prepared
batch. These three outputs do not establish an accepted baseline; owner review
remains pending.

Eight synthetic browser-preparation tests and the seven existing gate/review
tests pass. `pnpm e2e:check` passed its suite contract, TypeScript checks and 61
tests. Scoped lint, syntax, formatting and documentation checks pass.
The read-only Codex CLI opinion (`gpt-6-astra`, high) found no P0/P1 in the scoped
orchestration change and explicitly left native Pinterest selectors, image
visibility, imported login behavior and three-instance execution unverified.
The opinion's additional nested review could not initialize in its read-only
environment and supplied no findings. No permission bypass or automatic retry
was used. The native probes addressed website-access assumptions separately;
the model turns started only after successful per-instance preparation.

## Kimi model repeat (2026-10-06)

The owner requested the same three parallel, first-turn-only redesign attempts
with `kimi-k3` / max. The CPA model list includes this exact model ID. The provider,
image configuration, browser source, prompt, artwork gate and built application
are preserved; this repeat has a separate result label and leaves earlier outputs
and review verdicts intact.

The runner previously declared only off/low/medium/high in its custom model
metadata. It now declares off and the owner's requested level, reusing the existing
model schema and picker rather than adding a selection mechanism or downgrading
max. The schema already admits max, and the existing compatible-provider adapter
maps declared thinking levels literally. The declaration is not remote capability
verification; live execution and native records establish acceptance and the
actual selected level. All three instances passed website preparation before
their design prompt, and native records confirm `kimi-k3` / max with successful
assistant tool-call responses. Each fresh instance imported six cookies and
verified signed-in controls, two visible Pins and no login overlay. Native prompt
timestamps follow website verification in every instance; all three design turns
overlapped.

| Run | First-turn duration | Final execution        | Gate result | External visual research evidence  |
| --- | ------------------- | ---------------------- | ----------- | ---------------------------------- |
| 1   | 45-minute limit     | Timed out, no export   | Not run     | Not observed                       |
| 2   | 1116 seconds        | Committed and exported | Passed      | Pinterest search-result screenshot |
| 3   | 45-minute limit     | Timed out, no export   | Not run     | Not observed                       |

Run 2 committed a 1126 × 1500 artwork with 12 editable text nodes and exported its
PNG. Runs 1 and 3 still had an active Agent turn at the unchanged 45-minute limit;
their last native assistant records have `toolUse`, without a completed turn or
formal export. These are execution timeouts, not failed copy gates. There were no
teardown errors. The three requested first-turn attempts were the entire batch;
no follow-up or replacement design turn was scheduled.

The research audit counts actual native operations, including nested calls in
their returned envelopes. Only run 2 navigated to Pinterest search results and
returned a screenshot image to the Agent; no individual-Pin navigation was
observed. Runs 1 and 3 made no observed browser call. The browser import therefore
establishes readiness, while actual research remains separately observed. Image
operations all returned successfully: one generation in each timed-out run, and
three generations plus two edits in run 2, totaling five generations and two
edits. Advisory render-preview counts were five, one and two respectively; these
previews do not establish completion.

The runner retained native sessions, CLI backlog, logs and desktop screenshots
for all attempts. Before timeout teardown, separate private diagnostic copies
retained the two active workdirs at approximately 42 minutes. They are live,
potentially inconsistent copies, not final committed designs or review outputs.
The Chinese review page includes the one completed output, with image loading
and zoom verified and no human verdict written by verification. Earlier outputs
and verdicts remain intact, yielding 22 reviewable outputs across the recorded
cohorts. The owner subsequently completed the review and accepted run 2, marking
all five known defects corrected, protected regions preserved and the final
summary honest. Typography remains an owner-identified improvement: the use of
system fonts looks rigid. The saved verdict is the authority; the existing score
command reports one of one reviewed and accepted. The run's owner-review state
now records acceptance, and the batch links the verdict and summary while
preserving its two execution timeouts.

This accepted output is a reference for the same case and recorded model settings.
It is one sample, not a complete three-output version baseline. Approval covers
the completed artwork, not the timed-out attempts or the whole proposed eval
strategy. No design repair or replacement turn follows from this review.
This three-attempt repeat does not establish general model quality or attribute
timeouts to a provider fault.

The 15 focused browser-preparation, gate and review tests pass. Scoped syntax,
lint, formatting and documentation checks pass. The built application remains
the same recorded artifact as the earlier cohorts; this model change does not
constitute a fixed-model application regression comparison.

## Open questions and limits

- Earlier cohorts' image calls are not counted yet; retained private execution
  records support a later audit. The prepared Luna and Kimi batches' calls are
  counted above.
- The isolated profile does not restrict the Agent's filesystem access. During
  the two-worker backfill, a task read a previous run's preview from the
  repository. Case rubrics are omitted from the prompt but their files and old
  outputs remain reachable. These outputs can be reviewed, but this is a limit
  on independent, uncontaminated model evaluation; profile isolation alone does
  not establish that property.
- The imported baseline run did not record its exact build or image-call count.
- A single judge brings consistent but personal taste. That is accepted for a
  regression signal, but it does not establish general design quality.
