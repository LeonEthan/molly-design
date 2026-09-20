# Contributing Guide

Thank you for your interest in contributing to Molly! Bug reports, documentation improvements, tests, and new features are all welcome.

## Contribution Terms

By submitting a pull request, patch, or other contribution to Molly, you agree to the following terms:

- You have the right to submit the contribution. It is your original work, or you have the necessary permission to contribute it.
- Unless you explicitly state otherwise in writing, your contribution is submitted under the Apache License, Version 2.0.
- You retain copyright in your contribution. You grant Molly and all recipients the rights provided by the Apache License, including the right to use, modify, distribute, and sublicense the contribution.
- Molly may use contributions in open-source and commercial products and services, subject to the Apache License.
- If you cannot agree to these terms, please do not submit the contribution. A separate written agreement with Molly takes precedence over these terms.

## What we can review

Molly inherits a substantial desktop codebase with invariants that are easy to break in a large diff and expensive to rediscover (the local/cloud boundary, catalog contracts, protocol capabilities). A large unsolicited patch often cannot be reviewed safely, even when the intent is generous.

This is ordinary open-source practice: maintainers own the architecture. The most useful first contribution is often a clear Issue with reproduction or analysis, not a rewrite. Small, focused pull requests that change one thing are welcome. Closing a large PR is a statement about review capacity and risk, not about your effort.

**Community contributors** (anyone who is not a Molly maintainer, and who has not been assigned the corresponding Issue by a maintainer):

1. Keep the pull request under **1000 changed lines** (GitHub additions + deletions). We only review community PRs under that size.
2. If the work would exceed 1000 lines, open an Issue with your analysis first. Those reports are welcome. Do not open a larger PR unless a maintainer assigns you that Issue.

Molly maintainers work on same-repository branches and are not subject to this cap. A fork remains an external contribution even when the author is a team member.

## Before You Start

1. Search existing issues and pull requests to avoid duplicate work.
2. Report reproducible problems with the [bug report form](https://github.com/LeonEthan/molly-design/issues/new?template=01-bug-report.yml), or propose improvements with the [feature request form](https://github.com/LeonEthan/molly-design/issues/new?template=02-feature-request.yml).
3. For a fork-based contribution, use an existing Issue when one provides useful context. Same-repository branches do not require an Issue solely for contribution intake.
4. Do not report security vulnerabilities in a public issue; follow the [security policy](./SECURITY.md) instead.

Keep the selected Issue Form structure, required answers, confirmations, and `[Bug]` or `[Feature Request]` title prefix. Issues that do not conform are marked `status:needs-issue-body` with a warning until corrected. Only repository owners and automated bots are exempt; regular organization members must also use the forms.

## Get the Code

The default desktop build needs three pinned source dependencies:

```sh
git clone https://github.com/LeonEthan/molly-design.git
cd molly-design
git submodule update --init packages/acp-extension-core packages/acp-extension-dsh packages/design-bento/bento
```

## Source dependencies

| Source                                        | Why it remains                                                           | Maintenance boundary                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| ACP core                                      | Shared protocol types and host contracts                                 | Root pnpm builds the pinned submodule; coordinate producer/consumer changes.                                            |
| ACP DSH                                       | `packages/shared/src/deepseek-harness.ts` imports capability definitions | Keep until its real consumers are retired; it is not an enabled desktop engine.                                         |
| Bento                                         | Editor and renderer sources                                              | Its npm lockfile, source manifest, patches and Molly overlays are assembled in a temporary worktree.                    |
| Claude/Codex/Grok/Kimi submodules (`vendor/`) | Historical probes and upstream provenance                                | Outside default pnpm/CI. Initialize a specific path only for scoped maintenance; Kimi is a separate upstream workspace. |

Do not run recursive submodule initialization for ordinary desktop work. Do not
merge upstream repositories into Molly just to remove nesting. Update source pins,
patches, provenance and affected checks together; keep original author/license notices.
For Bento maintenance, see [its build guide](packages/design-bento/README.md#build-and-upgrade).
Root `pnpm install` does not install Bento's isolated npm dependency tree.

## Local Development

You need Node.js `>=22.14.0 <23 || >=23.6.0`, Git, npm and the pnpm version
specified by this project (via Corepack). Native addon builds need the platform's
compiler toolchain: Xcode Command Line Tools on macOS, Visual Studio C++ build tools
on Windows, or a C/C++ toolchain on Linux, with Python available to node-gyp.
Dependency downloads require network access on a cold cache. macOS Apple Silicon
is the first-release target; other platform build commands are experimental.

```bash
corepack pnpm install
corepack pnpm start:local
```

This builds the local CLI and open-source desktop renderer, then launches Electron. The first run may take a while. Fully quit any existing Molly desktop process first because the app allows only one running instance.

The open-source build is local-only: it needs no `.env` file, Molly account, or cloud environment variables. Cloud endpoints and telemetry variables are not used.

## Isolate Local Data While Developing

By default, the open-source desktop app stores data in `~/.molly`. To avoid using existing data during development, set `MOLLY_DATA_DIR`:

```bash
MOLLY_DATA_DIR="$(pwd)/.molly-dev-data" pnpm start:local
```

PowerShell:

```powershell
$env:MOLLY_DATA_DIR = "$PWD/.molly-dev-data"
pnpm start:local
```

This variable is optional. Never commit the generated data or credentials.

## Submitting Changes

Before submitting, run `pnpm check`, `pnpm format`, `pnpm run docs check` and
inspect the diff. `pnpm check` includes type checking, lint, tests and public
boundary validation. Repository automation tests also run with
`node --test .github/scripts/*.test.mjs`; packaging changes use the Electron
packaging probes. A passing build is not installed-user or visual acceptance.

For changes to important behavior or architecture, follow the
[document maintenance workflow](./.agents/README.md). Specs explain intent and require explicit human
review. Significant decisions belong in an Agent Note; routine styling and local
fixes normally need only a PR explanation. You may contribute in either English
or Chinese; maintainers can arrange the counterpart after merge. Invariants
continue to live in the nearest `AGENTS.md`.

1. Create a clearly named branch from the latest code.
2. Keep changes focused; avoid unrelated formatting or refactoring.
3. Add or update tests for behavior changes, and make sure the existing tests pass.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example:

   ```text
   feat: add workspace search
   fix: handle empty session title
   docs: improve local setup guide
   ```

5. Open a pull request using the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md). Every fork-based pull request must reference a Molly Issue and fill in the problem, summary, test plan, and Context handoff. Use `Closes #123` when merging the PR should close the Issue, and `Refs #123` only when it must remain open. A bare `#123` or full Molly Issue URL in `Related issue` defaults to `Closes #123`. The handoff gives the maintainers' reviewing Agent concise, PR-specific review focus, decisions to challenge, plausible failures or evidence gaps, and a public summary of the authoring context. Every field is required; `N/A` and redacted answers are rejected because they do not provide enough context for a safe review.

If an Agent prepares a fork-based contribution, it must explain that the Context handoff is public and an invalid PR receives seven days to be corrected before closure. An Agent preparing a same-repository branch must not create an Issue solely to satisfy contribution intake.

A fork-based pull request that does not meet the contribution requirements is marked `status:needs-pr-attention`. All findings share one comment and one seven-day correction period. A change over 1000 additions plus deletions without a maintainer assignment on the linked Issue, or over 200 without its prior Issue reference, adds a size-specific finding rather than a separate status. A valid edit clears the managed state automatically.

If the PR remains invalid after seven days, it is marked `status:pr-policy-expired` and closed. Continue through a new pull request using the current template. A maintainer may apply `status:pr-policy-bypass` for an exceptional PR; while present, automation does not modify its Issue reference or enforce contribution requirements, and it clears prior managed policy state. Removing the label resumes normal enforcement.

Pull requests are automatically labeled with one or more `scope:*` labels based on the changed paths. The [scope mapping](./.github/labeler.yml) uses each top-level key as a label name and its globs as matching paths; the [scope workflow](./.github/workflows/pr-scope.yml) creates or applies matching labels and removes configured labels that stop matching. Manually applied and unconfigured labels are left unchanged.

## Code Guidelines

- Follow the existing code style and directory structure.
- Do not commit secrets, access tokens, real user data, or user/agent transcripts. Test data must be synthetic.

Thank you for contributing!
