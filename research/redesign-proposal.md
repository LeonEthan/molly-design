# Redesign proposal: MCP, image models and browser automation, in Pi 1.0 idioms

Status: **proposal, research only.** Nothing here is implemented, and nothing here approves a Spec change.
Inputs: [Pi 1.0 design](pi-1.0-design.md) (idioms I1–I10, sources [MCP], [CM], …) and
[current design](current-design.md) (pain points G*, M*, B\*). Visual summary:
[report/mcp-redesign-report.html](../report/mcp-redesign-report.html).

## Thesis

Molly already _runs_ Pi natively: Codemode on, native MCP and tool search, no second MCP client, no
paid retries. What is not yet Pi-native is how Molly **presents** its capabilities to Pi and how it
**models** image generation. Pi 1.0's idiom is: a few small namespaces, each with a one-line
description; tools that return structured data; scripts that compose and filter; and non-chat models
reached as model types rather than tools. The redesign applies that idiom. It does not touch the
parts of Molly that exist for product reasons Pi does not have: the GUI catalog, the vault, the
visible browser, design-asset publication, and the explicit image model.

## Binding constraints applied

From `AGENTS.md`, the [harness Spec](../specs/molly-embedded-pi-harness.md) and module rules:

- **Reuse ladder.** Reuse a component, adapt it, borrow the pattern, and build custom only as a last resort.
  Each area names the rungs it checked.
- **Migration only reduces scope.** Additions need explicit owner confirmation and are listed in §5.
- **No patches or forks of Pi**, no second MCP client, no transport interception (Spec §MCP and paid images).
- **Paid image calls are never retried automatically.** The image model is user-required with no product default.
  Results are assets, not artwork commits.
- **One editable truth.** The workspace catalog stays the only MCP configuration. Pi's `mcp.json` is not used.

---

## A. Generic MCP connections

### Current design (recap)

Workspace Flock catalog rows with per-turn `mcpServerIds` are resolved behind a catalog fence and
sent as ACP `mcpServers` with vault secrets delivered over fd-3. `acpMcpConfig` then calls
`pi.registerMcpServer`, which uses Pi's default `codemode` exposure. `description` exists in
the catalog but is dropped. There is no exposure control, `imageBinding` is dead, and there is no
annotation gate (G1–G7).

### Redesigned approach

1. **Make the catalog row a lossless superset of a Pi `mcpServers` entry.** Add the Pi-native
   presentation fields with Pi's names and semantics: `exposure` (`codemode` | `deferred` | `direct` |
   `hidden`; absent means Pi's default) and `toolExposure` (pattern → exposure). Forward the existing
   `description`. `acpMcpConfig` passes all three through to `registerMcpServer` unchanged, which
   closes G1 and G2. Because ACP's `McpServer` has no such fields, they travel in the existing `_meta` envelope next to
   `mollyConnection`, which the host already parses (`host.ts:113-126`).
2. **Settings presents exposure as "How the Agent reaches this server":** _Through scripts_
   (default, `codemode`), _Search when needed_ (`deferred`), _Always visible_ (`direct`) or _Off for the
   Agent_ (`hidden`). An advanced per-tool list maps to `toolExposure`. An _Import from mcp.json_ paste
   accepts the Claude/Cursor/Pi `mcpServers` shape, as Pi's migration table does ([MCP §Migrate]).
   Secrets still go to the vault.
3. **Delete `imageBinding`.** Old rows are tolerated on read and dropped on the next explicit save,
   following `packages/shared/AGENTS.md` ("Historical rows remain readable until explicitly saved") (G5).
4. **Keep the fence and per-turn selection.** A presentation-field change is a catalog revision,
   so the next turn gets a fresh worker. Changes are rare, and the fence is the simplest correct
   credential boundary (G4 accepted).
5. **Annotations stay advisory.** Molly keeps Pi's no-prompt default (owner decision, 2026-09-30).
   The Settings tool list _shows_ each tool's `readOnlyHint`/`destructiveHint` so the user can choose
   `hidden` for destructive tools. This is user policy, not a runtime gate (G3, by decision).

### Mapping and rationale

| Pi 1.0 concept                    | Molly redesign                                    | Change                                                       | Why                                                                                   |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `mcpServers` entry in `mcp.json`  | Workspace catalog row (`WorkspaceMcpServerMeta`)  | Same field names for `description`/`exposure`/`toolExposure` | One editable truth; lossless import/export with every MCP client                      |
| `pi.registerMcpServer`            | `createAcpMcpExtensions`                          | Pass the three fields                                        | Already reused; adaptation only                                                       |
| `mcp_servers` prompt section      | Gets real one-line summaries                      | Free (Pi renders it)                                         | I2: the model learns servers from this section                                        |
| `/mcp` exposure change            | Settings › MCP control                            | New UI control                                               | GUI equivalent of a Pi primitive                                                      |
| Annotation-based `tool_call` gate | Not adopted; hints shown in Settings              | —                                                            | No-prompt default matches Pi's own default                                            |
| Project trust for `.pi/mcp.json`  | `defaultProjectTrust: never`, no project MCP file | Unchanged                                                    | The workspace catalog replaces project files                                          |
| `mcp-auth.json` OAuth             | Vault + literal headers                           | **Stays different**                                          | Per-epoch profiles would lose sign-ins on rotation. The vault is the credential truth |

Reuse ladder: (1) Pi's `exposure`/`description` semantics reused verbatim; (2) the existing `_meta`
channel and `description` field adapted; (3) Pi's `/mcp` UI pattern borrowed for Settings. No custom
mechanism. Rejected: reading a generated `mcp.json` in the worker. It would create a second configuration truth and
reintroduce project-file trust questions.

---

## B. Image model connections

### Current design (recap)

A machine-scoped image connection (OpenAI Images | DashScope, explicit model, vault key) is exposed as
`molly_generate_image`/`molly_edit_image` on the built-in `molly` MCP server. The tools publish
content-addressed `media/` assets and return JSON text. They are reached through Codemode as
`tools.mcp__molly__molly_generate_image` with a 900 s MCP timeout. Pi's own `models.generateImages()` is
also live in every script and unmanaged (M1–M6).

### Pi idiom and the gap

Pi models image generation as **an `image` model type** registered by a provider (`registerProvider`
with `images`) and run with `models.generateImages()` inside Codemode. Session credentials and session
cost apply, and nothing is saved to disk (I5, I6). Molly cannot adopt this fully on Pi 1.0.0:
**the Codemode `models.generateImages(model, { input })` call accepts no request options**
(`ImagesContext` is `{ input }` only in
[`packages/ai/src/types.ts@v1.0.0`](https://github.com/earendil-works/pi/blob/v1.0.0/packages/ai/src/types.ts)).
Layered design needs `background: "transparent"`, `output_format` and `size`
(`imagegen/SKILL.md` §Tool inputs). Two workarounds were considered and rejected:

- **Model-ID variants per option.** This is combinatorial, and `size` is free-form.
- **Options parsed from prompt text.** This is ambiguous and injection-prone.

### Redesigned approach (two phases)

**Phase B1, now: present the image connection Pi-style, and make it the _only_ image path.**

1. **Own namespace.** Serve the image tools as their own server, `molly_image`, with
   `description: "Generate or edit raster assets with the user's image connection (each call may be billed)"`
   and MCP `instructions` holding today's billing and no-retry mechanics. Scene knowledge stays in the `imagegen` skill.
   The 900 s timeout moves with it, and `molly` (sessions/tasks) returns to Pi's default.
2. **Protocol-neutral tools** `generate` and `edit`. Each has one schema. Protocol-specific refusals happen
   in the server, and a capability descriptor (`describeNamespace` instructions) states which options the
   current connection accepts (M3).
3. **Structured results.** Declare `outputSchema` and return `structuredContent`
   `{ path, absolutePath, sha256, mimeType, width, height, bytes }`. Scripts can already run variants in
   parallel; this replaces parsing JSON text by convention with a typed contract (I4; M5). Annotations: `openWorldHint: true`, `idempotentHint: false`,
   `destructiveHint: false`.
4. **Close the unmanaged path (M1), with a known limit.** The probe (2026-10-03, below) confirmed the
   path: with an OpenRouter connection, `getAvailableOfType("image")` returns 57 built-in image models,
   and Codemode's `models` global calls the same runtime with no extra gate. The fix uses Pi's public
   option `createCodemodeExtension({ models: false })` in the main session
   (`harness-pi/src/mcp.ts`). Scripts then have no `models` global. Molly offers no classifiers, and chat
   models cannot run from scripts [CM], so nothing else is lost. The earlier plan, a chat-only provider
   `models` list, was rejected. It does hide image models in the main runtime, but the host's
   provider-config fence would persist it as a 423 KB `models.json`, and children still see all 57.
   **Limit:** `pi-subagents` children construct Pi's default Codemode (`models: true`), and no published
   setting turns it off. Removing it would need a Molly-authored child extension, which the harness
   boundary forbids ("unmodified published Pi packages"). Recorded as an upstream limitation.
5. **Usage stays honest.** MCP has no usage channel. The result reports "cost unknown" as today, and
   nothing is estimated (M2 deferred to B2).

**Phase B2, when Pi's Codemode supports per-call image options (size, background, output format and mask semantics): model the connection as a Pi image model.**

- A harness inline extension registers provider `molly-image` with one `type: "image"` model: the user's
  explicit model, with `api: "molly-openai-images" | "molly-dashscope"`. Its `images` implementations
  reuse the existing request builders and readers from `apps/cli/src/mcp/image-generation.ts`, relocated
  to a package both the CLI and the harness can import (reuse with adaptation). The key arrives through the
  existing fd-3 grant, and a connection change retires the worker, exactly like model keys.
- Persistence stays Molly's job, because Pi does not save images. `molly_image` keeps a single tool,
  `save` (`{ data, mimeType } → { path, sha256, … }`), reusing `writeGeneratedImageAsset` and the decode limits.
  It also keeps `open` (`{ path } → image block`) so edit scripts can pass workspace images as `input`,
  since scripts cannot read binary files [CM §Call tools].
- Gains: usage flows into session cost (M2), parallel variants are bounded by Pi's four-call limit, image
  errors become data (`stopReason`), and the long MCP timeout disappears (M6).
- This changes the Spec chain "Pi Agent → Pi native MCP → Molly image MCP server → image service". The
  Spec returns to `draft` before B2.

### Mapping and rationale

| Pi 1.0 concept                              | Molly redesign                                          | Change                    | Why                                                                               |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `image` model type, `models.generateImages` | B1: `molly_image` namespace. B2: `molly-image` provider | B1 presentation, B2 model | Codemode lacks options in 1.0.0; adopt Pi's model when it can carry Molly's needs |
| Session credentials for image models        | Separate image connection + vault                       | **Stays different**       | Spec story 8: the image service is independent of the language connection         |
| Built-in OpenRouter image catalog           | Suppressed                                              | Closes M1                 | "User-required model, no product default"                                         |
| "Images are not saved"                      | Content-addressed `media/` publication                  | **Stays different**       | Bento assets must be files with validated bytes                                   |
| `stopReason`/`errorMessage`, no throw       | Error results, no automatic retry                       | Aligned                   | Same as I8                                                                        |
| Usage → session cost                        | B1: unknown. B2: native                                 | Deferred                  | No honest usage channel over MCP                                                  |

Reuse ladder: (1) the existing image server and asset publication are reused in B1; (2) the
request builders are adapted into a Pi provider in B2; (3) Pi's provider pattern is borrowed. Rejected:
a Molly-built image tool inside the worker, which would be a second tool system next to MCP, and an MCP-to-model
bridge, which is the retired-bridge anti-pattern in the Spec.

---

## C. Built-in browser automation

### Current design (recap)

One `molly_browser` tool with a flattened seven-way `kind` union takes this path: MCP → daemon `BrowserHost` queue →
Electron 500 ms poll → in-process official Playwright MCP over CDP on the visible `WebContentsView`.
A direct call returns the whole snapshot (up to 16 KB) or screenshot. Scripts can filter only by regex over
untyped text. Usage mechanics are duplicated between the tool description and a design skill (B1–B5).

### Pi idiom

Pi ships no browser. Its idioms are small composable commands plus an on-demand README (skill)
[NOMCP25], and MCP reached through Codemode so scripts filter large observations [MCP], [NOMCP].

### Redesigned approach

1. **A `molly_browser` namespace of single-purpose tools** replaces the mega-tool: `navigate`,
   `snapshot`, `screenshot`, `click`, `type`, `scroll` and `save_image`. Each has a strict non-union schema, which
   deletes the flat-union workaround (B1). The daemon/Electron command union stays as the internal wire.
2. **Annotations per action:** `snapshot`/`screenshot` have `readOnlyHint`; `navigate` has `openWorldHint`;
   `click`/`type` have `destructiveHint` + `openWorldHint`; `save_image` writes the workspace. These are hints for users and
   future policy, not prompts (A5).
3. **Structured outputs:** `navigate → { url, title }`, `snapshot → { url, title, snapshot, truncated }`,
   `save_image → { path, sha256, width, height }`. `screenshot` keeps its MCP image block, so a script can forward it
   with `image(result.content[1])` only when needed [MCP §Control tool exposure]. This needs more than MCP
   registration: `AgentBrowserReplySchema` (`browser-agent-rpc.ts:79-90`) carries only text or an image today,
   so typed fields must be added across the daemon/Electron reply (adaptation of an existing contract).
   Scripts could already filter text; with types they no longer parse `Page: <url>` headers by regex (B2):

   ```js
   const b = tools;
   await b.mcp__molly_browser__navigate({ url: 'https://example.com/gallery' });
   const { structuredContent: s } = await b.mcp__molly_browser__snapshot({});
   return s.snapshot
     .split('\n')
     .filter((l) => /img .*poster/i.test(l))
     .slice(0, 10);
   ```

4. **One home for the mechanics.** Today they appear in both the tool description (`molly-mcp-server.ts:4148`)
   and the skill. Move them to namespace `instructions`, which Pi keeps out of tool descriptions and serves
   through `describeNamespace()`: refs come from the latest snapshot; re-observe after changes; never repeat an
   uncertain click; password fields need takeover. The `description` becomes "Drive the user's visible Molly
   browser page (design sessions)". The graphic-design skill keeps only the _research method_ (B5).
5. **Exposure** stays `codemode` (Pi default). There is no `direct` tool, so per-turn cost is one prompt line.
6. **Transport unchanged:** the owner-only socket, `BrowserHost` and the in-process Playwright driver are all reused.
   The 500 ms poll is a desktop concern outside this redesign (B3 and B4 accepted for now).

### Mapping and rationale

| Pi 1.0 concept                                       | Molly redesign                      | Change              | Why                                                                                                         |
| ---------------------------------------------------- | ----------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Composable small commands [NOMCP25]                  | Seven single-purpose tools          | Split               | Typed composition without arbitrary code                                                                    |
| Codemode filters large output                        | Snapshot as `structuredContent`     | New contract        | Keeps 16 KB snapshots out of context                                                                        |
| Namespace `instructions` / `describeNamespace`       | Browser mechanics move there        | Moved               | Guidance travels with the tool, outside design-only skills                                                  |
| MCP annotations                                      | Per-action hints                    | New metadata        | Enables user/extension policy later                                                                         |
| Scripts launching their own Chrome with evaluate/CDP | Visible GUI page, finite action set | **Stays different** | User's own session and takeover; no arbitrary JS, CDP or cookie values (`.agents/docs/sessions-browser.md`) |

Reuse ladder: (1) the Playwright MCP driver, `BrowserHost` and socket are reused unchanged; (2) the Molly MCP
surface is adapted by splitting it; (3) Pi namespace/structured-result patterns are borrowed. Rejected:
exposing the upstream Playwright MCP catalog directly. It would bring arbitrary `browser_evaluate` and about 14k
tokens [NOMCP25], and it breaks the finite action boundary. Also rejected: a Pi extension tool in the worker. The worker has no
socket to Electron, and that would add a protocol.

---

## D. Cross-cutting: server topology

Split the built-in `molly` server into three Pi namespaces served by the **same** daemon HTTP host
on distinct paths (stdio fallback: `__internal molly-mcp-server --namespace <n>`):

| Server          | Tools                                                    | Exposure                                                         | Timeout         |
| --------------- | -------------------------------------------------------- | ---------------------------------------------------------------- | --------------- |
| `molly`         | sessions, tasks, design render/resubmit, `mcp_configure` | `codemode`; `toolExposure: { "molly_render_preview": "direct" }` | Pi default      |
| `molly_image`   | `generate`, `edit` (B1); `save`, `open` (B2)             | `codemode`                                                       | 900 s (B1 only) |
| `molly_browser` | seven browser tools                                      | `codemode`                                                       | Pi default      |

`render_preview` becomes `direct` because the design loop is render → `read` PNG. Scripts cannot
pass a file's pixels on, so routing it through Codemode only adds a hop (I1: small, hot tool sets).
Per-request gating (`disable()` when unavailable) is unchanged.

## E. Design-philosophy alignment

| Idiom                                            | Status after redesign                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| I1 default `codemode`, `direct` only when hot    | **Match** (render preview direct)                                                             |
| I2 one-line description + namespace instructions | **Match** (all three built-ins + catalog)                                                     |
| I3 compose and filter in scripts                 | **Match** (structured image/browser results)                                                  |
| I4 structured data for scripts                   | **Match**                                                                                     |
| I5 non-chat models as model types                | **Partial**: B1 presentation; B2 when upstream allows options                                 |
| I6 provider registration for backends            | **Deferred** to B2                                                                            |
| I7 permission = extension over annotations       | **Diverge by decision**: hints shown, no gate (same no-prompt default as Pi)                  |
| I8 never retry tool calls                        | **Match** (already)                                                                           |
| I9 cache-friendly appends                        | **Match** (Pi handles the section; Molly adds no per-turn text)                               |
| I10 minimal, replaceable core                    | **Match**: deletes `imageBinding`, the flat-union workaround and the 900 s timeout on `molly` |

## 5. Additions requiring owner confirmation

1. Catalog fields `exposure` and `toolExposure`, with the Settings control and _Import from mcp.json_.
2. Splitting the built-in server into `molly`, `molly_image` and `molly_browser`.
3. The browser tool split and structured outputs (public tool names change; skills must be updated in the same change).
4. Phase B2 (`molly-image` provider + `save`/`open` tools) and the Spec revision it needs.

Pure reductions that need no new capability: forward `description`, delete `imageBinding`, and suppress Pi's
built-in image models (after the probe).

**Owner decision (2026-10-03):** additions 1–3 approved, and the Q1/Q2 probe approved. Sequencing follows this
proposal (namespace split and browser split as planned), not the smaller Codex sequence in §7. Addition 4
(B2) stays gated on Q4 and a Spec revision. Approval covers the design; each implementation phase still ships as
its own reviewed PR.

## 6. Open questions and verification

| #   | Question                                                                                                        | How to settle                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Are Pi's built-in image models reachable in a Molly worker today (M1)?                                          | **Settled 2026-10-03: yes.** A real SDK runtime configured through `configureModelConnection` with a synthetic key: only the `openrouter` preset exposes image models (57); the other nine presets expose none. Codemode binds `models.getAvailableOfType`/`generateImages` straight to that runtime. No paid call was made.    |
| Q2  | Does an explicit chat-only `models` list hide them without breaking chat, and how should sub-agents be covered? | **Settled 2026-10-03.** Main runtime: hidden, and chat still resolves. A child runtime from the persisted profile: still 57, and the list would be persisted as a 423 KB `models.json`. Adopted instead: `createCodemodeExtension({ models: false })` for the main session. Children remain an upstream limitation (B1 step 4). |
| Q3  | Do non-Pi ACP agents still consume the built-in server's tool names?                                            | **Settled 2026-10-03 (owner): no.** Custom/registry agents are not a product path, so Phase 2 renames tools without aliases.                                                                                                                                                                                                    |
| Q4  | Will Pi add per-call options to Codemode `generateImages`?                                                      | Track upstream. B2 does not wait on a Molly-specific upstream PR (Spec).                                                                                                                                                                                                                                                        |
| Q5  | Does splitting servers change cold-start latency?                                                               | Lazy connect means `codemode` servers do not block the first prompt [MCP]; measure once.                                                                                                                                                                                                                                        |

## 7. Second opinion (advisory, not applied)

A read-only Codex CLI review (`gpt-6-astra`, high reasoning, 2026-10-03) cross-checked the three hardest
decisions. Its factual corrections were verified and applied to this proposal and to
[current-design.md](current-design.md) §5. Its recommendations differ from this proposal and are left
for the owner to decide (decided 2026-10-03 in favour of this proposal; see §5):

| Decision        | This proposal                                                  | Codex recommendation                                                                                                                           | Strongest argument for this proposal                                                                                                        |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Image models    | B1 namespace + suppression now; B2 provider when options exist | Same direction: reuse the image server and defer the provider. Also wants mask semantics preserved before B2                                   | Agreement. B2's gate now explicitly includes masks                                                                                          |
| Server topology | Split into `molly` / `molly_image` / `molly_browser`           | Keep one `molly` server: add description/instructions and use `toolExposure` where justified                                                   | Only separate servers get separate one-line summaries, `instructions` and the image-only 900 s timeout; `toolExposure` cannot provide those |
| Browser         | Seven single-purpose tools                                     | Keep the single tool and command union, and add structured results independently. Seven tools are a defensible but separately approved cleanup | Per-action schemas remove invalid field combinations and allow per-action annotations. The union cannot express either                      |

Both options satisfy the reuse ladder. Codex's version is the smaller migration, and it is the better
fit for "migration only reduces scope" if the owner does not want new public tool names now. A
reasonable sequence is Phase 1 (pure reductions), then structured results on the existing tools, with the
namespace split and browser split as separately confirmed follow-ups.
