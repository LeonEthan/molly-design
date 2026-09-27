# Restore shared agent records to Git

Status: implemented
Translation: pending

## Abstract

Ignoring `.agents/` prevented fresh clones and worktrees from receiving the
repository's maintenance instructions and decision context. The owner identified
that exclusion as a mistake and requested restoring tracking. Remove the ignore
rule, restore missing previously tracked files, and retain newer local notes.
Historical records preserve their original decisions; restoration does not
establish that their implementation descriptions are current.

## Decision and evidence

Commit `8a99cb05` removed the tracked tree and ignored it; `f748f384` then described
it as local-only. This correction supersedes that repository policy. Recover
missing files from the parent of `8a99cb05` without overwriting the seven notes
already present in this checkout. Update repository guidance to keep this shared
context in Git, while retaining the exclusion of private records, captured
transcripts, secrets, and machine-local state.

Removing only the ignore rule would leave the missing historical workflows and
explanations unavailable to new worktrees. Restoring the complete old tree over
existing files would instead lose subsequent notes. Restoring only missing paths
preserves both sources. Three links to retired terminal files now point to their
historical commit rather than nonexistent current paths.

## Verification

- `pnpm install`, `pnpm check`, `pnpm format`, and `pnpm run docs check` passed.
  Document checks reported no errors or registered SHA topics; existing instruction
  size warnings remain.
- All 207 historical paths are present. The staged tree contains 213 agent files
  and symlinks, including the seven preexisting local notes and this correction.
  A Git archive of that tree matched every working file and symlink target.
- `git diff --cached --check` passed after removing one historical blank line at EOF.

This change does not modify runtime code or revalidate the historical notes'
product claims.
