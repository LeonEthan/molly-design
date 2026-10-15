# Workflow security guidelines

Binding constraints for `workflows/`. Root and `.github/AGENTS.md` instructions
apply; read this file before changing a workflow.

- `workflows/pr-policy.yml` is the only PR policy event entry point.
  `workflows/pr-policy-reconcile.yml` is callable only through `workflow_call`.
- Workflows that pass signing or update keys to a third-party Action must pin that
  Action to a reviewed full commit SHA. Scope signing secrets to the exact trusted
  preparation, packaging, or signing step that consumes them; never place them in a
  job-level environment inherited by unrelated actions and dependency scripts.
- `pull_request_target` provides a write-capable token. For PR events, checkout
  policy from trusted `github.sha`; scheduled and manual audits use
  `github.event.repository.default_branch`. Never checkout or execute the PR
  head, and never use the possibly stale `pull_request.base.sha`.
- Code CI runs on `pull_request` with read-only repository permissions and
  initializes only the desktop source submodules: ACP core and DSH
  capabilities (Bento is vendored in-tree, not a submodule). Retained legacy
  runtimes are not default CI dependencies.
- Desktop journey authoring runs on a maintainer machine. GitHub workflows never
  receive Codex credentials or publish author output; an ordinary PR exposes the
  reviewed patch to the existing read-only code checks.
- Desktop E2E native resource caches (`agent-browser`, `browser-cookie-reader`)
  live only in the read-only `pull_request`/schedule/manual regression lanes:
  restore after a normal clean checkout with the exact key from
  `scripts/desktop-native-cache.mjs`, never `restore-keys` or `clean: false`.
  The primary key can prefix-match, so accept a restore only when
  `cache-matched-key` equals the requested key; delete anything else before the
  build. The build re-verifies every accepted manifest and rebuilds invalid
  output. Save only output the build recorded as built and verified in this run
  whose `buildId` the post-build verification matches; a miss or a non-hit is
  not proof. Saves are non-fatal so cache-service, quota or permission
  failures only leave runs cold.
  GitHub cache scope is the trust boundary: PR writes stay in the PR merge ref,
  while PR runs may read default-branch caches. A dispatch on another branch is
  branch-scoped, not trusted. Never restore them in `pull_request_target`, release or
  another publishing workflow; a manifest proves consistency, not producer trust.
