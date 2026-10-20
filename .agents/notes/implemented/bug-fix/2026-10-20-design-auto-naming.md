# Design sessions are named from the first sentence again

Status: implemented
Translation: pending

## Abstract

New designs stayed "Untitled design" after the first turn. Commit `81bdd8f`
(merged in PR #146) put the Molly dispatch gate back, so the local title
generator never ran. Dispatch again asks for a title for Molly. The generator
uses the first user sentence, writes it only over a draft title, and logs a
failure without changing the draft or failing the turn. A committed artwork
title can still replace that generated name. A manual rename stays.

## Decision

The Pi harness migration (`2977792`) stopped calling title generation for
Molly and left a local first-sentence generator in place. PR #146 restored the
call in `88959b4`, then `81bdd8f` removed it again so a design would stay
untitled until `design.yaml` carried a title. Models do not reliably write
that field, so every new design kept the draft name.

Reuse the existing generator and the existing `setTitleIfSourceIn` guard.
A second model request was rejected when Molly titles were first made local,
and it stays rejected. Spawn no title worker.

The design-platform Spec and the chat invariant now say the same thing.
Creation stays "Untitled design". The Spec revision remains draft until a
linked approval record exists.

## Verification

Unit tests cover the Molly dispatch call, the first sentence of a text prompt
and an image-and-text prompt, a manual rename, and a failed generation.
Desktop checks are recorded on the pull request.
