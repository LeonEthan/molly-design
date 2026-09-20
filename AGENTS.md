# Repository guidelines

`CLAUDE.md` symlinks here; edit `AGENTS.md` only.
Entry points: [README](README.md#repository).

## Working with the user

Planning/review does not authorize runtime implementation or publication.
Explicit tasks allow five image generate/edit calls total across runs; ask before
exceeding five unless a larger budget is already authorized.
Preserve unrelated changes. Report outcomes, evidence and limits.

## Design principles and migration scope

Question requirements, delete unnecessary mechanisms, then simplify and optimize. Build only
what is needed now; completed code and concept images do not establish necessity.

- Reuse Lody's architecture, UI and agent lifecycle with Bento. Migration only
  reduces scope; additions need explicit confirmation. Reuse modules before adding
  protocols/storage.
- Keep one editable truth: BentoDoc. YAML projections and Agent drafts serve
  different purposes. Recompute derived views where feasible; justify persistence
  by current use. Keep exposed Bento edits lossless in YAML with minimal adaptation.
  Put scene knowledge in skills; base constraints on evidence.
- Before design changes, read the [Spec](specs/graphic-design-platform.zh.md) and
  [scope review](.agents/notes/proposed/simplification/2026-09-11-design-result-feedback.zh.md).
  Rules define the target; evidence establishes current support.

## Design platform: agent-naive environment

Lody owns execution; Bento owns independent editing/rendering and snapshot/flush;
design services own conversion/storage. The product Agent owns creation,
review and completion. Expose honest capabilities; tool absence does not imply
absence of other agent capabilities. Preserve rendering previews and image
reading and commit receipts; retire per-turn result cards and dedicated thumbnails.

Design saves update YAML from human edits independently of Agent execution. Keep
public read-before-edit reminder hooks and native tool guards; no runtime patches
or generation-level read proofs. Final commits check schema, kernel replay, assets
and versions. No creative-step enforcement, silent repair or automatic paid retries. Before Agent
execution, flush human edits; keep every Bento instance of that artwork read-only
until execution and artifact processing end. The app enforces this through generic
read-only and mutation checks; Bento does not track Agent lifecycle. Consumer-scoped
file previews neither commit nor trigger sync loops. Files or previews do not end
Agent turns. Human judgment establishes visual quality; Agent review is advisory.

Agents resolve file conflicts through tool errors and re-reading; preserve drafts
and retire candidate workflows. Never auto-restart completed turns.
Image MCP supports generate/edit
with a user-required model and no product default.

Design history uses a Molly-managed local Git repository only, isolated from user
repositories. No parallel snapshot store; retain current saves, CAS and drafts.

## Context and documentation

- Read applicable `AGENTS.md`, relevant Specs, active notes, `.agents/docs/` and
  module READMEs. Topic triggers apply across directories. Archives are history.
- Specs define intent, docs implementation, notes decisions. Distinguish bugs,
  stale docs and unimplemented intent using evidence; never rewrite intent to
  justify bugs.
- Changed intent/guarantees return the [Spec](specs/AGENTS.md) to `draft`.
  `approved` requires linked human approval of that revision; review `outdated`.
  Only editorial changes preserving meaning retain approval.
- Non-trivial changes and substantial research/design need an owning
  [Agent Note](.agents/notes/AGENTS.md#when-to-write) in the same PR, if any. Only
  mechanical/local edits without changed decisions are exempt. Link distinct
  decisions; proposals stay `proposed`. Report deferred notes on read-only tasks.
- Update affected docs/READMEs. Run `pnpm run docs status` at start and
  `pnpm run docs check` at finish; keep `run` (bare `docs` opens package websites).
  Review SHA-protected changes. Checks/translations
  prove neither correctness nor approval. Translation may follow; see [maintenance](.agents/README.md).
- Binding rules belong in the nearest `AGENTS.md` (<8 KiB); new scopes need a
  `CLAUDE.md` symlink. Keep rationale in owning docs/notes.

## Repository boundary

- Public source is `apps/{cli,electron}` and their packages. Exclude hosted backends,
  operator/billing config, secrets/private records and Web/mobile sources.
  Never commit captured user/agent transcripts; use synthetic fixtures.
- No `@lody/convex`, private workspace packages or generated backend APIs.
  Optional-cloud names/DTOs belong in `packages/cloud-api`; shared product code
  uses `packages/platform` capabilities/ports and remains platform-neutral.
- OSS desktop is local-only: no authenticated product-cloud requests or telemetry.
  Public runtime and Molly update downloads are exceptions.
- Before composition, capability-gated settings, telemetry or runtime download
  changes, read [platform contracts](packages/platform/AGENTS.md).
- Before daemon negotiation, MCP/Role catalogs or their UI consumers, per-turn MCP
  selection, or Role creation/dispatch, read [shared contracts](packages/shared/AGENTS.md).
- Default workspace/CI uses ACP core, DSH capability contracts and Bento.
  Claude/Codex/Grok/Kimi submodules and `site-docs` are retained upstream material,
  outside root pnpm. Initialize them explicitly only for scoped historical work;
  never duplicate shared ACP contracts or add legacy runtime installs to desktop setup.
  Historical Kimi packaging still uses a separately built, checksummed runtime artifact.
- Viewer packaging/version changes follow its [rules](packages/code-review-viewer/AGENTS.md).
  Package-scope or cloud/local composition changes require `pnpm check:public-boundary`.

## Contributions and checks

- Identify once: Molly maintainer if the user says so or GitHub login is
  `LeonEthan`; otherwise community. Read [.github/AGENTS.md](.github/AGENTS.md)
  before planning community contributions and before any PR/Issue work.
- Node `>=22.14.0 <23 || >=23.6.0` (Node-API 10); pnpm from `package.json`. Run `pnpm install` (skip nested checkouts);
  standalone work uses a separate clone. `pnpm start:local` and root `pnpm build`
  use local desktop composition.
- Before commit, run `pnpm check` and `pnpm format`. If tests are skipped, report
  type/build/static checks. Manifest changes update `pnpm-lock.yaml`.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`);
  AI commits end with `Model: <runtime-model-id>`.
- Test observable behavior with explicit signals, injected clocks, fake timers and
  deterministic fixtures. No real sleeps, wall-clock races, network, machine load
  or scheduler luck; do not assert mock call counts.
- Keep edits traceable, contracts explicit; remove only unused code. Update the
  nearest public `AGENTS.md` for changed invariants/boundaries.

## Code Review Rules

Report P0/P1 only, security first. Skip style, nits, P2+, extra tests and duplication
under 100 lines. React 👍 when a PR solves its Issue with no P0/P1 remaining.
Details: [.github/codex-review.md](.github/codex-review.md).

- P0: exploitable security, secret leak, auth/capability bypass, data loss or broken
  public/cloud/local boundary.
- P1: likely shipped breakage or a durable catalog/session contract violation.

## Agent skills

- Issues: `LeonEthan/molly-design` via `gh`; see [issue tracker](.agents/agent-skills/issue-tracker.md).
- Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
  `wontfix`; see [triage rules](.agents/agent-skills/triage-labels.md).
- Domain: one root `CONTEXT.md` glossary and `.agents/docs/adr/`; top-level `docs/`
  is a closed product path. See [domain rules](.agents/agent-skills/domain.md).
