# Interrupted run recovery without replay

Status: implemented
Translation: pending

## Abstract

Restart recovery could redispatch an unfinished Molly turn and show a raw run-journal `EEXIST` as an Agent internal error. The journal already prevented another model request. Its atomic dispatch fence now returns a bounded restore diagnostic, and the existing host turn finalizer marks the recovered input failed while retaining conversation and files. Queued inputs stay paused until explicit Continue; the old turn is never automatically retried.

## Decision

The [browser crash investigation](2026-09-28-browser-response-navigation-crash.md)
identified this separate recovery symptom. A durable `processingUserMsgId` alone
cannot prove provider dispatch: the host writes it before the prompt. Rejecting
all such turns would lose accepted inputs that never reached the harness. Reading
the journal again in the host would add a second storage reader and a race.

Keep the existing exclusive journal creation as authority. The adapter translates
only `EEXIST` from `open`, not an unrelated `mkdir` collision, into
`harness_run_already_dispatched`. It leaves the record intact and requests neither
the run credential nor model inference. Stable run identities remain unchanged.
The host uses the existing localized `session_restore_failed` notice, ordinary
failure finalization, and durable `dispatchPause` before releasing the turn owner.
Continue releases queued inputs; it does not replay the failed input.

## Evidence and limits

Before the fix, two actual adapter regression cases surfaced raw `EEXIST` and
the host execution test failed because dispatch was not paused. Afterwards the
ACP adapter suite passes for interrupted and settled fences, a fresh explicit
turn, preserved journal contents, no repeated credential/model requests, and
unrelated storage failures. The host execution/classification suites pass 160
tests, including failed input settlement, assistant finalization, preserved later
input, blocked dispatch while paused, and explicit Continue.

The standard Pi/MCP integration is unchanged. This does not recover an uncertain
remote tool result or prove that an earlier request was unbilled. No user journal
was deleted and no paid request or crash was induced for verification. The
previous required Codex CLI opinion failed before analysis; it was not retried.
