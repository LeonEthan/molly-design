# Agent workflow baseline (#199)

Status: proposed
Translation: pending
Issue: [#199](https://github.com/LeonEthan/molly-design/issues/199)
Measured: `10f7f771` (current `main`), 2026-10-20
Model: `deepseek-flash`, reasoning `high`

## Abstract

Molly's design agent was measured end to end on current `main` before any skill
change, using three synthetic tasks: a poster from a brief, a bounded text edit
to an existing artwork, and a reconstruction from a reference image. The bounded
edit completed in 20 seconds and the reconstruction in 7.6 minutes, but the
brief-only poster did not complete within a 40-minute cap and first produced a
valid `design.yaml` only after 21.2 minutes. The brief spent most of that time in
browser research and option work before writing any artwork. This is one run per
case, so it fixes the task set and measurement recipe for the skill split; it
does not establish variance or visual quality.

## Problem

Issue #199 asks for two related changes: decentralize the agent skills and speed
up the workflow. Without a baseline, neither change can be compared against the
current behaviour. This note records the timing, tool-call, and skill-read cost
of three representative design tasks on the unmodified product.

## Method

Each case used a real Electron Molly desktop built from `10f7f771`, launched by
the existing E2E harness with `MOLLY_E2E=1` and an owned random CLI host port,
so it never attached to the running Lody instance on port 17790. The Agent used
the local OpenAI-compatible proxy with `deepseek-flash` and `high` reasoning;
the image model was `gpt-image-2.5-sunburst`. No product code was changed.

A turn counts as completed only when the app produced a `committed` design-turn
receipt for the prompt. `First valid design.yaml` is the first moment a
`molly-canvas/1` project in the session workspace passed
`@molly/design-authoring` validation after the prompt, reconstructed from the
first schema-valid write when the live watcher could not observe it. `First
molly_render_preview` is the first preview invocation, including invocations
nested inside `codemode`. `Total wall time` runs from prompt send to the
committed receipt, or to the 40-minute cap. Tool calls and skill reads come from
the Pi session JSONL for that prompt; nested preview calls are counted
separately because `codemode` is their top-level tool.

## Results

| Case                        | Turn completed                 | First valid `design.yaml` | First `molly_render_preview` | Total wall time | Top-level tool calls | Skill/reference files | Bytes read |
| --------------------------- | ------------------------------ | ------------------------: | ---------------------------: | --------------: | -------------------: | --------------------: | ---------: |
| A. Poster from a brief      | No, still active at 40-min cap |                 1,271.5 s |                    1,294.8 s |       2,401.0 s |                  105 |                     5 |     55,263 |
| B. Bounded text edit        | Yes                            |                    11.3 s |                       12.3 s |          20.1 s |                    8 |                     1 |     24,052 |
| C. Reference reconstruction | Yes                            |                   325.0 s |                      330.5 s |         458.1 s |                   84 |                     3 |     38,240 |

Tool calls by name:

| Case | `read` | `bash` | `codemode` | `write` | `edit` | `molly_render_preview` | Image-model calls |
| ---- | -----: | -----: | ---------: | ------: | -----: | ---------------------: | ----------------: |
| A    |     23 |     30 |         48 |       1 |      3 |  0 top-level, 7 nested |                 3 |
| B    |      4 |      2 |          0 |       0 |      1 |                      1 |                 0 |
| C    |     22 |     55 |          0 |       1 |      1 |                      5 |                 0 |

Files read from `.claude/skills/` in each measured turn:

- A: `graphic-design/SKILL.md` 24,052 B; `graphic-design/references/browser-research.md`
  5,035 B; `imagegen/SKILL.md` 9,940 B;
  `graphic-design/references/artwork-format.md` 10,571 B;
  `graphic-design/references/general-poster.md` 5,665 B.
- B: `graphic-design/SKILL.md` 24,052 B.
- C: `graphic-design/SKILL.md` 24,052 B;
  `graphic-design/references/replication.md` 3,617 B;
  `graphic-design/references/artwork-format.md` 10,571 B.

## Cases

All inputs are synthetic; no captured transcript is stored in this repository.

### A. Poster from a brief

No attachment. The public Molly browser was opened at
`https://www.typographicposters.com/` before the prompt. Prompt:

> Design a poster for a fictional late-night jazz series called 'Blue Hour
> Sessions' at the fictional Lantern Room. Format: 1080 × 1350 px, for a venue
> wall and Instagram. Audience: local music fans. The one message: intimate live
> jazz every Thursday at 9pm. Research poster inspiration in the open Molly
> browser (typographicposters.com) and inspect individual poster images. You
> choose the strongest direction and finish the editable design in this turn; do
> not stop to ask me to choose between options. Make no more than three
> image-model calls in total.

The turn generated three image options, inspected them, then wrote the YAML.
It was still rendering and reviewing previews when the 40-minute cap ended, so
no commit receipt exists. The last recorded action was 13 seconds before the cap.

### B. Bounded text edit

The session first received a one-sentence `Hello` turn to create the design
session; that warm-up turn is not measured. The workspace was then seeded with a
640 × 800 `molly-canvas/1` project containing a masthead, the headline
`Studio hours`, the details line `Saturday 9–2 · Riverside Square`, and a
swatch image. Prompt:

> Small text edit to the current artwork: change the headline 'Studio hours' to
> 'Studio closed' and change the details line 'Saturday 9–2 · Riverside Square'
> to 'Closed for the season'. Keep every other element, position, and size
> unchanged. Do not redesign and do not research.

The committed design contains exactly those two text changes; the other elements
are unchanged.

### C. Reference reconstruction

The attachment was a synthetic 1080 × 1350 reference poster with a dark teal
background, a cream sun disc, the words `BLUE`, `HOUR`, `SESSIONS`, `LIVE JAZZ`,
`EVERY THURSDAY 9PM`, and `THE LANTERN ROOM`. Prompt:

> Reconstruct the attached reference poster as an editable Molly design at
> exactly 1080 × 1350 px. This is a prescribed reconstruction: do not do external
> research and do not offer alternative options. Preserve the composition,
> colors, and copy as closely as possible. Use native shapes and text; do not call
> the image model.

The committed design uses native shapes and text plus two local Arial font files.
Most of its 55 `bash` calls came from pixel and font measurement before the first
YAML write; its five preview calls came after it.

## Reproduction

1. Build once from the measured commit:
   `corepack pnpm --dir apps/electron build`.
2. Provide an OpenAI-compatible endpoint that exposes `deepseek-flash` and an
   image model. The local proxy used here was `http://127.0.0.1:8317/v1` with
   reasoning `high`; credentials stay machine-local and are never committed.
3. Launch the built desktop through the existing E2E harness
   (`e2e/src/support/electron-harness.ts`). The harness owns
   `MOLLY_E2E=1`, `MOLLY_E2E_LOCAL_CLI_HOST_PORT`, the data directory, and the
   Electron profile. Do not reuse the user's Molly or Lody process.
4. Save the model and image connections through the app's real
   `modelConnections.save` / `saveImage` IPC, and select `deepseek-flash` with
   `high` reasoning in the composer.
5. For A, create a public browser page and navigate it to the research site
   before sending the prompt. For B, send the warm-up `Hello`, then overwrite
   `design.yaml` and `media/` in `<dataRoot>/chats/<artworkId>` with the seed
   project before the measured prompt. For C, attach the synthetic reference
   image to the first prompt.
6. Send the prompt, then wait for the Stop button to disappear and for a
   `committed` receipt under `<dataRoot>/chats/<artworkId>/design-input/<turnId>/`.
   Cap the turn at 40 minutes; do not retry a paid image call automatically.
7. Read tool calls and timestamps from the Pi session JSONL under
   `<dataRoot>/harness/pi/sessions`, and validate `design.yaml` with
   `validate(entry, { projectRoot })` from `@molly/design-authoring`. Resolve
   `read` paths that point at the temporary workdir against the retained
   workspace copy, then sum unique `.claude/skills/` files.

The existing design-quality eval (`e2e/design-eval/README.md`) on
`test/design-quality-eval` already owns the desktop launch, connection setup,
prompt sending, and committed-receipt checks; it is the closest reusable runner.
The three case manifests above can be added to that lane without product changes.
The measurement harness used for this note is retained locally under
`e2e/artifacts/baseline-199/` and is not committed.

## Observations and blockers

- The brief case never committed within the cap. It was still reviewing a
  preview at 39 minutes 48 seconds. This is the main blocker for using it as a
  completed baseline; a longer cap may complete, but that would not change the
  finding that the first useful artwork took over 21 minutes.
- Browser research dominated the brief case: 48 `codemode` calls, 30 `bash`
  calls, and 7 nested preview calls before the first YAML. One sitemap probe ran
  as a single `bash` call for roughly 6.5 minutes and returned only a few
  candidate image URLs.
- The reference case read only the reconstruction path and still spent
  5.4 minutes before its first YAML, mostly in pixel and font measurement.
- The bounded edit read one skill file and needed one preview. Skill load alone
  therefore does not explain the brief and reconstruction times; the task branch
  and research/measurement flow do.
- Every case read the 24 KB `graphic-design/SKILL.md`. The brief read 55 KB of
  skill material, the reference 38 KB, and the edit 24 KB. This is the
  centralization the skill split should reduce.
- Limits: one run per case; one machine and local proxy; a live public website
  that can change; no human judgment of the resulting artwork. The timeouts and
  tool counts describe this sample, not a distribution.

## After (PR #219, 52a21ffd)

Status: proposed
Measured: `52a21ffd` (PR #219 head, skill split), 2026-10-20
Model: `deepseek-flash`, reasoning `high`
Runs: case A twice, case C twice, two isolated desktops in parallel; case B was
not rerun per the owner's instruction.

The owner's 20-minute rule is applied here: any run longer than 20 minutes is a
failure regardless of whether it eventually commits. Every case used the same
prompts, synthetic fixtures, local proxy, image model, public research site and
40-minute harness cap as the baseline.

| Case / run             | 20-min rule | Completed               | First valid `design.yaml` | First `molly_render_preview` | Total wall time | Tool calls | Longest single tool call | Skill/ref files |  Bytes | Preview iterations |
| ---------------------- | ----------- | ----------------------- | ------------------------: | ---------------------------: | --------------: | ---------: | ------------------------ | --------------: | -----: | -----------------: |
| A baseline (`10f7f77`) | Fail        | No, active at cap       |                 1,271.5 s |                    1,294.8 s |       2,401.0 s |        105 | `bash` 389.8 s           |               6 | 56,392 |                  7 |
| A after run 1          | Fail        | No, stopped at 25.1 min |                      none |                         none |       1,504.2 s |         45 | `codemode` 9.5 s         |               6 | 53,288 |                  0 |
| A after run 2          | Fail        | No, stopped at 23.7 min |                      none |                         none |       1,421.1 s |         51 | `codemode` 22.1 s        |               9 | 52,059 |                  0 |
| B baseline             | Pass        | Yes                     |                    11.3 s |                       12.3 s |          20.1 s |          8 | preview 2.2 s            |               1 | 24,052 |                  1 |
| C baseline             | Pass        | Yes                     |                   325.0 s |                      330.5 s |         458.1 s |         84 | `bash` 33.9 s            |               5 | 39,945 |                  5 |
| C after run 1          | Pass        | Yes                     |                   152.4 s |                      153.9 s |         315.4 s |         68 | preview 3.7 s            |               8 | 35,374 |                  3 |
| C after run 2          | Pass        | Yes                     |                   422.2 s |                      424.0 s |         664.2 s |         89 | `bash` 272.8 s           |               8 | 35,374 |                  6 |

Baseline skill-file counts in this table were re-extracted with the same
read-tool plus `cat`/`sed` extractor used for the after runs; the first baseline
table above counted only the `read` tool, which is why its A row differs. Helper
`scripts/` files are excluded from both sides; partial-file reads count the whole
file.

### Side-by-side

| Case                      | Baseline `10f7f77`              | After `52a21ffd`                                      | Change                                                                            |
| ------------------------- | ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| A                         | No preview by 40 min; no commit | No preview by 25.1 / 23.7 min; no commit              | Still unacceptable; research still consumed the whole budget                      |
| A research before options | about 14.6 min                  | 22.5 min (run 2) or never (run 1)                     | Worse                                                                             |
| C total                   | 458.1 s                         | 315.4 s / 664.2 s                                     | 31% faster / 45% slower; variance dominates                                       |
| C first preview           | 330.5 s                         | 153.9 s / 424.0 s                                     | 53% faster / 28% slower                                                           |
| C tool calls              | 84                              | 68 / 89                                               | 19% fewer / 6% more                                                               |
| C skill bytes             | 39,945                          | 35,374                                                | 11% fewer bytes, but 8 files across 3 directories instead of 5 files in 1         |
| C skill directories       | `graphic-design` only           | `graphic-design`, `design-replication`, `design-text` | Siblings loaded only on the reconstruction path; `design-research` was not loaded |
| C 20-min rule             | Pass                            | Pass / Pass                                           | Both completed under 20 min                                                       |

Case C's after mean total is 489.8 s versus 458.1 s baseline, and its after mean
first preview is 289.0 s versus 330.5 s. With two samples, the direction is not
established; the 272.8 s `find /` call in C run 2 alone accounts for most of that
run's regression.

### Case A time breakdown

The retained partials were identified from their session start times and artwork
ids: run 1 is `ce45e1a0` (started 05:14:08.561Z) and run 2 is `32cf201a`
(started 05:14:10.158Z); the owner copied their data roots before stopping them.

| A run       | Research / preparation |                       Options | Layer / compose |      Review |      Total |
| ----------- | ---------------------: | ----------------------------: | --------------: | ----------: | ---------: |
| Baseline    |             0–14.6 min | 14.6–17.6 min (3 image calls) |   17.6–21.2 min | 21.6–40 min | 40 min cap |
| After run 1 |             0–25.1 min |                             0 |               0 |           0 |   25.1 min |
| After run 2 |             0–22.5 min |  22.5–23.7 min (1 image call) |               0 |           0 |   23.7 min |

Past 20 minutes, after run 1 was still researching: it read a downloaded
reference at 20.4 min, checked the browser for a login overlay at 22.3 min, and
navigated to the site archive at 25.0 min. After run 2 grepped the format helper
at 21.5 min, started its first image option at 22.5 min (a 22.1 s call), and was
reading the generated image when stopped at 23.7 min. Neither run reached
`design.yaml` or a preview.

### Case A stop investigation

The baseline skipped the option-choice stop; neither after run reached it. The
decisive input is the synthetic prompt itself: it says "You choose the strongest
direction and finish the editable design in this turn; do not stop to ask me to
choose between options."

- Baseline: 105 tool calls, none named `ask_user_question`; the Agent generated
  three image options, selected one, wrote `design.yaml` at 21.2 min and
  continued into review. Its reasoning cites the prompt's "You choose ... do not
  stop" sentence and plans to create options and continue. No question reached
  the harness.
- After run 1: 45 tool calls (2 `read`, 8 `bash`, 35 `codemode`), no
  `ask_user_question`, no options, no stop point reached.
- After run 2: 51 tool calls (3 `read`, 17 `bash`, 31 `codemode`), no
  `ask_user_question`; one image option at 22.5 min, no stop point reached.

No question was emitted, so the harness auto-answer or missing-responder path
was not exercised. The baseline stop was overridden by the prompt, not by the
harness.

### Pass thresholds

- A: both after runs fail. No run reached a preview under 8 minutes, and neither
  ended at an option-choice point.
- C: run 1 reached first preview at 2.57 min (pass) but used 68 tool calls (fail
  against <50). Run 2 reached first preview at 7.07 min and used 89 tool calls,
  so it fails both. Neither run meets both thresholds.

### Recommendations, ranked by expected time saved

1. Put a hard time and call budget in `design-research` (for example one focused
   pass, a few minutes, no recursive sitemap or `curl` loops). Both A after runs
   spent 22–25 minutes before the first design artifact. Expected saving on A:
   8–12 minutes; this can bring A under 20 minutes but not necessarily under 8.
2. Add a choose-one fast path to the core skill: when the prompt says "you
   choose" or "do not stop", generate one option instead of three, or skip the
   option round when the brief is already concrete. Baseline options took about
   3 minutes and three image calls; after run 2 spent 1.2 minutes before stop.
   Expected saving: 2–4 minutes and two paid image calls.
3. Remove filesystem-wide font searches from the replication/text path and give
   the Agent a font inventory (app-side or a skill helper). C run 2 lost 272.8 s
   to one `find /` command. Expected saving: up to 4.5 minutes on that path.
4. Ship a small measurement helper for the common crop, bounding-box, contrast
   and text-fit checks in `design-replication`. C used 47–60 `bash` calls per run,
   mostly pixel measurement. Expected saving: 2–3 minutes per reconstruction.
5. Surface elapsed turn time and a soft research budget to the Agent
   (app-side). It cannot currently see that it has crossed 20 minutes; a visible
   budget would let it stop researching and produce a first preview. Expected
   saving: prevents 20-minute failures rather than making the same work faster.
6. For eval only, add an option-choice responder to the harness so the
   "offer options and stop" branch can be measured without a prompt that says
   "you choose". This does not change product speed, but it would separate the
   skill's default branch from the prompt override.

### Limits

Two runs per case, two desktops in parallel, one machine, one local proxy, one
live public research site; the two A runs were stopped at 25.1 and 23.7 minutes
by the owner and never reached a design artifact. C run 2's 272.8 s `find /`
call is a single-command outlier. These numbers show direction and failure
modes, not a stable distribution, and no human review of the resulting artwork
was performed.

## Round 4 (perf/browser-screenshot-199, 813a75c1)

After the after-run above, the cause of the slow A runs was isolated: model
latency grew with image bytes in each request (browser screenshots returned as
2000 px PNGs, render previews read as full PNGs), amplified by a slow network
path (about 30 s per MB of request body before a network change, about 1.1 s
per MB after). The follow-up stack bounds browser screenshots to JPEG ≤1280 px,
keeps only the newest four to seven tool images per model request through Pi's
public `context` hook, adds `molly_view_image` (single image, region, or contact
sheet; JPEG ≤1280 px, declared directly to the Agent), converts WebP/AVIF browser
saves to PNG, and tunes the skills (two-step survey→pick research, one option on
the you-choose path, scoped font and filesystem search, no brute-force fitting).

Same prompts and fixture, DeepSeek Flash with reasoning high, 20-minute cap,
network probes HTTP 200 before and after (four-JPEG request 2.4–3.3 s):

| Build | A pass | A total (min) | A first preview | C pass | C total (min) | C first preview |
|---|---|---|---|---|---|---|
| BEFORE 52a21ffd | 0/2 | 20.0, 20.0 | 11.6, 12.0 | 2/2 | 14.3, 4.7 | 7.2, 2.2 |
| AFTER 0acf4ee7 | 2/2 | 8.7, 15.4 | 5.6, 9.6 | 1/2 | 20.0, 9.6 | —, 7.6 |
| Round 4 813a75c1 | 2/2 | 13.6, 11.2 | 10.0, 7.9 | 2/2 | 10.5, 5.2 | 2.7, 3.9 |

Peak decoded image bytes per A request fell from 24.5 MB (BEFORE median) to
7.7–10.0 MB. In round 4 the viewer was declared in all runs and used; all five
`save_image` calls succeeded (AVIF sources saved as PNG); both A runs made one
complete poster option and no extra options. Remaining departures: both C runs
still swept fonts and sizes to fit pixels despite the no-brute-force guidance
(C1 90 bash calls); A1 repeated one query without scrolling its results and A2
browsed an archive instead of searching, with no search extension. Two runs per
case on one machine; the bundle changes several things together, so effects are
not isolated, and no human visual review was performed.

## Round 5 (#223 C, PR #231, 343b7476)

Status: proposed
Measured: `343b7476f7c3d7dd3e17d22b1046c4822fcc15c8` (PR #231 head), 2026-10-22
Model: `deepseek-flash`, reasoning `high`; no image-model call
Runs: case C twice, serially, built local Electron app, isolated data/profile per run, 20-minute hard cap. Both runs committed under the cap. Both failed the no-sweep criterion: run 1 swept candidate fonts/sizes in bespoke Python/Pillow measurements; run 2 continued font comparisons and made six renders.

The prior Round 4 fixture file was not present in the checkout or retained artifact directories. I used the same prescribed copy and described Blue Hour composition as a fresh synthetic 1080 × 1350 SVG for both runs, with Avenir Next Condensed as its declared reference face. The fixture and output images are in ignored `e2e/artifacts/ab-223-r5/`; captured Pi transcripts and traces remain local and are not committed. Because the original Round 4 fixture was unavailable, visual and timing comparisons are approximate rather than a byte-identical fixture rerun.

| Run | 20-minute rule | Completed / total | First preview | Tool calls / bash | Preview renders | `reference-pack.mjs measure` | `font-catalog.mjs match` | `molly_view_image` with `fonts` | Type fitting sweep |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Round 4 C1 | Pass | 10.5 min | 2.7 min | not recorded | not recorded | not recorded | not recorded | used | Yes |
| Round 4 C2 | Pass | 5.2 min | 3.9 min | not recorded | not recorded | not recorded | not recorded | used | Yes |
| Round 5 run 1 | Pass | 7m 40.6s | 5m 56.6s | 75 / 53 | 3 | 0 | 3 | 1 call | Yes |
| Round 5 run 2 | Pass | 14m 26.6s | 6m 38.6s | 112 / 77 | 6 | 3 calls | 1 | 5 calls | Yes |

Reference face: Avenir Next Condensed. Run 1 embedded the face under the custom family names `Poster Sans` (700) and `Poster Sans Demi` (600); run 2 used `Avenir Next Condensed Bold` and `Avenir Next Condensed Demi Bold` directly. Headline `fontSize` / `letterSpacing` were 243 / −5 (`BLUE`) and 243 / −6 (`HOUR`) in run 1, and 244.35 / −5.6 and 244.35 / −6.6 in run 2. The remaining pairs (run 1 → run 2) were `SESSIONS` 87.6 / 13 → 88.98 / 12.4, `LIVE JAZZ` 62.1 / 8.25 → 62.85 / 7.97, `EVERY THURSDAY 9PM` 38.1 / 5.41 → 40.96 / 4, and `THE LANTERN ROOM` 35.3 / 4.75 → 38.14 / 3.35.

Both picked a visually close Avenir Next Condensed face and produced close side-by-side reconstructions. The no-sweep goal was not met. Run 1 never used `reference-pack.mjs measure`; instead it repeatedly probed candidate fonts and sizes with Python/Pillow. Its catalog shortlist favored Helvetica Neue Condensed Black and Avenir Next Condensed Heavy/Heavy Italic for `BLUE`, rather than the final Bold face. Run 2 used the measurement helper, but its first set of lower-text regions returned a 7-pixel partial line and a no-ink result; it corrected the crop and continued. Its catalog shortlist favored Futura Condensed ExtraBold for `HOUR` and did not identify the final Avenir Next Condensed Bold/Demi variants. The image viewer was used with font comparisons in both runs; no viewer failure was observed. These misses led to more manual inspection and fitting rather than a bounded measure→match→choose flow.

Compared with Round 4 C, Round 5 run 1 was faster overall than C1 (7.7 vs 10.5 min) but had a later first preview (5.9 vs 2.7 min); run 2 was slower than C2 (14.4 vs 5.2 min) and had a later first preview (6.6 vs 3.9 min). Tool/bash and helper-use counts were not retained per Round 4 run, so no count comparison is available. Round 4 and Round 5 both completed both runs within 20 minutes, but all four C runs still swept type choices. Two samples per round, one machine, and a regenerated synthetic fixture limit the comparison; the side-by-side images allow the owner to judge visual quality.

Artifacts: `e2e/artifacts/ab-223-r5/run-1/` and `e2e/artifacts/ab-223-r5/run-2/` (reference, final render, side-by-side, `design.yaml`, runtime/session metadata, screen capture, local trace, and captured transcript; run 2 also retains `receipt.json`). Run 1's committed receipt was confirmed before harness cleanup, but its temporary receipt file was not retained. The transcripts and traces are ignored local evidence and must not be committed.

## Round 6 (#223 C, PR #231, f03dd539)

Status: proposed
Measured: `f03dd539ae845ab0244068b33a969e0b7f1ffa0e`, 2026-10-22
Model: `deepseek-flash`, reasoning `high`, local OpenAI-compatible proxy at `127.0.0.1:8317/v1`; no image-model calls
Runs: case C twice, serially, built OSS Electron app, fresh isolated data/profile per run, 20-minute hard cap. Both committed under the cap; both failed the preview limit and no-custom-scripts criterion.

The earlier attempts were blocked by the runner sandbox before any prompt or model call.

The backup runner installed dependencies and rebuilt the app; the checkout differed from `f03dd539` only in the blocked Round 6 note. It reused the existing Electron harness and retained Round 5 runner/connection setup, adapting only local orchestration to preserve the fixture and use the proxy. No product or harness source changed. App, daemon, proxy checks and model execution ran outside the runner sandbox, with inherited `LODY_*` and `ELECTRON_RUN_AS_NODE` excluded. Before either prompt, real bootstrap IPC confirmed `running` / `ready`, `runtimeOwnership: owned`, and an isolated local workspace. The harness owned ports 54541 and 56609; Lody retained 17790. Each run's owned process/endpoint teardown succeeded before the next launch or profile export.

Both references are byte-identical to Round 5 run 1 (`SHA-256 71205b019267543a8bcdd6d8426b3858f67f6fbeb2f07bc81e85ebe8671dd1f7`). The prompt was extracted from Round 5's recorded user event, before application-injected tool/skill context: reconstruct the attached poster at 1080 × 1350, preserve composition/colors/copy, use native shapes/text, no external research/options or image-model call. Completion requires a `committed` receipt. Total time uses prompt-send to observed committed receipt, as in Round 5; first-preview time and tool counts use structured Pi JSONL timestamps/tool-call entries.

Helper cells below show **bash calls containing the helper (actual helper invocations)**. This preserves Round 5's shell-call counting convention while exposing batched commands and loops: run 1 measured six regions, then seven; run 2 measured six. All requested invocations count, including no-ink results. The custom-script criterion concerns the product Agent's measuring/comparison code, not runner evidence collection.

| Run | 20-minute rule | Completed / total | First preview | Tool calls / bash | Preview renders | `reference-pack.mjs measure` | `font-catalog.mjs match` | `molly_view_image` with `fonts` | Type fitting sweep |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Round 6 run 1 | Pass | Committed / 10m 37.3s | 6m 54.6s | 89 / 61 | 4 | 2 (13) | 4 (10) | 4 | Yes |
| Round 6 run 2 | Pass | Committed / 12m 11.4s | 5m 48.5s | 93 / 61 | 5 | 1 (6) | 2 (5) | 5 | Yes |

Both runs used `match --family`. Avenir Next Condensed appeared in both first match outputs: run 1 ranked Avenir Next Condensed Bold second for `BLUE`; run 2 ranked it fourth for `BLUE` in the first batched `BLUE`/`HOUR` output (its `HOUR` shortlist omitted it). Run 1 chose Futura Condensed ExtraBold for both headlines, embedded as `Poster Display`; smaller lines use Avenir Next Condensed Demi Bold (`Poster Sans`) and Bold (`Poster Sans Bold`). Run 2 embedded Avenir Next Condensed Bold as `Poster Headline` and Demi Bold as `Poster Caps`. These identities were checked against the embedded font metadata.

| Text line | Round 6 run 1: face; `fontSize` / `letterSpacing` | Round 6 run 2: face; `fontSize` / `letterSpacing` |
| --- | --- | --- |
| BLUE | Futura Condensed ExtraBold; 227.4 / −5 | Avenir Next Condensed Bold; 242 / −4.4 |
| HOUR | Futura Condensed ExtraBold; 227.4 / −4 | Avenir Next Condensed Bold; 242 / −4.4 |
| SESSIONS | Avenir Next Condensed Demi Bold; 87.8 / 12.8 | Avenir Next Condensed Demi Bold; 83.6 / 15.2 |
| LIVE JAZZ | Avenir Next Condensed Bold; 62.2 / 8.3 | Avenir Next Condensed Bold; 62.2 / 8.3 |
| EVERY THURSDAY 9PM | Avenir Next Condensed Demi Bold; 38.3 / 5.25 | Avenir Next Condensed Demi Bold; 38.1 / 5.4 |
| THE LANTERN ROOM | Avenir Next Condensed Demi Bold; 36.7 / 4.16 | Avenir Next Condensed Demi Bold; 36.7 / 4.13 |

Custom measuring/font-comparison scripts: **yes in both runs**. Run 1 wrote `fitfont.py`, ran further inline Pillow font/size probes, scanned pixels for shape bounds, line bands, colors and glyph widths, used FontTools glyph-bound/metric probes, and generated reference/render comparison crops. Run 2 ran inline Pillow/NumPy masks, row/column scans and bounding-box measurements, FontTools glyph-width/cap/advance comparisons, and repeated reference/render measurements and comparison crops. Font conversion alone was not treated as a measuring script. Neither run followed a bounded helper-only fitting path.

**Pass rule: run 1 Fail; run 2 Fail.** Both satisfy under 20 minutes, but 4/5 previews exceed three and both wrote custom measuring/comparison scripts. Compared with Round 5, run 1 was 2m 56.7s slower overall (10m 37.3s vs 7m 40.6s), first preview was 58.0s later, tool/bash calls rose from 75/53 to 89/61, and previews rose from 3 to 4. Run 2 was 2m 15.2s faster overall (12m 11.4s vs 14m 26.6s), first preview was 50.1s earlier, tool/bash calls fell from 112/77 to 93/61, and previews fell from 6 to 5. The changed shortlist includes Avenir Next Condensed in both first outputs, but these two runs do not establish removal of the custom fitting behavior. The owner judges visual match; no visual pass is claimed.

Artifacts: `e2e/artifacts/ab-223-r6/run-1/` and `run-2/` each retain `reference.png`, `final-render.png`, `side-by-side.png` (reference left, render right), `design.yaml` with its media, `receipt.json`, `run.json`, `metrics.json`, and `validation.json`, plus local runtime/profile/trace/structured-session evidence. Both committed YAML copies pass `@molly/design-authoring` validation with no diagnostics; both renders are 1080 × 1350. Transcripts, traces and artifacts remain ignored and are not committed. Verification: `pnpm install`, `pnpm e2e:build`, `pnpm check`, `pnpm run docs check`, and `pnpm format`; unrelated formatter changes reverted.
