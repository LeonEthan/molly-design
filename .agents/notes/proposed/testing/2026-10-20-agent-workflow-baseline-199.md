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
