# Verify Molly with DeepSeek Flash

Status: implemented
Translation: pending
PR: https://github.com/LeonEthan/molly-design/pull/211

## Abstract

Molly testing and verification that calls DeepSeek must select DeepSeek Flash and
must not select DeepSeek Pro. Pro has no multimodal support, so a Pro session
cannot read design images or other visual evidence. The product may still offer
Pro in the model catalog and may still seed a new DeepSeek Harness session with
`deepseek-v4-pro`; this rule binds the verification run, not that catalog or
seed. Deterministic tests keep using fixtures and do not call either model.

## Decision

Select `deepseek-v4-flash` on DeepSeek Harness, or `deepseek-flash` on a
compatible connection, before a live check, acceptance run, or manual prompt.
Do not select `deepseek-v4-pro` or another Pro id for those runs. The authorized
Kimi golden lane in `e2e/AGENTS.md` is unchanged; this rule chooses between
DeepSeek models.

The binding sentence lives in root `AGENTS.md` because every contributor and
agent reads it before testing. A new instruction scope was unnecessary. Changing
the Harness profile seed, the adapter fallback, or the delegation warning was
rejected: those defaults are product behavior for user sessions, and this rule
does not ask verification to rewrite them. A run that leaves the seed on Pro
does not satisfy the rule.

Image admission stays with the selected model's metadata. The checked-in DSH
catalog fixture marks `deepseek-v4-flash` and `deepseek-v4-pro` as text-only and
`deepseek-v4-flash-vision-exp` as experimental image input. That fixture is not
a reason to verify on Pro. It is also not a requirement to switch verification
to the experimental id; the team named Flash.

## Prior practice

Live checks already pinned Flash rather than Pro: the 2026-10-17 host-prompt
note used `deepseek-flash`, and the 2026-10-18 embedded-run note used DeepSeek
V4.1 Flash. This record makes that choice mandatory.

- [Session host prompt](../bug-fix/2026-10-17-session-stable-host-prompt.md)
- [Embedded run contract](../architecture/2026-10-18-embedded-run-contract.md)
