# Verification

How to prove work before declaring done. Two principles bind everything below:
**prove-on-the-real-surface** — check the real artifact, not a proxy — and
**name-the-safety-fact** — prove the one fact the change is safe because of.
The root evidence rules apply throughout: every claim carries its evidence or
its label.

## Match the check to the change

"It compiles" and "tests pass" are supporting signals, never proof of
behavior. Pick the row matching the change and check the real artifact:

| Change | Proof |
| --- | --- |
| CLI behavior | Run the real command; quote its output |
| Electron/UI behavior | Drive the real app (launch, interact, screenshot); a story or unit test is a proxy |
| Storage / persistence | Read the value back from the store after a write |
| Parser / conversion (incl. YAML projections) | Replay real input through it; inspect the output |
| Contract / protocol | Exercise both sides against each other, not each against a mock |
| Performance | Before/after measurement on the same workload; cite the numbers |
| Docs, Specs, notes | `pnpm run docs check`, then read the result as its intended reader |
| Design artifacts (Artwork, BentoDoc, YAML projections, Agent drafts) | Get evidence from Molly's own surfaces before concluding: render with the `molly_render_preview` MCP tool, and run the graphic-design skill's `scripts/render-preview.mjs` (intake) and `scripts/finalize.mjs` (diagnostics). Reading the files alone is not proof. Visual quality follows the [root rule on human judgment](../../AGENTS.md#design-platform-agent-naive-environment) |

Rules of observation:

- Check the real thing directly: process liveness, the actual stored value,
  the rendered pixel — not mtimes, caches, derived state, or a self-report.
- When verification fails, suspect the observation method before the system.
- The strongest proof is a deterministic script or test that re-runs the same
  comparison; a one-time eyeball is the weakest. Keep the artifact (script,
  output, screenshot) visible in the report so a reviewer can re-run it.
- Paste evidence verbatim. Never hand the human a check you could have run.

## Blast radius

For a small-looking change, the question is what else it could break — and the
deliverable is one proven fact, not a caller census.

1. **Name the one fact the change is safe because of.** "Every consumer parses
   this field at the boundary." "The wire format is additive-only." "Nothing
   persists this shape across versions."
2. **Look where grep stops.** Generated clients, JSON/YAML/wire formats, store
   schemas and migrations, feature flags, localized strings, cross-package
   consumers, the cloud/local boundary.
3. **Prove the fact by running code** — a script, a test, or a real call
   against the artifact. The confidence ladder: asserted < type-checked <
   unit-tested < scripted against the real artifact < observed in the running
   app. Ship at the highest rung the change warrants, and name the rung in the
   report.
