# Image MCP client deadlines

Status: implemented
Translation: pending

## Abstract

The image service allows 180 seconds per request, but the MCP SDK defaults to 60 seconds. A real Kimi image call returned a client timeout while its already-approved image request continued and saved an image later. Pi's Folio extension used the same SDK default. The bounded correction gives Pi generation/edit calls 210 seconds through existing request options, retaining cancellation and the render default; Kimi design launches use its public environment default while preserving explicit user environment/file settings. Installed synthetic Kimi and Pi calls now both complete beyond 60 seconds; their scoped deadline result does not erase later probe failures or establish paid-provider reliability.

## Evidence and scope

The normal 50ddd41 installation's synthetic-language/real-image recovery round `CmIQPg` approved `image_3` at 05:07:42 on 2026-09-12. Its correlated native result reported MCP -32001 at 05:08:42; the same owned session saved the recovered PNG at 05:08:56. The probe also had an independent duplicate-permission-handler failure, which must not be attributed to product code. The earlier requests and failed exits remain historical evidence; no generation is repeated for diagnosis.

`image-generation.ts` bounds HTTP work at 180 seconds. SDK 1.29 `shared/protocol.js` defaults requests to 60000 ms when no timeout is supplied. Both Pi extension transport branches supplied only the original abort signal. Generation and edit now supply 210000 ms, allowing 30 seconds for MCP delivery, without extending the upstream HTTP deadline or adding retries. Render retains its default.

Pinned Kimi exposes `KIMI_MCP_TOOL_TIMEOUT_MS` and `[mcp].tool_timeout_ms`; its per-server setting takes precedence. A private acceptance profile can use the public environment setting without modifying the managed artifact. The builtin design launch reads only the timeout field with public smol-toml 1.6.1, the same parser version used by the pinned runtime. The child HOME or explicit KIMI_CODE_HOME locates config.toml; a relative home is resolved against the child workdir. Explicit environment or file settings win, including invalid values left for native validation. Read/parse failures leave the environment unchanged and never log parser text. The pinned ACP host exposes a programmatic configPath, but Folio’s managed CLI launch does not expose a config-file argument; no new path convention is introduced.

## Verification

The Kimi setting is the native global MCP default for the design session, so it also affects non-image tools without a per-server override. Only Pi limits this correction to generation/edit and retains the render default. This broader Kimi scope avoids introducing another transport adapter or patching the runtime.

Deterministic SDK transport tests advance an injected fake clock through 180 seconds and accept actual generation/edit results; cancellation continues through the original AbortSignal. No real image requests are part of these tests. Nine configuration tests cover missing, explicit, relocated, invalid and unreadable settings; five actual Session spawn-boundary tests verify the constructed environment and non-design/provider isolation. No runtime patches, paid retries, or publication are included.

Normal macOS arm64 package source
`5d03ea7e58acb1095fe6d1c3e8fbe006bbc6da58` supplies installed synthetic
deadline evidence. Kimi, with no explicit timeout in its isolated configuration,
completed one held edit after 81.87 seconds and delivered four exact native image
reads (`folio-t28-kimi-input-8qcYQI`, handle 65307, exit 0). Pi completed held
generation and edit calls after 100.71 and 78.461 seconds and delivered both
native image reads (`folio-t28-kimi-input-WBKcu7`, handle 55919). The latter full
runner exited one because its later cancel-stage locator never found the in-session
control; that unrelated fixture failure is retained and the cancellation stage did
not run. The completed calls nonetheless cross the old 60-second SDK boundary and
establish this correction's installed timeout behavior for those exact combinations.

The later corrected package `47c0808` separately verifies Pi request cancellation
before fixture cleanup; see the [request cancellation record](2026-09-12-image-mcp-request-cancellation.md).
That fast cancel-only request adds no new long-deadline result. Neither installed
round repeats the two failed real-image receipts, and no automatic paid retry is
authorized or needed.

The combined 19 focused tests, CLI type check, full repository check (including public boundary), formatting and documentation checks passed. The full check used child-only filtering of inherited Claude routing/auth environment, without changing global settings. Those source checks remain distinct from the scoped installed results above; neither closes the five-Agent matrix or human visual acceptance.
