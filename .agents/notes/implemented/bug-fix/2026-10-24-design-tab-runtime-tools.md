# Design tab runtime tools

Status: implemented
Translation: pending

## Abstract

New design tab accepted a child conversation without design metadata, so Agent
startup disabled design runtime behavior and omitted design MCP namespaces.
The owner decided on 2026-10-24 that new tabs share the current artwork.
Tab acceptance now carries that artwork association through the existing child
creation path, enabling the ordinary design startup mechanism. Deterministic
producer and startup tests pass; native Pinterest navigation remains untested.
The owner approved the added Spec revision on 2026-10-24.

## Root cause and decision

[Issue #236](https://github.com/LeonEthan/molly-design/issues/236) requests
design-tool parity between New design and New design tab.
`session-detail.tsx`'s `handleSendDraft` supplied `parentSessionId` to
`startSession` without `design`. Landing creation creates the blank canvas and
supplies `design.artworkId` to the same acceptance path. `use-session-actions.ts`
preserves explicitly supplied design metadata; it does not derive artwork
ownership from the parent.

`session-manager.ts` enables `designHooks` only from the child's own durable
design association. `session.ts` derives its design launch identity from that
flag; `agent-client.ts` registers `molly_image` and `molly_browser` only with
that identity. Read reminders, personal memory and the design permission
profile also depend on the gate. Opening the browser panel cannot change the
accepted metadata or the startup decision.

The [Spec](../../../../specs/graphic-design-platform.zh.md) previously described
one main conversation per artwork by default without defining New design tab
ownership. The owner selected shared artwork on 2026-10-24. The new paragraph
records that decision; the owner approved the written revision on 2026-10-24
and the English translation is current.

## Reuse ladder and scope

1. Direct reuse: ordinary child creation already shares the validated parent
   workspace and atomically accepts metadata with the first user message, but
   its caller omitted the design association. Landing creation directly reused
   would instead create an independent artwork, contrary to the owner's decision.
2. Reuse with adaptation (chosen): extract the existing parent context fields
   into `getDraftSessionParentContext` and include the complete `design`
   association. The production tab caller and deterministic acceptance tests
   use that same mapping. This preserves an artwork id different from its
   parent Session id, including continuation sessions.
3. Borrowing another pattern or custom-building is unnecessary. Existing
   `startSession`, design launch gates, artwork-keyed canvas/flush ownership,
   final CAS and conflict/re-read paths cover the required behavior. No daemon
   fallback, protocol, store, paid retry or new concurrency mechanism is added.

Ordinary parents without a design association continue creating ordinary children.
Existing tab metadata is not migrated. New design tabs create neither a blank
artwork nor a copy. The original startup diagnostic used the old malformed
accepted metadata and failed; its retained consumer regression now represents
the association emitted by the fixed producer. The separate producer regression
guards against reintroducing the omission.

## Verification and limits

Based on `origin/main` at `61bf5138`, branch `fix/236-design-tab-tools`.

- Before the fix, the startup diagnostic failed with `expected false to be true`
  at `designHooks`; 74 existing tests passed. The first fixture attempt lacked
  a synthetic connection and was corrected before recording that result.
- The extracted production parent-context mapping initially preserved the bug.
  `use-session-actions.test.ts` then failed for both ordinary design and
  continuation parents because accepted metadata lacked `design`. Adding the
  association made those cases pass; the non-design case stays ordinary.
- Focused verification: 81 component tests and 89 CLI tests pass, including
  draft persistence, first-turn acceptance, design startup, MCP namespace
  registration and browser tool behavior. The new fixtures use fixed input
  timestamps, an unused synthetic credential reference and a spawn-boundary
  rejection; they perform no provider calls, network requests or sleeps.

- `pnpm install --offline --frozen-lockfile` passes using the existing pnpm
  store. `pnpm check` passes, including 257 CLI and 421 component test files,
  Electron tests, typechecking, lint and public/platform boundaries.
- The initial sandboxed full check encountered Unix socket `listen EPERM` in
  existing local IPC tests and was interrupted. The complete rerun with local
  socket permission passes. The uninitialized historical vendor tsconfig emits
  a non-fatal resolution warning; no nested vendor dependencies were installed.
- `pnpm format`, `pnpm run docs status` and `pnpm run docs check` pass. Docs
  report existing AGENTS size warnings and no registered SHA-protected topics.

No native E2E was run.
Suggested native E2E: open an existing design, create a New design tab, select
DeepSeek Flash, ask the Agent to find poster references on Pinterest, and confirm
`mcp__molly_browser__navigate` executes successfully. Compare design namespaces
with a New design session under the same host and connection settings. Verify
the tab still targets the original artwork and preserves its saved content.
