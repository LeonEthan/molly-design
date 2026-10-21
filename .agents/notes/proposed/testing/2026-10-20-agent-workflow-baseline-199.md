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
