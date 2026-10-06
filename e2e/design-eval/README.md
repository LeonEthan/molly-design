# Design quality eval

A small, owner-judged regression eval for Molly's design output. Each case fixes
an input, a prompt and a hidden list of known defects; each Molly version runs
every case several times, and the owner compares outputs blind against the last
accepted version. The rationale is in the
[proposal note](../../.agents/notes/proposed/testing/2026-10-06-design-quality-regression-eval.md).

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
  --label <version-label> --runs 3 --concurrency 6
```

`--case` repeats. `--concurrency` runs that many isolated desktops at once. On
macOS each one owns its data directory, IPC sockets and a random CLI port, so they
do not collide; Windows still shares fixed named pipes, so keep concurrency at 1
there. A turn usually takes 15–25 minutes.

`private/connection.json` holds `model.{baseUrl,apiKey,modelId,reasoning}` and
`image.{baseUrl,apiKey,model}`. Each run launches an isolated desktop through the
e2e harness, saves the connections there, sends the prompts and records
`run.json`, `design.json`, `preview.png`, the artwork directory and the visible
conversation. A run directory is never overwritten, and a failed paid call is
never retried.

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

The page shows the source, each output (and its follow-ups), the gate result and
the Agent's final message. In pairwise mode, run _i_ of each label is paired and
randomly placed as A or B; the placement is fixed in `private/reviews/<name>/key.json`
on first launch, so version labels never reach the page. Each choice saves to
`verdicts.json` immediately. Scoring writes `summary.json` and marks a case
regressed when most of its pairs are worse on any dimension.
