# OpenAI 兼容模型元数据来源核查

**核查日期**: 2026-10-10
**方法**: 实际 curl/WebFetch 抓取各 API 与 GitHub 仓库，摘录真实响应字段；许可证以仓库 LICENSE 原文为准。
**背景**: 桌面 AI 应用希望在用户填完 baseURL + API key 后，自动补全模型的 contextWindow、maxTokens、定价、能力（视觉/工具/推理）等元数据；`GET {baseURL}/v1/models` 只返回 id 列表，不够用。

---

## 1. OpenRouter 富元数据 API

### URL 与格式

| 端点 | 说明 |
|---|---|
| `GET https://openrouter.ai/api/v1/models` | 全部模型元数据（本次实测 458 个模型，响应约 765 KB JSON） |
| `GET https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints` | 单个模型的各上游供应商端点（实测 `deepseek/deepseek-chat`） |

- 官方文档（OpenAPI 总入口）: <https://openrouter.ai/docs/api/reference/overview>
- 机器可读 OpenAPI 规范: <https://openrouter.ai/openapi.yaml> / <https://openrouter.ai/openapi.json>
  - 规范中 `GET /models` 的 summary 为 "List all models and their properties"，operationId `getModels`，**未标注 security 要求**（免鉴权）；`GET /models/{author}/{slug}/endpoints` summary 为 "List all endpoints for a model"。
- **免鉴权**: ✅ 实测不带任何 header 直接 curl 成功。

### 字段（2026-10-10 实测 `/api/v1/models` 单模型条目）

顶层字段：`id`, `canonical_slug`, `hugging_face_id`, `name`, `created`, `description`, `context_length`, `architecture`, `pricing`, `top_provider`, `per_request_limits`, `supported_parameters`, `default_parameters`, `supported_voices`, `knowledge_cutoff`, `expiration_date`, `links`, `reasoning`。

```json
{
  "context_length": 1000000,
  "architecture": {
    "modality": "text+image+video->text",
    "input_modalities": ["text", "image", "video"],
    "output_modalities": ["text"],
    "tokenizer": "Other",
    "instruct_type": null
  },
  "pricing": { "prompt": "0.000001", "completion": "0.0000027", "input_cache_read": "0.00000005" },
  "top_provider": { "context_length": 1000000, "max_completion_tokens": 64000, "is_moderated": false },
  "per_request_limits": null,
  "supported_parameters": ["frequency_penalty", "max_tokens", "reasoning", "tools", "structured_outputs", "..."]
}
```

注意：`pricing` 单位是**美元/token**（字符串）。`max_completion_tokens` 不在模型顶层，而在 `top_provider` 内；不同模型的 `per_request_limits` 可能为 null。

### `/endpoints` 字段（实测 `deepseek/deepseek-chat`）

每个 endpoint 含：`name`, `provider_name`, `tag`, `context_length`, `pricing{prompt,completion,discount}`, `quantization`, `max_completion_tokens`, `max_prompt_tokens`, `supported_parameters`, `supports_tool_choice{none,auto,required,function}`, `status`, `uptime_last_30m/5m/1d`, `supports_implicit_caching` 等。

### 更新机制 / 许可证 / 可程序化消费程度

- **更新机制**: OpenRouter 运营方实时维护，随上游供应商上下架实时变化；无独立"更新频率"概念。
- **许可证/使用条款**: 未找到针对 `/api/v1/models` 数据再分发的明确许可条款（见文末"局限"）。API 本身公开免鉴权，opencode、LiteLLM 等开源项目均在消费它。
- **可程序化消费**: **可**（在线）。但它是 OpenRouter 路由视角的数据，**只覆盖 OpenRouter 上架的模型**，且价格是 OpenRouter 渠道价，不等于用户自配 baseURL 厂商的官价。

---

## 2. models.dev（sst/opencode 维护）

### URL 与格式

| 资源 | 说明 |
|---|---|
| `https://models.dev/api.json` | 主 API：provider → models 两层结构（实测约 5.4 MB，226 个 provider） |
| `https://models.dev/models.json` | provider 无关的模型自身元数据 |
| `https://models.dev/catalog.json` | 两者合并 |
| `https://models.dev/logos/{provider}.svg` | 厂商 logo |
| GitHub 仓库 | <https://github.com/sst/models.dev>（dev 分支，7174 stars，本次核查当天仍在 push） |

支持 `?type=decision|all` 过滤（默认省略 specialized 类型）。数据维护方式：README 自述 "community-contributed project"，仓库内数据为 TOML/TS 源文件 + CI 构建出 JSON；同时被 opencode 内部使用。

### 字段（2026-10-10 实测）

provider 层：`id`, `name`, `env`（所需环境变量名）, `npm`（AI SDK 包名）, `api`（baseURL）, `doc`（官方定价文档链接）。

模型层（实测 `deepseek` 的 `deepseek-v4-flash-vision-exp`）：

```json
{
  "id": "deepseek-v4-flash-vision-exp",
  "name": "DeepSeek V4 Flash Vision Exp",
  "family": "deepseek-flash",
  "attachment": true,
  "reasoning": true,
  "reasoning_options": [{"type": "toggle"}, {"type": "effort", "values": ["low","high","max"]}],
  "tool_call": true,
  "interleaved": {"field": "reasoning_content"},
  "structured_output": true,
  "temperature": true,
  "knowledge": "2025-05",
  "release_date": "2026-09-10",
  "last_updated": "2026-09-10",
  "modalities": {"input": ["text","image"], "output": ["text"]},
  "open_weights": true,
  "limit": {"context": 1000000, "output": 393216},
  "status": "deprecated",
  "cost": {"input": 0.15, "output": 0.6, "reasoning": 0.6, "cache_read": 0.003},
  "canonical_model_id": "deepseek/deepseek-v4.1-flash"
}
```

注意：`cost` 单位是**美元/百万 token**（数值），与 OpenRouter（美元/token）和 LiteLLM（美元/token）都不同。

### 许可证

- **MIT License**（Copyright (c) 2025 models.dev）。来源：<https://raw.githubusercontent.com/sst/models.dev/dev/LICENSE>；GitHub API 亦报告 `spdx_id: MIT`。
- MIT 允许自由复制、修改、再分发（含商用），**适合离线打包进桌面应用**（保留版权声明即可）。

### 更新频率

- GitHub `pushed_at: 2026-10-10`（核查当天有提交）；社区 PR 高频。

### 可程序化消费程度

- **可**。静态 JSON、免鉴权、无速率限制说明；且有 JSON Schema 端点（`model-schema.json`）。

---

## 3. LiteLLM `model_prices_and_context_window.json`

### URL 与格式

- 仓库内路径: `BerriAI/litellm` 根目录 `model_prices_and_context_window.json`
- Raw URL: <https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json>（实测约 2.7 MB，4035 个条目）
- 文档中常被引用的备用镜像: `https://litellm-api.up.railway.app/`（litellm 代码内作为 fallback，本次未逐一验证其 SLA）

### 字段（2026-10-10 实测）

`gpt-4o` 条目：

```json
{
  "input_cost_per_token": 2.5e-06,
  "output_cost_per_token": 1e-05,
  "cache_read_input_token_cost": 1.25e-06,
  "max_input_tokens": 128000,
  "max_output_tokens": 16384,
  "max_tokens": 16384,
  "mode": "chat",
  "litellm_provider": "openai",
  "supports_function_calling": true,
  "supports_parallel_function_calling": true,
  "supports_prompt_caching": true,
  "supports_response_schema": true,
  "supports_tool_choice": true,
  "supports_vision": true,
  "supports_pdf_input": true,
  "supports_system_messages": true,
  "source": "https://developers.openai.com/api/docs/pricing"
}
```

`deepseek/deepseek-chat` 条目另有：`deprecation_date`, `input_cost_per_token_cache_hit`, `cache_creation_input_token_cost`, `supported_endpoints`, `supports_assistant_prefill`, `supports_native_streaming` 等。另有 `supports_reasoning`（存在于推理模型条目）、`supports_web_search` 等布尔能力字段。**字段不齐是常态**：不同条目字段差异很大（仓库 issue #1375 就是抱怨格式不一致）。key 命名规则不统一：直连厂商多用 `provider/model` 前缀（`groq/`、`moonshot/`、`xai/`、`fireworks_ai/`），OpenAI 系直接裸 `gpt-4o`。

### 更新频率

- GitHub commits（path=model_prices_and_context_window.json）：核查当天（2026-10-10）已有多条提交，前一天更多，**日级高频社区 PR**。值得注意的是 2026-10-09 有 "remove openrouter rows, part 3/4/5 of 5" 系列重构，**正在删除 openrouter 派生行**（实测 `litellm_provider==openrouter` 已为 0 条）。

### 许可证

- 仓库 LICENSE 开头声明：`enterprise/` 目录（如存在）按其自身 LICENSE，**此外内容均为 MIT**（Copyright (c) 2023 Berri AI）。来源：<https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE>。
- 该 JSON 位于仓库根目录，不在 `enterprise/` 下，**按 MIT 可用**。文件本身头部无 license 注释字段。

### 社区准确性评价（真实 issue）

- [#35904](https://github.com/BerriAI/litellm/issues/35904)（open，2026-08-05）："Four Vertex AI MaaS models have incorrect prices in model_prices_and_context_window.json"——报告者用 Google Cloud Billing Catalog API 核对，指出 4 个条目的价格与实际收费不符，且问题在 `main` 上持续存在。
- [#37274](https://github.com/BerriAI/litellm/issues/37274)（open）："[Feature]: Add current Fireworks AI Serverless model cost entries"——Fireworks 成本条目过时/缺失。
- [#41782](https://github.com/BerriAI/litellm/issues/41782)（open）："Wrong calculation of cost for Nebius provider"。

结论：数据由社区 PR 驱动，**长尾厂商条目常有滞后或错误**，头部厂商（OpenAI/Anthropic/DeepSeek）维护较好。

### 可程序化消费程度

- **可**。单个静态 JSON、免鉴权 raw 下载、MIT。缺点：key 命名不规则（需要前缀匹配 + 别名表），`max_tokens` 语义含混（对部分模型是 output 上限而非 context）。

---

## 4. 其他来源

### OpenRouter 数据可否被第三方免费镜像/使用

- 未在 <https://openrouter.ai/docs> 或 ToS 中找到对 `/api/v1/models` 数据再分发/镜像的明确许可条款。实际上 opencode 等项目在线消费它，但"打包镜像其数据"没有明文授权，**作为在线补充可以，离线再分发存在条款不确定性**。

### Helicone 模型成本数据

- Helicone 仓库 <https://github.com/Helicone/helicone>（Apache-2.0）内有 `packages/cost` 包（含 `costCalc.ts`、`providers/`、`models/` 目录），是代码形式的成本计算表而非单一 JSON 数据集；主要面向自家网关计费，作为第三方元数据库消费需自行抽取其 TS 源码里的映射，**部分可**（需写适配器），覆盖面以 Helicone 网关接入的 provider 为限。

### 厂商各自文档页

| 厂商 | 页面 | 程序化消费 |
|---|---|---|
| DeepSeek | <https://api-docs.deepseek.com/quick_start/pricing>（models.dev 的 `doc` 字段即指向此） | 不可（HTML 文档，结构易变） |
| Moonshot | <https://platform.moonshot.ai/docs> 定价页 | 不可 |
| SiliconFlow | <https://docs.siliconflow.cn> | 不可 |

结论：厂商文档页**只适合人工核对与作为 `doc` 链接展示给用户**，不适合作程序化来源。反向利用 models.dev/LiteLLM 条目里的 `source`/`doc` 字段做"人工核对入口"是可行的。

---

## 5. 覆盖度对照：9 家「OpenAI 兼容但非大厂」服务商

全部于 2026-10-10 实测（models.dev 顶层 key 用 `jq keys` 等价列出；LiteLLM 按 `litellm_provider` 精确匹配统计）。

| 服务商 | models.dev provider key（模型数） | LiteLLM `litellm_provider`（条数）/ 示例 key |
|---|---|---|
| SiliconFlow | `siliconflow`（57）、`siliconflow-cn`（44），api=`https://api.siliconflow.com/v1` | **缺失**（0 条，任何 "silicon" 写法均无命中） |
| z.ai | `zai`（18）、`zai-coding-plan`（7），api=`https://api.z.ai/api/paas/v4` | `zai`（16），示例 `zai/glm-5` |
| DeepSeek | `deepseek`（4），api=`https://api.deepseek.com` | `deepseek`（16），示例 `deepseek/deepseek-chat` |
| Moonshot | `moonshotai`（4）、`moonshotai-cn`（4），api=`https://api.moonshot.ai/v1` | `moonshot`（11），示例 `moonshot/kimi-k2.5` |
| Groq | `groq`（16） | `groq`（11），示例 `groq/meta-llama/llama-prompt-guard-2-22m` |
| Together | `togetherai`（29） | `together_ai`（89），示例 `together_ai/Qwen/Qwen2.5-7B-Instruct-Turbo` |
| Fireworks | `fireworks-ai`（22），api=`https://api.fireworks.ai/inference/v1/` | `fireworks_ai`（334），示例 `fireworks_ai/accounts/fireworks/models/deepseek-coder-v2-instruct` |
| Mistral | `mistral`（42） | `mistral`（69），示例 `mistral/codestral-latest` |
| xAI | `xai`（13） | `xai`（58），示例 `xai/grok-4.20-multi-agent-beta-0309` |

要点：
- models.dev 对 9 家**全覆盖**，且 provider 层直接给出 `api`（baseURL）与 `doc` 链接——正好匹配"用户填 baseURL 反查 provider"的场景；但部分小厂模型数少（DeepSeek/Moonshot 各 4 个，可能滞后于厂商实际在售列表）。
- LiteLLM 缺 **SiliconFlow**（国产聚合商，本次核查 0 命中）；其余 8 家有覆盖且条目数普遍更多，但 key 前缀需要别名表（`together_ai` vs `togetherai`、`fireworks_ai` vs `fireworks-ai`）。
- 两家都缺一家时可互补：SiliconFlow 只能靠 models.dev（或 OpenRouter）。

---

## 6. 结论倾向

**离线打包兜底：models.dev（api.json 快照）。**
理由：MIT 许可证明确允许再分发；单文件 JSON（5.4 MB 全量可裁剪，按 provider 裁剪后体积可控）；字段面向"客户端配置"设计（`limit.context`/`limit.output`、`modalities`、`tool_call`、`reasoning`、`cost`、`api` baseURL、`doc` 链接）；对国产/中小 OpenAI 兼容厂商覆盖最全；单位统一（美元/百万 token）。注意其 `status: deprecated` 等字段需过滤，且小厂模型列表可能滞后——作为兜底可接受。

**在线补充：OpenRouter `/api/v1/models`（+ `models.dev` 在线拉新）。**
理由：免鉴权、字段最富（`supported_parameters`、`top_provider.max_completion_tokens`、缓存定价、uptime）；实时更新。局限：仅覆盖 OpenRouter 渠道，价格是渠道价，数据再分发无明确条款——适合在线按需查询并缓存，不适合打包。

**LiteLLM JSON 的定位：第二在线来源 / 交叉核对。**
MIT 可用、更新最勤、条目最多，但 key 命名不规则、`max_tokens` 语义含混、长尾准确性有公开 issue 背书的不良记录；适合用 `litellm_provider` 做归一化后与 models.dev 交叉补全（尤其 `supports_*` 能力布尔字段更细），不建议单独作兜底。

**厂商文档页：仅作人工核对入口**（可从 models.dev 的 `doc` / LiteLLM 的 `source` 字段直接取得链接展示给用户）。

---

## 7. 局限与未证实事项

- OpenRouter `/api/v1/models` 数据的再分发/镜像许可条款：**未找到明文**，仅确认 API 免鉴权公开。
- models.dev 的更新延迟：未量化（能看到 `last_updated` 字段与当日 push，但未统计 PR 合入周期）。
- LiteLLM 备用镜像 `litellm-api.up.railway.app` 的稳定性/SLA：未验证。
- Helicone `packages/cost` 的 provider 覆盖清单：未逐一展开（目录级确认存在）。
- 各来源的速率限制：models.dev / raw.githubusercontent 未见明示限制，OpenRouter 文档未见该端点的 rate limit 数值，均未压力测试。
