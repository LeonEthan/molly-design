# Current design: MCP, image models and browser automation

Audit date: 2026-10-03, at `main` `a5740c08`. Every claim cites the code. Docs are
cited only where they record an intentional decision. Line numbers refer to that commit.
External Pi facts are in [pi-1.0-design.md](pi-1.0-design.md) (IDs in brackets such as [MCP]).

The M1 image-route and profile-credential observations below are historical: #71 disabled the main-session Codemode models, and [#72](https://github.com/LeonEthan/molly-design/issues/72) retires the child extension and its credential publication. Current evidence is in the [retirement record](../.agents/notes/implemented/simplification/2026-10-04-remove-pi-subagents.zh.md).

## 0. Shared runtime context

- **Engine.** The product Agent is unmodified Pi `@earendil-works/pi-coding-agent` 1.0.0
  embedded behind an ACP adapter (`packages/harness-pi/README.md` §intro; catalog pin in
  `pnpm-workspace.yaml:53-57`). Each worker uses a private profile under
  `<molly-data>/harness/pi/config/workers/<sha256(runtimeEpoch)>` and never reads `~/.pi/agent`.
- **Codemode is already on.** The managed profile writes `defaultTools: ['+codemode']`,
  `codemode: { mode: 'on' }` and `defaultProjectTrust: 'never'`
  (`packages/harness-pi/src/profile-settings.ts:51-53`).
- **Molly has no permission prompts.** "Tools run without permission checks"
  (`packages/harness-pi/README.md` §Pi profile). The `cc-safety-net` package is the
  deterministic floor for destructive commands.
- **Credential channel.** Protected values reach the worker over a private fd-3 pipe. MCP
  header/env secrets arrive **once per worker**, before session creation
  (`packages/harness-pi/src/host.ts:110-148`). Model keys arrive **per run**, and a changed key is
  rejected so the worker retires (`host.ts:379-398`).

```
Electron (renderer Settings, main vault, WebContentsView browser)
   │  owner-only local control socket (machine RPC)
CLI daemon (session dispatch, Molly MCP HTTP host, BrowserHost queue, design services)
   │  ACP (stdio) + fd-3 private grants
Pi worker (harness-pi: ACP adapter → Pi SDK → native MCP / Codemode / tool_search)
   │  MCP (stdio or streamable HTTP)
MCP servers: built-in "molly" server  +  user-selected workspace servers
```

## 1. Generic MCP connections

### Architecture and data flow

1. **Catalog (one editable truth).** Workspace MCP entries are rows in the workspace Flock
   document, typed `WorkspaceMcpServerMeta`: `id`, `revision`, `name`, `transport`,
   `description`, `connection`, `imageBinding`, `enabledByDefault`
   (`packages/shared/src/workspace-mcp.ts:39-54`). Transports are stdio and HTTP only; SSE is
   excluded (`workspace-mcp.ts:6-13`). The shared contract allows exactly two durable layers:
   catalog rows and the selected ids in each user turn's input config
   (`packages/shared/AGENTS.md` §Workspace MCP).
2. **Authoring.** Settings › MCP (`packages/components/src/components/settings/mcp-setting.tsx`,
   `mcp-connection-form.tsx`, `mcp-credential-save.ts`). Secrets go into the main-process vault
   as `protectedCredentials: { credentialRef, revision }` (`workspace-mcp.ts:16`). The Agent can
   _add_ entries through `molly_mcp_configure`. It never selects or updates them, and credentials
   must be `${VAR}`/passthrough references (`apps/cli/src/mcp/molly-mcp-server.ts:4188-4194`,
   `apps/cli/src/mcp/workspace-mcp-configure.ts`, `apps/cli/src/mcp/AGENTS.md`).
3. **Selection.** New sessions default to rows with `enabledByDefault`
   (`workspace-mcp.ts:474-477`). Each turn freezes `mcpServerIds`, and `[]` is an explicit empty selection.
4. **Resolution.** `loadSessionMcpCatalog` syncs (5 s budget), reads the Flock doc, and in
   guarded (embedded) mode installs a **catalog fence**: any change to a selected row
   invalidates the worker. It also rejects rows without a revision and raw credentials in ACP data
   (`apps/cli/src/agent/session-mcp-resolver.ts:68-140`).
5. **Assembly.** `buildMcpServers` prepends the built-in `molly` server, tagged
   `MOLLY_BUILTIN_MCP_CONNECTION` for the embedded Molly agent, to the selected external servers
   (`apps/cli/src/agent/agent-client.ts:951-994`).
6. **Worker.** `PiAcpHost` checks bindings and reads the fd-3 credential grant. It sets
   native `timeout = 900` s only for the built-in server
   (`packages/harness-pi/src/host.ts:110-148`). `acpMcpConfig` converts ACP servers to Pi
   configs: it rejects `~` paths, splices vault values into `env`/`headers`, and escapes `$`/`!` so
   values stay literal (`packages/harness-pi/src/mcp.ts:36-107`).
7. **Pi native.** `createAcpMcpExtensions` loads Pi's `createCodemodeExtension`,
   `createToolSearchExtension` and `createMcpExtension`. It registers each server with
   `pi.registerMcpServer(name, config)` and loads no `mcp.json` (`mcp.ts:149-165`).
   `rejectAmbientMcp` refuses a second MCP stack such as `pi-mcp-adapter` (`mcp.ts:130-147`).

### Config surface reaching Pi

Per server, Pi receives only `command/args/cwd/env` or `type/url/headers`, plus `timeout`
for `molly` (`mcp.ts:71-103`, `host.ts:141-143`). **No `exposure`, `toolExposure` or
`description` is passed.** Pi therefore applies its default `codemode` exposure to every
server, including Molly's own tools [MCP §Control tool exposure].

### Known pain points

| #   | Pain point                                                                                                                                                                                                   | Evidence                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | The catalog's `description` never reaches Pi, so the `mcp_servers` prompt section shows a bare `- mcp__<name> (codemode)` line unless the server sends MCP `instructions`.                                   | Field exists at `workspace-mcp.ts:46`; not mapped in `mcp.ts:71-103`; Pi summary logic [MCPSRC `serverSummary`].                                                               |
| G2  | Exposure cannot be set per server or tool. Small, hot servers cannot be `direct`, and destructive tools cannot be `hidden`.                                                                                  | Same as G1; Pi fields [MCP].                                                                                                                                                   |
| G3  | MCP annotations (`readOnlyHint`, `destructiveHint`, …) go unused because the profile runs with no permission checks. `cc-safety-net` guards shell commands, not MCP calls.                                   | `harness-pi/README.md` §Pi profile; Pi gate idiom [EXT §Tool exposure]. Intentional decision recorded in `.agents/notes/proposed/architecture/2026-10-01-pi-native-addons.md`. |
| G4  | Any change to the selected catalog retires the worker (fence), and so does a change of selection between turns. This costs Pi's warm MCP connections and prompt cache, though it is correct for credentials. | `session-mcp-resolver.ts:92-110`; `standard-pi-mcp-integration.md` §Decision ("catalog or credential revision changes retire the worker").                                     |
| G5  | A dead legacy field: `imageBinding` (tool-field mapping for external image MCPs) is still validated and round-tripped by Settings, but nothing executes it.                                                  | `workspace-mcp.ts:49,60,72,195`; `mcp-setting.tsx:84`; retirement recorded in `.agents/notes/implemented/simplification/2026-09-28-standard-pi-mcp-integration.md`.            |
| G6  | No GUI path to Pi-native OAuth. HTTP credentials are literal vault headers. Pi's native OAuth state would live in a per-epoch profile and not survive worker rotation.                                       | `harness-pi/README.md` §ACP adapter ("Pi may use its normal OAuth fallback after a 401"); profile path §Pi profile.                                                            |
| G7  | Known upstream leak: a server still starting during shutdown can outlive it (Pi #10249).                                                                                                                     | `harness-pi/README.md` §ACP adapter.                                                                                                                                           |

## 2. Image model connections

### Architecture and data flow

1. **Connection (machine-scoped, separate from the language model).** A machine Flock row
   `imageConnection` stores `protocol ∈ {openai-images, dashscope}`, base URL and an **explicit
   model**. The key lives in the vault (`packages/shared/src/image-connection.ts:44-102`;
   reader `apps/cli/src/design/image-connection.ts:54-63`). Settings UI:
   `packages/components/src/components/settings/image-connection-setting.tsx`. There is no
   product default model (`packages/shared/AGENTS.md` §Image connection RPC).
2. **Surface.** Two MCP tools on the built-in `molly` server, `molly_generate_image` and
   `molly_edit_image` (`molly-mcp-server.ts:4043-4064`). Their input schemas switch to DashScope
   variants when the connection protocol is DashScope (`molly-mcp-server.ts:4042`).
3. **Gating.** The tools are registered unconditionally, then `disable()`d unless this is a design
   session with a ready connection, so they are absent from `tools/list`
   (`molly-mcp-server.ts:5104-5114`). The HTTP host resolves the gate per request
   (`apps/cli/src/mcp/molly-mcp-http-host.ts:315-330`). Each call re-resolves the gate and
   acquires the credential just in time (`molly-mcp-server.ts:3971-3998`).
4. **Execution.** `generateImageAsset`/`editImageAsset` build the protocol request, call the
   service with a 180 s **per-request** timeout (the POST and any result-URL download are separate requests) and no retry, decode with `sharp` under edge/pixel limits, and
   **publish a content-addressed file** under the artwork's `media/`
   (`apps/cli/src/mcp/image-generation.ts:1-80,143,399,643`). The result is JSON text with
   `path`, `absolutePath`, `sha256`, dimensions and bytes. The asset may be PNG, JPEG or GIF. The Agent then reads it with
   `read` (`molly-mcp-server.ts:4020-4030`).
5. **How the model reaches it today.** `molly` has default `codemode` exposure (§1), so
   the Agent calls `tools.mcp__molly__molly_generate_image(...)` from a Codemode script. The
   integration test asserts exactly this
   (`apps/cli/src/mcp/codemode-image-design.test.ts:84-85,250-276`).
6. **Guidance.** The `imagegen` skill documents inputs, billing and "if the tool is absent"
   (`packages/design-authoring/skills/imagegen/SKILL.md`).

### Known pain points

| #   | Pain point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **Two image paths, one unmanaged.** With Codemode on, Pi's native `models.generateImages()` is present in every script. For a preset connection such as OpenRouter, Molly registers no explicit `models` list, so Pi's built-in image catalog for that provider stays registered and uses the same key; `connection.models` narrows only chat selection. Molly's "user-selected image model, no default" rule is enforced only on the MCP tools. _Unverified:_ whether `getAvailableOfType("image")` actually returns models in a Molly worker needs a probe. | `profile-settings.ts:51-53`; `harness-pi/src/model-connection.ts:24-60` (explicit `models` only for `openai-compatible`); key in profile `auth.json` (`harness-pi/README.md` §Credentials); [MOD §Use image models]. |
| M2  | Image spend is invisible to session cost. The MCP result carries no `usage`, while Pi's `generateImages` usage would count toward session cost.                                                                                                                                                                                                                                                                                                                                                                                                               | `molly-mcp-server.ts:4020-4030`; `harness-pi/src/usage.ts` projects native usage only; [CM §Models].                                                                                                                 |
| M3  | Protocol knowledge leaks into tool schemas: each protocol has its own input schema, and the skill must explain both.                                                                                                                                                                                                                                                                                                                                                                                                                                          | `molly-mcp-server.ts:4042-4064`; `imagegen/SKILL.md` §Tool inputs.                                                                                                                                                   |
| M4  | Skills say "if the tool is not in your tool list", but under `codemode` exposure Molly tools are not declared. They are reachable from scripts, or declared only after an active `tool_search` loads them, and Molly's profile enables `codemode`, not `tool_search`. The model learns of them from a bare `mcp__molly (codemode)` line (G1).                                                                                                                                                                                                                 | `imagegen/SKILL.md` §Availability; `graphic-design/references/browser-research.md`; `profile-settings.ts:51`; [MCP §Control tool exposure].                                                                          |
| M5  | Scripts can already run variants in parallel and receive the full MCP result, but the result is JSON _text_ with no `outputSchema`, so every script must `JSON.parse` `content[0].text` by convention. The gap is typing, not capability.                                                                                                                                                                                                                                                                                                                     | `molly-mcp-server.ts:4020-4030` returns `jsonTextResult`; [CM §Call tools].                                                                                                                                          |
| M6  | A long MCP timeout (900 s) was needed so slow paid calls don't hit Pi's 60 s default. This works around the transport, not the domain.                                                                                                                                                                                                                                                                                                                                                                                                                        | `host.ts:141-143`; `harness-pi/README.md` §ACP adapter.                                                                                                                                                              |

## 3. Built-in browser automation

### Architecture and data flow

1. **Engine.** The user's visible Electron `WebContentsView` (`public-browser-service.ts`),
   using the user's Chromium session and network (`.agents/docs/sessions-browser.md`).
2. **Driver.** The official `@playwright/mcp` server runs **in Electron main**, connected over an
   `InMemoryTransport` and a CDP adapter bound to that one WebContents. A host allowlist admits six
   upstream tools, and snapshot text is extracted and capped at 16 000 characters
   (`apps/electron/src/main/services/browser-mcp-driver.ts:15-22,38-48,88-125`;
   `browser-cdp-connection.ts`).
3. **Hand-off.** Electron **polls** the daemon over the owner-only socket every 500 ms
   (`browser/host`) to collect work and report results
   (`public-browser-agent-host-service.ts:17-82`; constants `packages/shared/src/browser-agent-rpc.ts:4-6`).
   The daemon's `BrowserHost` queues at most 8 operations, binds each to the active run, and
   tracks revocation and timeouts (`apps/cli/src/browser/browser-host.ts:13-148`).
4. **Agent surface.** One MCP tool, `molly_browser`, takes a flat object with a required `kind`
   (navigate, snapshot, screenshot, click, type, save_image, scroll). The handler revalidates the strict
   discriminated union (`browser-agent-rpc.ts:14-60`; `molly-mcp-server.ts:4143-4186`).
   The flat shape exists because "the OpenAI-compatible adapter erases top-level JSON Schema
   unions" (`.agents/docs/sessions-browser.md`). The CLI client issues `browser/execute`, and
   `browser/cancel` on abort (`apps/cli/src/mcp/browser-tools.ts:14-105`).
5. **Gating.** The tool is available only for an active local design run with a polling desktop
   (`molly-mcp-server.ts:5122-5124`; `apps/cli/src/mcp/AGENTS.md`).
6. **Guidance.** `graphic-design/references/browser-research.md` (observe → act → re-observe).

### Known pain points

| #   | Pain point                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B1  | **A polymorphic mega-tool.** One tool with seven behaviors and a flattened schema that admits invalid field combinations until the handler revalidates. Annotations cannot differ by action (snapshot is read-only, click may be destructive), and results are untyped text or an image.                                     | `browser-agent-rpc.ts:14-60`; `molly-mcp-server.ts:4143-4186`.                                             |
| B2  | **Context cost by default.** A direct call puts the whole snapshot (up to 16 KB) or screenshot into context. Scripts _can_ already filter, but only by regex over the snapshot text: the `Page: <url>\n<snapshot>` reply has no typed fields. Adding them requires changing the RPC reply schema, not just MCP registration. | `browser-mcp-driver.ts:38-48`; `public-browser-agent-controller.ts:250-251`; `browser-agent-rpc.ts:79-90`. |
| B3  | **Three hops plus polling.** MCP → daemon queue → 500 ms Electron poll → in-process Playwright MCP. Each layer re-implements timeouts and cancellation (45 s host, 50 s RPC).                                                                                                                                                | `browser-agent-rpc.ts:4-6`; `browser-tools.ts:50-70`; `browser-host.ts:47-66`.                             |
| B4  | **Nested MCP.** An MCP server (`molly`) wraps another MCP server (Playwright) whose catalog is hidden behind an allowlist. This is two MCP vocabularies for one capability.                                                                                                                                                  | `browser-mcp-driver.ts:13-22`.                                                                             |
| B5  | Usage mechanics (latest-snapshot refs, re-observe, takeover, authorization) are **duplicated**: they appear in the tool description and again in a design-only skill reference. That costs tokens wherever the tool is declared, and the two copies can drift.                                                               | `molly-mcp-server.ts:4148`; `graphic-design/references/browser-research.md`.                               |

## 4. Cross-cutting observations

- **Already Pi-native:** Codemode on, native MCP/tool_search, no `mcp.json`, no second MCP
  client, no automatic paid retries, `defaultProjectTrust: never`. The 2026-09-28 → 2026-10-01
  migration removed the bridge, journal and image mapping
  (`.agents/notes/implemented/simplification/2026-09-28-standard-pi-mcp-integration.md`;
  `specs/molly-embedded-pi-harness.md` §MCP and paid images).
- **Not yet Pi-native:** how Molly's own capabilities are _presented_ to Pi (exposure,
  description, namespaces, structured outputs, annotations), and how image models are
  _modeled_ (an MCP tool rather than a model type).

## 5. Review record

A read-only Codex CLI second opinion (`gpt-6-astra`, high reasoning) reviewed this audit on 2026-10-03.
It confirmed that servers are registered without `exposure`/`description`, and that Codemode's documented
`generateImages` context is `{ input }`. Its factual corrections were checked against the code and applied:
credential timing (§0), the per-request image timeout and output formats (§2), and M1, M4, M5, B1, B2 and B5.
Its design recommendations are advisory and recorded in the proposal (§7), not applied.
