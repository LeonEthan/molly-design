# Design quality eval

A small, owner-judged regression eval for Molly's design output. Each case fixes
an input, a prompt and a hidden list of known defects; each Molly version runs
every case several times, and the owner compares outputs blind against the last
accepted version. The rationale is in the
[proposal note](../../.agents/notes/proposed/testing/2026-10-06-design-quality-regression-eval.md).

The owner alone judges design quality and acceptance. This standalone E2E lane
collects artifacts and human answers; it adds no AI evaluator or product-runtime
behavior. Canvas and editable-text checks are reference evidence, not a quality
verdict.

This is a live-model lane: it calls real model and image APIs, costs money and is
never part of CI.

## Layout

```text
e2e/design-eval/
  cases/<source-id>/          # tracked synthetic cases
    media/source.png          # flat-raster input
    <variant>.json            # one case per prompt variant
  private/                    # gitignored
    connection.json           # model and image endpoints, keys
    <source-id>/              # real-world cases (real people, brands, screenshots)
    runs/<label>/<source-id>/<variant>/run-N/
```

A case file:

| Field          | Meaning                                                       |
| -------------- | ------------------------------------------------------------- |
| `input`        | Source path relative to the case file, plus its SHA-256       |
| `prompt`       | The first user message, verbatim                              |
| `followUps`    | Later user messages in the same session                       |
| `gate`         | Automatic checks: canvas size, required editable text, bounds |
| `preserve`     | Regions the owner confirms unchanged                          |
| `knownDefects` | What an expert would fix unprompted; never sent to the Agent  |

`cases/bright-hare-holiday` is the synthetic twin of a private coffee-poster case.
Its photo came from one `gpt-image-2.5-sunburst` call; `compose.py` lays out the
text with Noto Sans SC (OFL) and deliberately repeats the private case's defects.

## Running

```sh
pnpm e2e:build
node e2e/scripts/run-design-eval.mjs \
  --case e2e/design-eval/cases/bright-hare-holiday/redesign.json \
  --case e2e/design-eval/cases/bright-hare-holiday/resize-9x16.json \
  --label <version-label> --runs 3 --concurrency 2
```

`--case` repeats. `--concurrency` runs that many isolated desktops at once. On
macOS each one owns its data directory, IPC sockets and a random CLI port, so they
do not collide; Windows still shares fixed named pipes, so keep concurrency at 1
there. The default timeout is 45 minutes per turn; duration varies by case and
model.

The first baseline hit provider overload and incomplete turns with six and four
workers. Two workers is the owner's choice for backfills; it is not a verified
general reliability limit. To fill missing outputs, use `--runs 1` and repeat
`--case` for each intended attempt, including repeated paths for the same case.
Completed outputs that fail the design gate still need review; execution errors
are skipped by the review tool.

`private/connection.json` holds `model.{baseUrl,apiKey,modelId,reasoning}`,
`image.{baseUrl,apiKey,model}` and `browser.{browserId,profileId}`. Select the
browser/profile IDs from Molly's existing Website accounts source list. Each
run launches an isolated desktop through the
e2e harness, saves the connections there, sends the prompts and records
`run.json`, `design.json`, `preview.png`, the artwork directory and the visible
conversation. New runs retain the attached source and the original case manifest
in `run.json.caseSnapshot`, including the actual follow-ups. Later edits to a case
do not change what the review page shows. A run directory is never overwritten,
and a failed paid call is never retried. `overall: completed` records execution
completion independently of the reference checks and human acceptance.
New runs become reviewable only after that completion is recorded, including
all requested follow-ups and exports. An unfinished preview cannot be accepted.

Each prompt must produce a new `committed` receipt whose turn, artwork and
prompt match that request. The current design revision must match its receipt
before any export or follow-up. Other terminal statuses stop the run and retain
the receipt as failure evidence; an older saved design cannot count as completion.

Before sending a design prompt, every instance imports the selected profile's
Pinterest account through the existing product IPC. Account preparation is
serialized across workers; design turns still use `--concurrency`. The runner
opens a Pinterest design search in the native browser and requires visible
signed-in controls, loaded Pin images and no login overlay. Avatars and business
hub artwork do not count as reference images. Cookie counts alone never pass
preparation. A missing profile, import denial or blocked website fails the run
before any paid design turn; there is no automatic import or paid-call retry.
macOS browser-data and Keychain permissions must be granted by the user. For
development builds, imports last only until that instance quits, so preparation
runs again for every fresh instance.

`run.json` records preparation status, source IDs, cookie counts and website
verification; `browser-ready.png` retains private visual evidence. No Cookie
values are exported by the runner. Successful and failed native Pi session
records are kept under the ignored run directory to audit the Agent's actual
research separately from website readiness.

Use `--first-turn-only` to run the case's initial prompt without its copy-edit
follow-ups. For three redesign attempts, select one redesign case with `--runs 3
--concurrency 3 --first-turn-only` and use a fresh label.

Keep a separate label when changing the Agent model, image model or reasoning.
Such a backfill is a separate cohort, not a version comparison with fixed model
settings. Pairwise review rejects missing or different Agent model, reasoning
and image-model settings. Changing `model.modelId` in the private connection file selects the
model inside the isolated desktops without changing the provider configuration.
The eval declares only `off` and the requested `model.reasoning` level in its
custom model metadata. This lets the existing picker select an explicit level
such as `max`; provider acceptance is established by the live run, not this
declaration. Native session records retain the model and thinking-level selection.

`node e2e/scripts/design-eval-gate.mjs <case.json> <design.json>` re-checks the
gate for any saved design.

## Reviewing

```sh
# Accept a first baseline run by run
node e2e/scripts/design-eval-review.mjs --candidate <label>
# Compare a new version blind against the accepted baseline
node e2e/scripts/design-eval-review.mjs --candidate <new-label> --baseline <label>
# Un-blind and score when done
node e2e/scripts/design-eval-review.mjs --candidate <new-label> --baseline <label> --score
```

The page uses Simplified Chinese labels for controls, review dimensions, known
defects and protected regions; saved verdict keys and values remain unchanged.
It shows the source, each output (and its follow-ups), the gate result and
the Agent's final message. In pairwise mode, run _i_ of each label is paired and
randomly placed as A or B; the placement is fixed in `private/reviews/<name>/key.json`
on first launch. The browser receives opaque image IDs rather than run paths or
model metadata. Each choice queues a save to `verdicts.json`; the server serializes
updates and atomically replaces the file. Failed saves remain visible and can be
retried with the page's save button. A pair counts as reviewed after all four dimensions
and both sides' preservation and summary-honesty questions have explicit answers.
Single-label mode requires an explicit acceptance or rejection; notes and defect
checkboxes are optional.

`--score` writes `summary.json` with completed-review counts, human acceptance
counts and human dimension choices. It never declares quality `ok` or `REGRESSED`,
and automatic checks do not override the owner's verdict. Before using any label
as a baseline, review it in single-label mode; only explicitly accepted runs are
eligible. Cached pairs are refused if a baseline run is later rejected.

Version comparisons require matching original case snapshots and retained source
hashes. Changed prompts, images, follow-ups or review rubrics cannot silently
become the same task. Historical runs without snapshots remain available for
single-label human review with a warning that the source and rubric come from
the current case; they cannot establish a strict version comparison. Existing
verdicts are preserved, and missing historical evidence is not reconstructed.
