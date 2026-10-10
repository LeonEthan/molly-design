# 模型能力字段的业内推断方法（/models 之外的字段）

核查日期：2026-10-10。背景：桌面 AI 应用对每个 OpenAI 兼容模型需要 thinking 级别、max_tokens 字段名、streaming usage 支持、tool calling、图像输入等字段，这些通常不在 `/v1/models` 响应里。本文件核查开源 AI 客户端（Cherry Studio、LobeChat、OpenCode、Continue、Cline、Roo Code、LibreChat）的实际机制。

所有 GitHub 链接均指向核查当日 main 分支 commit 或文件页面。本地核查通过浅克隆（`git clone --depth 1`）完成，commit SHA：

- CherryHQ/cherry-studio `1cceda97119a18146ba78a35eab45189612b15cc`
- lobehub/lobe-chat `6c7a6fb033e443bc27bf34cbd5509ab3db7f22f3`
- sst/opencode (dev 分支) `055d95bb7e278c94baf06235a52cac79dd13ba67`
- continuedev/continue `5522c6f44ca0ac3528b37244818fbfa39b5af470`
- cline/cline `bf71bf7cd9fe6816972d7ae5ca5ff0e04e63f87d`
- RooVetGit/Roo-Code `b867ec9145750d0ae1ff7f02d35406e9bf2a0b16`
- danny-avila/LibreChat `e1dfc10449ff713faffacd60273fddcfe2c0a698`

---

## 1. 四类推断方法总览

### A. 试探请求（probe request）

发一个最小 chat completion（如 `system: 'test', prompt: 'hi'`），看是否报错。

**实际证据：Cherry Studio 的「模型健康检查」就是这么做的**。

`src/main/ai/AiService.ts:1379` `checkModel()` 对 chat 模型执行：

```ts
probe = this.generateText({
  ...probeRequest,
  conversation: { id: `check:${randomUUID()}` },
  system: 'test',
  prompt: 'hi',
  reasoningEffort: 'none'
})
```

（https://github.com/CherryHQ/cherry-studio/blob/main/src/main/ai/AiService.ts）

渲染层入口：`src/renderer/pages/settings/ProviderSettings/utils/healthCheck.ts` 的 `checkApi()`，经 IPC `ai.provider.model.check` 调用主进程，默认超时 15000ms，多 API key 时逐 key 探测（`checkModelWithMultipleKeys`）。探测粒度按端点类型分派：rerank 模型发最小 rerank（`query: 'test', documents: ['test'], topN: 1`）、embedding 模型发 `embedMany(['test'])`、纯图像生成模型走图像端点并立即 `transport.cancel(taskId)` 以避免完整生成。

**关键局限：该探测只验证「这个模型+key 能不能用」（连通性/计费/延迟），不判定 thinking 级别、tool calling、图像输入等能力**。代码里没有任何「带 tools 探测一次看是否 400」的逻辑。且对会烧钱的模型主动跳过——`healthCheck.ts` 的 `getModelHealthCheckSkipReason()`：图像/视频/音频生成模型标记 `generation_cost` 跳过；TTS/STT 标记 `unsupported_probe` 跳过。探测本身以最小化计费的注释为指导（「thinking tokens would pollute it」→ 强制 `reasoningEffort: 'none'`）。

**其他产品**：LobeChat、OpenCode、Continue、Cline、Roo Code 源码中均**未找到**「发探测请求推断能力」的证据（LobeChat 的 `checkModel` 只是 aiProvider 表里的一个用户配置字段，记录用哪个模型测连接，非能力探测）。OpenCode 的 zen 代理和 openai-compatible 插件也只是无条件加 `stream_options.include_usage`，不做特性探测。

**代价**（依据 Cherry Studio 实现归纳）：每个模型一次真实 chat completion（通常输入 2-3 token，输出默认若干 token），图像模型要起一次生成任务再取消；对付费 provider 有真实计费；多 key 轮换时探测数×key 数。

### B. 启发式（模型名正则/规则）

**真实项目的规则示例：**

**Continue**（`core/llm/llms/OpenAI.ts:221`）——max_tokens 字段名的判定：

```ts
public isOSeriesOrGpt5PlusModel(model?: string): boolean {
  return !!model && (!!model.match(/^o[0-9]+/) || !!model.match(/gpt-[5-9]/));
}
```

命中则 `max_tokens` → `max_completion_tokens`（`OpenAI.ts:288-292`、`444-447`），并对 o1 强制 `stream = false`。
https://github.com/continuedev/continue/blob/main/core/llm/llms/OpenAI.ts

**Cherry Studio**（`packages/ai-sdk-provider/src/reasoningModelTransform.ts`）——同样字段的判定：

```ts
export function isOpenAIReasoningModelId(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return (
    id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4-mini') ||
    id.startsWith('gpt-6') || (id.startsWith('gpt-5') && !id.startsWith('gpt-5-chat'))
  )
}
```
https://github.com/CherryHQ/cherry-studio/blob/main/packages/ai-sdk-provider/src/reasoningModelTransform.ts

thinking 级别的启发式在 `packages/provider-registry/src/creators/openai.ts:30-39`，是逐 SKU 的正则表：

```ts
{ pattern: '^gpt-6[.-]1-sol(?:$|-)', effort: ['low','medium','high','xhigh','max'] },
{ pattern: '^(?:o\\d|gpt).*deep[-_]?research', effort: ['medium'] },
{ pattern: '^gpt-5[.-]1-codex-max', effort: ['medium','high','xhigh'] },
{ pattern: '^gpt-5[.-]1(?!\\d)(?!.*chat)', effort: ['none','low','medium','high'] },
{ pattern: '^gpt-5-pro', effort: ['high'] },
```
https://github.com/CherryHQ/cherry-studio/blob/main/packages/provider-registry/src/creators/openai.ts

厂商识别集中在 `packages/provider-registry/src/patterns`（`VENDOR_PATTERNS.anthropic/gemini/qwen/deepseek/...`），消费侧如 `src/shared/utils/model.ts:160`：

```ts
return id.startsWith('claude') || id.includes('glm') || id.includes('kimi') || id.includes('moonshot')
```

**LobeChat**（`packages/model-runtime/src/providers/higress/index.ts`）——对聚合网关返回的模型用描述文本启发式补能力：

```ts
functionCall: model.description.includes('function calling') || model.description.includes('tools') || knownModel?.abilities?.functionCall || false,
vision: model.description.includes('vision') || model.description.includes('multimodal') || model.id.includes('vision') || knownModel?.abilities?.vision || false,
```
https://github.com/lobehub/lobe-chat/blob/main/packages/model-runtime/src/providers/higress/index.ts

max_tokens 字段名的启发式在 `providers/minimax/index.ts:255`：`isM3 ? { max_completion_tokens } : { max_tokens }`（按模型代次判断）。

**OpenCode** 无模型名启发式（走 models.dev，见下），但 max_tokens 改写按 provider 而非模型名：Snowflake Cortex 插件无条件把 `max_tokens` 改写为 `max_completion_tokens`（`packages/opencode/src/provider/provider.ts:1000-1003`、`plugin/snowflake-cortex.ts:389-391`），Cerebras 插件相反（`plugin/cerebras.ts` 删除 `max_completion_tokens`）。

### C. 中央数据库映射

**models.dev**（OpenCode）：`packages/core/src/models-dev.ts` 定义 schema 并抓取 models.dev。Model schema 字段直接覆盖本任务关注的多个字段：

```ts
export const Model = Schema.Struct({
  id, name, family, release_date,
  attachment: Schema.Boolean,      // 附件（图像/文件输入）
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,       // 工具调用
  reasoning_options: Schema.optional([...]), // {type:'effort',values:[...]} | {type:'toggle'} | {type:'budget_tokens',min,max}
  ...
})
```

`ReasoningOption` 显式枚举了 effort 值列表、纯开关、预算 token 三种方言。models.dev 的 `api.json` 实测（2026-10-10 抓取）还含 `modalities.input: ["text","image",...]`（图像输入）、`limit.context/output`、`cost`。OpenCode 因此**不需要启发式也不需要探测**。
https://github.com/sst/opencode/blob/dev/packages/core/src/models-dev.ts

**LiteLLM `/v1/model/info`**（Roo Code 消费）：`src/api/providers/fetchers/litellm.ts` 把 LiteLLM 的 `model_info.supports_vision` → `supportsImages`、`supports_prompt_caching` → `supportsPromptCache`、`max_output_tokens` → `maxTokens`。
https://github.com/RooVetGit/Roo-Code/blob/main/src/api/providers/fetchers/litellm.ts

**OpenRouter `/models`**（Roo Code）：`src/api/providers/fetchers/openrouter.ts:186` `parseOpenRouterModel()`：`inputModality?.includes("image")` → `supportsImages`；`supported_parameters.includes("reasoning")` → `supportsReasoningEffort`；另外维护 `OPEN_ROUTER_REASONING_BUDGET_MODELS` / `OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS` 两个硬编码集合。

**厂商声明目录包**：Cherry Studio 的 `@cherrystudio/provider-registry`（`packages/provider-registry/src/creators/*.ts`，按厂商 60+ 文件）声明每个模型的 `capabilities`（枚举含 REASONING/FUNCTION_CALL/IMAGE_RECOGNITION 等）、`reasoning.selectableEfforts`、`parameterSupport`（`maxTokens: z.boolean().default(true)` 等）。消费侧 `src/shared/utils/model.ts:24-25`：

```ts
export const isVisionModel = (model) => !!(model.capabilities.includes(IMAGE_RECOGNITION) || model.inputModalities?.includes(MODALITY.IMAGE))
```

**LobeChat `model-bank`**（`packages/model-bank/src/aiModels/*.ts`，按 provider 一个文件）——**内置模型卡片库**，每个模型手写 `abilities: { functionCall, reasoning, search, structuredOutput, vision }`、`contextWindowTokens`、`maxOutput`、pricing。运行时 `knownModel?.abilities?.vision` 与用户/网关返回的数据合并（见 higress 示例）。

**Cline**（`sdk/packages/llms/src/catalog/catalog.generated.ts`）——生成的目录，每模型含 `capabilities: ["images","files","tools","reasoning","structured_output"]` 与 `reasoningOptions: [{type:"effort",values:["none","low","medium","high","xhigh","max"]}]`，直接编码了 thinking 级别全集。
https://github.com/cline/cline/blob/main/sdk/packages/llms/src/catalog/catalog.generated.ts

### D. 用户声明

- **Continue**：capabilities 完全由用户在 config 声明，无自动推断。`packages/config-yaml/src/schemas/models.ts:37`：`modelCapabilitySchema = z.union([z.literal("tool_use"), z.literal("image_input"), z.literal("next_edit"), z.string()])`；`core/config/yaml/models.ts:104-105` 消费：`tools: model.capabilities?.includes("tool_use"), uploadImage: model.capabilities?.includes("image_input")`。Continue 的 `autodetectModels`（`core/config/yaml/models.ts:148`）只做一件事：调 provider 的 `listModels()` 把 `"AUTODETECT"` 占位符展开成模型列表，**不推断任何能力**。
- **Roo Code** ModelInfo（`packages/types/src/model.ts:76-94`）的 `supportsImages`、`supportsReasoningEffort`（可为 boolean 或 `["disable","none","minimal","low","medium","high","xhigh"]` 数组）对自定义 provider 是用户/内置定义填的。
- **Cherry Studio** capabilities 是 Model schema 字段，可由 registry 填充，也暴露给用户编辑（声明-覆盖混合）。

---

## 2. 逐产品核查

### Cherry Studio — https://github.com/CherryHQ/cherry-studio

- **能力来源**：内置厂商声明目录包 `@cherrystudio/provider-registry`（`packages/provider-registry/src/creators/` 60+ 厂商文件），产出 `capabilities`、`inputModalities`、`reasoning.selectableEfforts`、`parameterSupport`。消费在 `src/shared/utils/model.ts`（`isReasoningModel`/`isVisionModel`/`isFunctionCallingModel`）。
- **「check model」存在且是真实探测**：`src/main/ai/AiService.ts:1379` `checkModel()` + `src/renderer/pages/settings/ProviderSettings/utils/healthCheck.ts`。只验证连通/计费/延迟，不推断能力字段；烧钱模型主动跳过。
- **max_tokens 字段名**：模型名启发式 `packages/ai-sdk-provider/src/reasoningModelTransform.ts` `isOpenAIReasoningModelId()`（o1/o3/o4-mini/gpt-5/gpt-6 前缀）。
- **thinking 级别**：registry creators 里的逐 SKU 正则表（如 openai.ts 的 effort 数组），不是探测。

### LobeChat — https://github.com/lobehub/lobe-chat

- **能力来源**：内置模型卡片库 `packages/model-bank/src/aiModels/<provider>.ts`，每模型手写 `abilities: { functionCall?, reasoning?, vision?, search?, structuredOutput? }`；类型定义 `packages/model-bank/src/types/aiModel.ts:57-92`。注意：仓库 `lobehub/model-bank` 不存在，model-bank 是主仓的 workspace 包。
- **对未知/自定义模型**：provider runtime 用启发式合并（higress 例：description/id 文本匹配 + knownModel.abilities 兜底）。
- **健康检查**：`checkModel` 仅是 aiProvider 配置表字段（用户指定用哪个模型测连接，`packages/database/src/schemas/aiInfra.ts:41`），未发现能力探测代码。真正发请求的检测逻辑未在本次浅查中定位（标「未找到证据」）。
- **max_tokens 字段名**：per-provider 代码（minimax 按模型代次 isM3 切换），无统一启发式。

### OpenCode — https://github.com/sst/opencode

- **直接用 models.dev**：`packages/core/src/models-dev.ts` 定义 schema 并抓取；`tool_call`、`reasoning`、`reasoning_options`（effort/toggle/budget_tokens 三种）、`attachment`、`modalities` 均来自 models.dev。models.dev/api.json 实测（2026-10-10）确认这些字段存在（如 `tool_call: true`、`reasoning_options: [{type:"effort",values:["none","high"]}]`）。
- **max_tokens 字段名**：按 provider 改写（snowflake-cortex 插件 `max_tokens`→`max_completion_tokens`；cerebras 插件反向删除），不看模型名。
- **streaming usage**：不做探测，无条件给 openai-compatible 设 `includeUsage = true`（`packages/core/src/plugin/provider/openai-compatible.ts:11`、`packages/opencode/src/provider/provider.ts:1806-1807`），发送 `stream_options: { include_usage: true }`（`packages/llm/src/protocols/openai-chat.ts:360`）。

### Continue — https://github.com/continuedev/continue

- **capabilities 完全用户声明**：config `capabilities: ["tool_use","image_input",...]`（`packages/config-yaml/src/schemas/models.ts:37`）；`core/config/yaml/models.ts:103-106` 映射到 `tools`/`uploadImage`。
- **autodetect 仅是模型名展开**：`core/config/yaml/models.ts:148` `autodetectModels()` 调 `llm.listModels()`，不推断能力。
- **max_tokens 字段名**：模型名启发式 `isOSeriesOrGpt5PlusModel`（`/^o[0-9]+/` 或 `/gpt-[5-9]/`）→ 用 `max_completion_tokens`（`core/llm/llms/OpenAI.ts:221,288-292`）；o1 强制关闭 stream。

### Cline — https://github.com/cline/cline

- 内置生成目录 `sdk/packages/llms/src/catalog/catalog.generated.ts`，每模型声明 `capabilities: ["images","files","tools","reasoning","structured_output"]` 与 `reasoningOptions`（含 effort 值全集）。对自定义/OpenAI 兼容端点走 `modelsSourceUrl`（provider manifest 的模型源，多为 OpenRouter 兼容格式）。

### Roo Code — https://github.com/RooVetGit/Roo-Code

- ModelInfo 能力字段 `packages/types/src/model.ts:76-94`：`supportsImages`、`supportsReasoningEffort`（boolean 或级别数组）等。
- 数据源：OpenRouter `/models`（`fetchers/openrouter.ts`，用 `architecture.input_modalities` 和 `supported_parameters`）、LiteLLM `/v1/model/info`（`fetchers/litellm.ts`，`supports_vision` 等）、加上硬编码集合（`OPEN_ROUTER_REASONING_BUDGET_MODELS`）。对普通 OpenAI 兼容 provider 无自动推断，靠内置默认值或用户配置。

### LibreChat — https://github.com/danny-avila/LibreChat

- 本次浅查未定位到独立的能力推断模块；能力（视觉等）以端点配置和用户声明为主。标「未找到证据」。

---

## 3. 结论：逐字段可自动获得性

| 字段 | 可自动获得？ | 条件/证据 |
|---|---|---|
| thinking 级别（off/minimal/.../max 的支持集） | **部分可** | models.dev `reasoning_options`（OpenCode）、Cline 目录 `reasoningOptions`、Cherry registry 正则表可给出精确列表；仅对知名模型。自定义/私有模型不可。探测成本过高（需逐级发请求），业内无人做。 |
| max_tokens 字段名 | **部分可** | 业内普遍用模型名启发式（Continue `/^o[0-9]+\|gpt-[5-9]/`；Cherry o1/o3/o4-mini/gpt-5/gpt-6 前缀）或按 provider 一刀切改写（OpenCode snowflake/cerebras）。对第三方 OpenAI 兼容代理（转发旧模型名但要求新字段）只能发一次带 `max_tokens` 的请求看是否 400——实测 Cherry/Continue 均未这样做，而是靠名称规则。 |
| streaming usage（include_usage） | **不可/不需要推断** | 业内主流是无条件发送（OpenCode 对 openai-compatible 恒设 `includeUsage = true`）。不支持的网关通常忽略未知字段而非报错，故无需能力位。无产品做探测。 |
| tool calling | **部分可** | models.dev `tool_call`、LobeChat model-bank `abilities.functionCall`、OpenRouter `supported_parameters`、LiteLLM `supports_*` 可查；自定义模型只能靠启发式（LobeChat 的 description 文本匹配）或用户声明（Continue）。Cherry 的健康检查只测连通不测 tools。 |
| 图像输入 | **部分可** | models.dev `modalities.input`、OpenRouter `architecture.input_modalities`、LiteLLM `supports_vision`、Cline `capabilities:["images"]`、LobeChat `abilities.vision` 可查；启发式（id 含 `-vision/-vl`、description 含 "multimodal"）为兜底；Continue 纯用户声明。 |

**业内主流处理优先级**（按本次核查的产品实践排序）：

1. **中央数据库/厂商目录**（models.dev、LiteLLM model_info、OpenRouter API、内置 model-bank/catalog/registry）——覆盖率最高、零延迟零计费，是 OpenCode/Cline/LobeChat/Cherry 的主力。
2. **用户声明兜底**（Continue 唯一机制；Cherry/Roo 对自定义模型也靠它）——所有产品都保留。
3. **模型名启发式**（max_tokens 字段名、thinking 级别表）——仅用于数据库未覆盖的知名家族或字段名这类「规则稳定」的属性。
4. **试探请求**——只用于「能不能用」的连通性健康检查（Cherry Studio 独有完整实现），且对烧钱端点主动跳过；**没有产品用它推断能力字段**。

对本项目场景的推论：thinking 级别与 max_tokens 字段名若不在 models.dev/注册表里，最优解是「启发式规则 + 用户声明覆盖」，而不是探测——探测一次虽便宜（个位数 token），但要覆盖 7 个级别 × 每模型，且无法区分「不支持」与「忽略」。
