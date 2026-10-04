# Pi 1.0 design: MCP, Codemode and image generation

Research date: 2026-10-03. Scope: how Pi 1.0 connects to MCP servers, what Codemode is,
how image generation is modeled, and the philosophy behind those choices. This is the
external half of the [MCP redesign](redesign-proposal.md); the internal half is the
[current-design audit](current-design.md).

## Sources and version baseline

Molly pins `@earendil-works/pi-coding-agent` **1.0.0** (`pnpm-workspace.yaml` catalog `pi`).
Pi's docs ship in its public source repository, so this note cites the **`v1.0.0` tag**
unless it says otherwise. Upstream `main` was at 1.0.2 on the research date
(commit `200387122ca450d6387f033949423114a270b96c`). Diffing `v1.0.0..main` over the cited
docs showed only additive changes. These are marked **[1.0.1+]** where they matter.

Primary sources:

| ID        | Source                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [REL]     | Pi 1.0.0 release notes — <https://pi.dev/changelog/releases/1.0.0>                                                                       |
| [CHG]     | Pi coding-agent CHANGELOG — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/CHANGELOG.md>                        |
| [ANN]     | Earendil, "Pi 1.0" (2026-10-01) — <https://earendil.com/posts/pi-1-0/>                                                                   |
| [NOMCP]   | Earendil, "You Said No MCP!" (2026-09-29) — <https://earendil.com/posts/you-said-no-mcp/>                                                |
| [MCP]     | MCP Servers doc — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/mcp.md>                                   |
| [CM]      | Codemode doc — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/codemode.md>                                 |
| [CLI]     | CLI doc (tools, Enable codemode) — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/cli.md>                  |
| [SET]     | Settings doc — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/settings.md>                                 |
| [MOD]     | Models doc (classifier/image models) — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/models.md>           |
| [PROV]    | Custom providers doc — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/custom-provider.md>                  |
| [EXT]     | Extensions doc — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/extensions.md>                             |
| [SEC]     | Security doc — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/security.md>                                 |
| [HOW]     | How Pi works — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/how-pi-works.md>                             |
| [MCPSRC]  | MCP extension source — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/extensions/mcp/index.ts>              |
| [IMGSRC]  | Image API registry — <https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/providers/images/register-builtins.ts>            |
| [NOMCP25] | Mario Zechner, "What if you don't need MCP at all?" (2025-11-02) — <https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/> |

Secondary coverage, used only to confirm dates and framing: The Register,
"[Pi coding agent pulls a 180 and adds MCP support](https://www.theregister.com/ai-and-ml/2026/10/02/pi-coding-agent-pulls-a-180-and-adds-mcp-support/5300678)" (2026-10-02).

## 1. Philosophy

Four principles recur across the sources. Each MCP, Codemode and image decision follows from them.

1. **Adopt late, weigh complexity.** "We wait until something has proven itself, and only
   then do we consider adopting it; weighing its true functionality against its inherent
   added complexity." [ANN] Pi rejected MCP until MCP matured, and until supporting it
   brought changes that were "generally useful" beyond MCP itself, such as running the Jev
   classifier [NOMCP].
2. **Context is the scarce resource.** The 2025 argument against MCP was token cost: Playwright
   MCP used about 13.7k tokens and Chrome DevTools MCP about 18k, against about 225 tokens for a
   README plus CLI scripts [NOMCP25]. Pi 1.0 cut Codemode's prompt cost by about 40%. With default tools
   and Codemode active, a GPT-5.6 request shrank from about 5,300 to 3,300 tokens [CHG §1.0.0 Changed].
3. **Composition over tool round-trips.** "The biggest issue with MCP continues to be that it's
   hard to compose" [NOMCP]. With direct MCP, "any output has to go through your agent's
   context" [NOMCP25]. Codemode is Pi's answer: the model writes a script that calls tools, and
   only the script's output reaches the model [CM].
4. **Minimal core, malleable edges.** Extensions, skills and packages provide behavior. Built-in features are
   themselves extensions (`builtin:mcp`, `builtin:codemode`, `builtin:tool-search`) that a
   third-party extension can replace [SET §resources], [MCP §Replace the built-in MCP support].
   Pi assumes no sandbox. Safety comes from OS or VM isolation, not prompts or transcript review [SEC].

## 2. MCP integration

### Configuration surface

- Two JSON files with the same `mcpServers` shape as Claude/Cursor: user `~/.pi/agent/mcp.json`
  and project `.pi/mcp.json`. The project file loads only after **project trust** is granted [MCP §Configure servers], [SEC §project-trust].
- Transports: stdio (`command`, `args`, `env`, `cwd`) and streamable HTTP (`url`, `headers`,
  `oauth`). SSE is rejected [MCP §Configuration rules].
- Per-server fields: `timeout` (seconds, default 60, reset by progress), `enabled`,
  `exposure`, `toolExposure` and `description` [MCP §Configure servers].
- `${VAR}` and `!command` interpolation in `env` and `headers` [MCP §Configuration rules].
- Shell commands (`pi mcp add|remove|list|login|logout`) and an in-session `/mcp` view
  for state, sign-in, reconnect, exposure and enablement [MCP §Quick setup, §Inspect].
- Extensions add session-scoped servers with `pi.registerMcpServer(name, config)`. A
  file-configured server of the same name wins [EXT §MCP servers].
- **[1.0.1+]** A project entry without `command`/`url` overrides only `enabled`,
  `exposure` and `toolExposure` of a user-level server ([main mcp.md](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/docs/mcp.md)).

### Lifecycle

- All enabled servers connect **in the background** at session start. The first prompt waits
  up to 10 s only for servers with `direct` tools. Other servers are awaited lazily, when a
  Codemode script names `mcp__<server>`, calls `searchTools()`/reads `ALL_TOOLS`, or when
  `tool_search` runs [MCP §Diagnose connection problems]. Pi 0.99.2 introduced this so MCP
  servers "stay out of the way" [CHG §0.99.2].
- HTTP 408/429/5xx are retried twice. A dropped connection reconnects on the next call.
  `tools/list_changed` adds or withdraws tools. Stdio shutdown is stdin close → SIGTERM → SIGKILL of the
  process group [MCP §Diagnose].
- Resource reads are retried once. **Tool calls are never retried** "because the server may
  already have performed them" [MCP §Use resources].

### Discovery and tool surfacing (exposure)

Each tool is registered as `mcp__<server>__<tool>`. The server's `exposure`, overridable per tool
by `toolExposure` patterns, decides how the model reaches it [MCP §Control tool exposure]:

| Exposure                 | Declared to model?                           | Reached via                                                                                                | Intended for                                  |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `codemode` **(default)** | No (unless an active `tool_search` loads it) | Codemode scripts (`searchTools`, `describeTool`, `ALL_TOOLS`); also `tool_search` when that tool is active | General servers; scripts combine/filter       |
| `deferred`               | Only after `tool_search` loads it            | `tool_search`, then direct call                                                                            | Large servers called directly after discovery |
| `direct`                 | Yes                                          | Ordinary tool call (also Codemode)                                                                         | Small, frequently used tool sets              |
| `hidden`                 | No                                           | Unreachable                                                                                                | Withdrawn tools                               |

- Servers with `codemode`/`deferred` tools are listed in an `mcp_servers` **system-prompt
  section**, one line each: `- mcp__<name> (codemode): <summary>`. The summary is the first line
  of `description`, or of the server's MCP `instructions` once it connects. Without either,
  the line is the bare name [MCPSRC `renderServersSection`].
- A changed section is _appended_ to the conversation rather than rewriting tool declarations,
  "so earlier messages stay cached" [MCP §Control tool exposure].
- Server `instructions` are never put into tool descriptions. Scripts read them through
  `describeNamespace("mcp__<server>")` [MCP §Control tool exposure].
- Pi turns `codemode` on automatically when a `codemode`-exposed server connects, and
  `tool_search` for `deferred` servers. `autoEnableCodemode: false` disables this [MCP §Control tool exposure].
- Text results over 20 KB are middle-truncated for the model, with the full text written to a temp
  file. Codemode scripts get the complete `CallToolResult` (`content`, `structuredContent`,
  `isError`) [MCP §Control tool exposure].
- Resources become three generic tools: `list_mcp_resources`, `list_mcp_resource_templates`
  and `read_mcp_resource`. MCP Apps (`ui://`) resources are omitted [MCP §Use resources].

### Security model

- **No built-in permission prompts.** "Pi … does not ask for approval before every tool call."
  The boundary is OS, container or VM isolation [SEC].
- Every MCP call goes through Pi's tool pipeline, so extension `tool_call`/`tool_result`
  handlers act as permission gates. Pi exposes server-declared MCP **annotations**
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) through
  `pi.getAllTools()`. The docs include a Codex-equivalent approval policy built on those hints [MCP §Permissions], [EXT §Tool exposure].
- Project trust gates `.pi/mcp.json`, but "does not make that content or the resulting actions
  safe" [SEC §Understand project trust].
- OAuth: dynamic client registration, PKCE, RFC 9728/8414 discovery, RFC 9207 `iss` checks,
  per-server-and-URL token storage in `~/.pi/agent/mcp-auth.json`, and step-up scopes [MCP §Authenticate with OAuth], [REL].
- `"auth": { "provider": "<p>" }` sends a provider's `/login` token as the bearer token. It is allowed only
  in global config or from extensions [CHG §0.99.2 Added].

## 3. Codemode

**What it is.** A tool named `codemode` whose input is raw JavaScript. The script runs as an
async function body in a **QuickJS sandbox** with no Node APIs, file system, network or timers.
It reaches the outside world only through `tools.<name>(args)` and `models` [CM §Scripts].
Globals: `text()`, `image()`, `console`, `return`, `exit()`, `store()/load()` (small JSON
persisted in the session branch), `ALL_TOOLS`, `searchTools()` (BM25), `describeTool()`,
`describeNamespace()` and `models` [CM §Globals].

**When it triggers.** It is off by default. It turns on through `defaultTools: ["+codemode"]`, `--tools` or
automatically when a `codemode`-exposed MCP server connects [CLI §Enable codemode], [MCP §Control tool exposure].
`codemode.mode` decides presentation. `on` (default) keeps declared tools declared and notes how
to script them. `only` hides other tools so the model reaches them only through scripts.
`codemode.inlineBudget` (default 3000 estimated tokens) bounds the inline declarations [SET §tools].

**Relationship to tool use.** Codemode does not replace tools. It _composes_ them:

- Every tool the session can call is a `tools.*` method, and MCP calls resolve to the full `CallToolResult`.
  Tools with `outputSchema` resolve to structured values [CM §Call tools], [EXT §Tool exposure].
- Nested calls are real and pass through the same tool pipeline and gates. They carry the
  Codemode call ID as `parentToolCallId` [MCP §Permissions].
- Output is bounded (`max_output_tokens`, default 10000; the full text spills to a temp file). Tool calls
  made before a failure "are not undone". Unawaited calls are cancelled at script end [CM §Scripts].
- Codemode runs in the harness, not in a tool sandbox. Its state lives in the session transcript
  rather than files, which Earendil presents as the reason it composes cleanly [NOMCP].
- Limits: 256 MB VM, no nested Codemode, and a never-settling await fails immediately [CM §Limits].

**Assumption, stated:** the docs do not say whether `tools.read` on a PNG gives scripts
image data. Per [CM §Call tools], non-MCP tools without an output schema "resolve to their text
output", so this note assumes **scripts cannot load workspace image bytes through `read`**.

## 4. Image generation

Pi models image generation as **a model type reached through Codemode**. It is not a tool and not
an MCP server.

- The catalog has three model types: `chat`, `image` and `classifier`. Image and classifier models
  "do not appear in `/model`; the model reaches them through the `codemode` tool" [MOD §Use image models].
- API: `models.getAvailableOfType("image")` and `models.generateImages(model, { input })`. `input` holds
  text and image blocks (base64) for generation, editing and references. The result has `output` blocks, `usage`,
  and `stopReason`/`errorMessage`. It **does not throw on provider errors** [CM §Models].
- Credentials are the session's own. OpenRouter image models use the same `OPENROUTER_API_KEY`
  or `/login` credential as its chat models [MOD §Use image models], [REL].
- Usage is added to the Codemode result and **counts toward the session cost**. At most four
  `classify`/`generateImages` calls run at once per script [CM §Models].
- "Generated images are not saved to disk. To keep one, write it to a file with a tool." `image(block)`
  attaches the image to the result for the model to see [CM §Generate images].
- **No per-call options.** The documented Codemode context is `{ input }` only, and Codemode supplies the request options itself. Its validator checks `input` but returns the original object, so extra properties _would_ reach a custom provider. That is undocumented passthrough, not a supported contract, and this note does not rely on it ([`codemode/execute.ts@v1.0.0`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/extensions/codemode/execute.ts), `checkImagesContext`).
- Built-in image API in 1.0.0: `openrouter-images` only [IMGSRC]. **Extensibility:** an extension
  calls `pi.registerProvider(name, { models: [{ type: "image", api: "<api>", … }], images:
{ "<api>": { generateImages } } })` to add any image backend [PROV]. Supplying `models` in this form replaces the provider's whole catalog across chat, image and classifier operations [PROV]. `models.json` entries, by contrast, add or override individual models ([`provider-composer.ts@v1.0.0`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/provider-composer.ts)). Extensions can call
  `ctx.modelRegistry.generateImages()` without Codemode [MOD §Use image models].

## 5. Browser automation (absence is the design)

Pi 1.0 ships **no browser capability**. A search of the `v1.0.0` docs found "browser" only in
OAuth sign-in contexts. Pi's established idiom for browsing is the [NOMCP25] pattern: a few
small CLI scripts (start Chrome, navigate, evaluate JS, screenshot) plus a short README that
the agent reads on demand. Pi packages this as a skill
([skills doc](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/skills.md)).
With 1.0, a browser MCP server is also legitimate, provided it is reached through Codemode or `deferred`
exposure so its large snapshots are filtered in scripts rather than streamed into context.

**Assumption, stated:** Earendil has not published browser guidance for 1.0. Treating
"skill + scripts" and "Codemode-exposed MCP" as Pi's two browser idioms is this note's inference
from [NOMCP25], [NOMCP] and [MCP].

## 6. Summary of Pi idioms used in the redesign

| #   | Pi idiom                                                                                                                         | Evidence       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| I1  | Default MCP exposure is `codemode`; `direct` only for small, hot tool sets                                                       | [MCP]          |
| I2  | Every server carries a one-line `description`; longer guidance goes in namespace `instructions` read through `describeNamespace` | [MCP], [EXT]   |
| I3  | Scripts compose and filter; only the script output enters context                                                                | [CM], [NOMCP]  |
| I4  | Tools return structured data (`outputSchema`/`structuredContent`) for scripts                                                    | [EXT], [NOMCP] |
| I5  | Non-chat models (image, classifier) are catalog entries run through `models.*`, with session credentials and session cost        | [MOD], [CM]    |
| I6  | New model backends are provider registrations (`registerProvider` with `images`)                                                 | [PROV]         |
| I7  | Permission policy is an extension that reads MCP annotations; there is no built-in prompt                                        | [SEC], [EXT]   |
| I8  | Never retry tool calls automatically; failures are data (`stopReason`, `isError`)                                                | [MCP], [CM]    |
| I9  | Prefer append-only context changes that keep the prompt cache                                                                    | [MCP], [CHG]   |
| I10 | Built-ins are replaceable extensions; adopt late; keep the core minimal                                                          | [ANN], [SET]   |
