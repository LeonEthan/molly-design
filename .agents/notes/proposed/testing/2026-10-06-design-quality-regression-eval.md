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

## Open questions and limits

- Image calls per run are not counted yet; the retained artwork directory and
  conversation allow a later count.
- The blind pairwise review sheet is not built yet.
- The imported baseline run did not record its exact build or image-call count.
- A single judge brings consistent but personal taste. That is accepted for a
  regression signal, but it does not establish general design quality.
