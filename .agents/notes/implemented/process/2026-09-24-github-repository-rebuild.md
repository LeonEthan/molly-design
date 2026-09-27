# GitHub repository rebuild: purged pre-release history, archived approval evidence

Status: implemented
Translation: pending

## Abstract

After the pre-release history rewrite, the superseded commits — including
content PR #52 had redacted — remained publicly fetchable through stale
pull-request refs and by SHA, and neither can be removed by repository users.
On 2026-09-24 the owner deleted and recreated `LeonEthan/molly-design` under
the same name to purge that history server-side; `main` was re-pushed with
identical SHAs, and settings, topics, labels and the ruleset were restored
from a pre-deletion export. The destroyed pull-request and issue records
(PRs #33–#56, issues #45–#55) survive in the maintainer's local JSON archive,
while this note re-hosts the approval and merge evidence that in-repo
documents cite — 27 retired links across 26 files now point here. Two lasting
costs: issue/PR numbering restarts at #1 so old numeric GitHub URLs must never
be referenced again, and the 8 signing secrets must be re-entered manually.

## Summary

On 2026-09-24 the `LeonEthan/molly-design` GitHub repository was deleted and
recreated under the same name. The pre-release history had already been
rewritten before public launch, but the superseded commits remained publicly
fetchable through stale pull-request refs (`refs/pull/33|43|44/head`) and by
SHA, including content that PR #52 had redacted (local machine paths,
third-party product screenshots, brand residuals). Users cannot delete pull
request refs or trigger server-side object GC, so the owner chose
delete-and-recreate over a GitHub Support purge request.

The recreated repository keeps the identical `main` history (tip `6ce238b8`,
unchanged SHAs), description, topics, labels and the `main` ruleset. All
GitHub-side records that could not be migrated were exported before deletion
to the maintainer's local archive
`~/dev/molly-design-github-backup-2026-09-24/` (26 JSON files: 7 PRs with
comments, 8 issues with comments, labels, ruleset, repo settings). The
pre-rewrite history is archived locally as
`~/dev/molly-design-legacy-history-2026-09-24.bundle` and must not be
published.

## What was destroyed and how it is replaced

- Pull requests #33–#56 and issues #45–#55 with their discussion threads:
  replaced by the local JSON archive; this note re-hosts the evidence that
  in-repo documents link to.
- Issue/PR numbering restarts at #1 on the new repository. Old numeric URLs
  must therefore never be referenced again — they would silently mispoint
  once new items reuse those numbers.
- Repository secrets (8 Apple/Sparkle signing entries used by
  `release-electron.yml`) are not exportable and must be re-entered by the
  maintainer in the new repository settings.
- The local-only tag `runtime-artifacts-v1` was deliberately **not** pushed:
  it points at the superseded history line (root `2fe304c3`). A future
  runtime release re-creates that tag name on current history.

## PR #52 owner approval

Original URL (retired 2026-09-24):
`https://github.com/LeonEthan/molly-design/pull/52#issuecomment-5755930477`
Author: `LeonEthan` (repository owner) · 2026-09-21T05:42:58Z
PR merged 2026-09-21T08:47:39Z as `d7b13cb7`.

> ## Spec approval record (owner decision)
>
> Per `specs/AGENTS.md` governance, I approve the current revisions of the 16
> spec documents on this branch (tree at `a7a297ae`), flipping them from
> `draft` to `approved`:
>
> - `specs/chat-share-image.md`
> - `specs/communication-architecture.md` / `.zh.md`
> - `specs/graphic-design-platform.md` / `.zh.md`
> - `specs/lody-upstream-adoption.md` / `.zh.md`
> - `specs/machine-lifecycle-ack.md` (restart-only contract as rewritten in
>   this PR)
> - `specs/molly-design-independent-release.md` / `.zh.md`
> - `specs/molly-embedded-pi-harness.md` / `.zh.md`
> - `specs/session-orchestration.md` / `.zh.md`
> - `specs/session-validation-hotfix.md` / `.zh.md`
>
> Approval covers content as of `a7a297ae`; the follow-up commit changes only
> Status/approval metadata lines. Translation statuses are unchanged and
> assert nothing about correctness.
>
> _Recorded by Claude Code at the maintainer's explicit instruction
> (Model: k3)._

## Other linked pull requests (archived evidence)

### PR #53

`chore(desktop): retire Linux support and Ubuntu Daily` — MERGED
2026-09-21T12:40:02Z as `1d8967c1`. Original URL retired:
`https://github.com/LeonEthan/molly-design/pull/53`

### PR #54

`fix: retire deleted session resources and stale caches` — MERGED
2026-09-22T09:25:48Z as `7bd3e187`. Original URL retired:
`https://github.com/LeonEthan/molly-design/pull/54`

### PR #56

`feat: support Pinterest research in Molly's embedded browser` — MERGED
2026-09-23T16:12:32Z as `6eeb4f78`. Original URL retired:
`https://github.com/LeonEthan/molly-design/pull/56`

## Link retargeting

Every in-repo reference to the retired URLs now points at the sections above
(27 references across 26 files). This preserves the meaning of each citation —
same human decision, same dates, same merge commits — only the location moved
from GitHub pages to this in-repo archive, an editorial change under
`specs/AGENTS.md`.
