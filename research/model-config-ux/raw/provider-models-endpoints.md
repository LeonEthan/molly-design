# 各家 OpenAI 兼容服务 GET /models 端点核查清单

核查日期：2026-10-10。方法：以官方 API 文档 / 官方 GitHub 源码为主，辅以对公开端点的 curl 探测（仅验证鉴权行为，未使用有效 key）。「未证实」= 本次未在可验证来源中读到，不做推测。

---

## OpenRouter

- **端点**：`GET https://openrouter.ai/api/v1/models`（带 `/api` 前缀）。官方 API Reference 标注 `Authorization: Bearer <token>` 为 required header。
- **返回结构**：**非标准**。顶层只有 `data: [...]`（另有分页 `links`/`total_count`），示例中**没有** `object: "list"` 顶层字段，条目也无 `object`/`owned_by`。
- **条目字段**（除 id 外，摘自官方 OpenAPI spec 与示例）：`name`、`canonical_slug`、`description`、`created`、`context_length`、`architecture`（`modality`/`input_modalities`/`output_modalities`/`instruct_type`/`tokenizer`）、`pricing`（`prompt`/`completion`/`image`/`request`，**字符串形式的每 token 美元价**）、`top_provider`（`context_length`/`is_moderated`/`max_completion_tokens`）、`per_request_limits`、`supported_parameters`、`supported_voices`、`default_parameters`、`expiration_date`、`knowledge_cutoff`、`links`、`hugging_face_id`。
- **示例 JSON**（摘自 https://openrouter.ai/openapi.yaml 中 Model schema 的 example，2026-10-10 抓取）：

```json
{
  "architecture": {
    "input_modalities": ["text"],
    "instruct_type": "chatml",
    "modality": "text->text",
    "output_modalities": ["text"],
    "tokenizer": "GPT"
  },
  "canonical_slug": "openai/gpt-4",
  "context_length": 8192,
  "created": 1692901234,
  "default_parameters": null,
  "description": "GPT-4 is a large multimodal model that can solve difficult problems with greater accuracy.",
  "expiration_date": null,
  "id": "openai/gpt-4",
  "knowledge_cutoff": null,
  "links": { "details": "/api/v1/models/openai/gpt-4/endpoints" },
  "name": "GPT-4",
  "per_request_limits": null,
  "pricing": { "completion": "0.00006", "image": "0", "prompt": "0.00003", "request": "0" },
  "supported_parameters": ["temperature", "top_p", "max_tokens"],
  "supported_voices": null,
  "top_provider": { "context_length": 8192, "is_moderated": true, "max_completion_tokens": 4096 }
}
```

- **覆盖度**：平台**全量聚合目录**（跨 OpenAI/Anthropic/Google 等上游），id 带组织前缀。支持分页：`limit` 默认 500、最大 1000，`offset`；不带分页返回全量。另有 `GET /api/v1/models/count` 与 `GET /api/v1/models/user`（后者差异未证实）。规模量级：数百个。
- **坑**：
  - 旧文档 URL `openrouter.ai/docs/api-reference/list-available-models` 已 404，现行为 `docs/api/api-reference/models/list-all-models-and-their-properties`（本次抓取确认 404）。
  - 缺 `object:"list"`/条目 `object`/`owned_by`，严格 OpenAI schema 校验会失败。
  - `pricing` 是字符串、单位是**每 token 美元**（非每百万 token）。
  - `output_modalities` 过滤默认只返回 text 输出模型；image/audio 需显式 `output_modalities=all`（文档 Query Parameters）。
  - 大量过滤参数：`category`、`supported_parameters`、`context`、`min_price`/`max_price`、`providers`、`region`、`zdr` 等。
- **来源**：https://openrouter.ai/openapi.yaml （官方 OpenAPI spec）; https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties

## DeepSeek

- **端点**：`GET https://api.deepseek.com/models`（文档路径写作 `/models`，base 兼容 `/v1`）。鉴权要求在该页未显式标注 required——未证实。
- **返回结构**：标准。schema 明确 `object` 固定 `"list"`，`data` 为模型对象数组。
- **条目字段**（除 id 外，摘自官方 schema）：`object`（`"model"`）、`owned_by`、`name`（展示名）、`context_window`、`max_output_tokens`、`input_modalities`（`text`/`image`）、`output_modalities`（`text`）、`effort`（`supported_levels`/`default_level`，对应 `reasoning_effort`）、`api_capabilities`（含 `anthropic_messages.system_prompt_update`）。**无 `created`、无 `pricing`、无 `context_length`**（注意字段名是 `context_window`）。
- **示例 JSON**：页面仅渲染 schema，Example tab 内容未出现在抓取文本中——未证实。
- **覆盖度**："Lists the currently available models"，即该 key 可调的 DeepSeek 自有模型，量级个位数。是否仍只含 `deepseek-chat`/`deepseek-reasoner` 两个 id——本次页面未出现具体 id，**未证实**（模型目录维护在单独的 Models & Pricing 页）。
- **坑**：字段命名为 `context_window`/`max_output_tokens` 而非 OpenAI 系习惯；无 `created`；schema 内含 Anthropic Messages 能力声明。
- **来源**：https://api-docs.deepseek.com/api/list-models

## Moonshot（月之暗面）

- **端点**：国际站 `GET https://api.moonshot.ai/v1/models`（文档 https://platform.moonshot.ai/docs/api/list-models ）；国内站 `GET https://api.moonshot.cn/v1/models`（https://platform.moonshot.cn/docs/api/list-models ）。两站文档均标注 `Authorization: Bearer <token>` **必填**，并说明 401 含义。
- **返回结构**：两站均标准 `{object:"list", data:[...]}`。
- **条目字段**（两站一致）：`object`（`"model"`）、`created`、`owned_by`（如 `"moonshot"`）、`context_length`、**`supports_image_in`/`supports_video_in`/`supports_reasoning`**（三个布尔能力标识）。无 `name`/pricing。
- **示例 JSON**（摘自 https://platform.moonshot.ai/docs/api/list-models ，国内站逐字相同；注意 `created`/`context_length` 为占位值 `123`）：

```json
{
  "object": "list",
  "data": [
    {
      "id": "kimi-k3",
      "object": "model",
      "created": 123,
      "owned_by": "moonshot",
      "context_length": 123,
      "supports_image_in": true,
      "supports_video_in": true,
      "supports_reasoning": true
    }
  ]
}
```

- **覆盖度**：返回"当前可用的所有模型"（账号 tier 决定），量级个位数~十几个。示例 id `kimi-k3`；`kimi-latest` 是否仍在列表中——本次页面未出现，**未证实**。
- **坑**：两站 Key 不通用（官方明示 `platform.kimi.ai` 与 `platform.kimi.com` 的 key 不可混用）；文档示例 `created: 123` 是占位符；404 `resource_not_found_error` 也可能是 tier 无权访问而非模型不存在。
- **来源**：上述两 URL（本次抓取国际站页面核实，两站一致性由分组核查确认）。

## xAI

- **端点**：`GET https://api.x.ai/v1/models`。官方描述 "List all models **available to the authenticating API key**"——需鉴权且按 key 过滤。
- **返回结构**：标准 `{object:"list", data:[...]}`。
- **条目字段**：`/v1/models` 条目为 "minimalized information"，文档未逐字段列出——具体字段集**未证实**。价格字段在 **`GET /v1/language-models`** 系列端点上：`prompt_text_token_price`、`cached_prompt_text_token_price`、`completion_text_token_price`（及 `_long_context` 变体）、`prompt_image_token_price`、`search_price`，单位 **USD cents / 100M tokens**（整数）；另有 `aliases`、`created`、`fingerprint`、`input_modalities`/`output_modalities`、`owned_by`、`version`。
- **示例 JSON**：文档为字段表形式，无完整响应示例——未证实。
- **覆盖度**：按 key 可用模型。另有 `/v1/image-generation-models`、`/v1/video-generation-models` 分类端点。
- **坑**：价格单位是「美分/1 亿 token」，换算常见 $/1M token 需 ÷100；拿价格要用 `/v1/language-models` 而非 `/v1/models`。
- **来源**：https://docs.x.ai/developers/rest-api-reference/inference/models （`docs.x.ai/docs/api-reference` 现重定向至 Responses 页，文档 "Last updated: April 13, 2026"）

## z.ai（智谱 GLM 国际站）

- **端点**：**官方文档未列出 GET /models**。docs.z.ai 的 API reference 与 openapi.json 全部路径为 `/paas/v4/chat/completions`、`/paas/v4/images/generations`、`/paas/v4/async-result/{id}`、`/paas/v4/tokenizer`、`/paas/v4/web_search` 等 14 条，**无 /models**（本次抓取 https://docs.z.ai/openapi.json 核实）。
- **鉴权**：官方要求 `Authorization: Bearer ZAI_API_KEY`。对 `GET https://api.z.ai/api/paas/v4/models` 不带 header 实测 401（`code:1001 Authentication parameter not received`），带假 key 亦 401（token expired or incorrect）；且任意不存在路径同样先 401——**无法从外部判断 /models 是否实现**，标记未证实。
- **字段/示例/覆盖度**：均未证实（无文档）。
- **坑**：模型清单需看 Pricing/模型指南页而非 API；OpenAI SDK 兼容只演示了 `chat.completions.create`，未演示 `models.list()`。
- **来源**：https://docs.z.ai/api-reference/introduction 、https://docs.z.ai/openapi.json 、https://docs.z.ai/llms.txt

## Groq

- **端点**：`GET https://api.groq.com/openai/v1/models`。文档明确 "use the endpoint to return a JSON list of all active models"，示例带 `Authorization: Bearer $GROQ_API_KEY`；实测无 key 返回 401 `invalid_api_key`。
- **返回结构**：标准 `{object:"list", data:[...]}`。
- **条目字段**：`object`（`"model"`）、`created`、`owned_by`、**`active`**、**`context_window`**、**`public_apps`**（null）。无 pricing/description。
- **owned_by 取值**（官方示例）：`"Google"`（gemma2-9b-it）、`"Meta"`（llama 系）、`"OpenAI"`（whisper-large-v3/-turbo）、`"Hugging Face"`（distil-whisper-large-v3-en）。
- **示例 JSON**（摘自 https://console.groq.com/docs/api-reference ，分组核查摘录）：

```json
{
  "object": "list",
  "data": [
    { "id": "gemma2-9b-it", "object": "model", "created": 1693721698, "owned_by": "Google", "active": true, "context_window": 8192, "public_apps": null },
    { "id": "whisper-large-v3-turbo", "object": "model", "created": 1728413088, "owned_by": "OpenAI", "active": true, "context_window": 448, "public_apps": null }
  ]
}
```

- **覆盖度**：全部 active 托管模型，**含非聊天模型**：Whisper ASR、TTS（playai-tts、orpheus 系）、安全模型（llama-guard）。量级几十个（Production + Preview 约 15–20 个，按文档模型页）。
- **坑**：whisper 的 `context_window: 448` 是音频帧概念而非 token 上限；Preview 模型可随时下线；示例中 `created` 值不反映真实上架时间。
- **来源**：https://console.groq.com/docs/models 、https://console.groq.com/docs/api-reference （llms-full.txt 抓取核实）

## Together

- **端点**：`GET https://api.together.xyz/v1/models`。鉴权 required（实测无 key 返回 401 "Missing API key"）。
- **返回结构**：**非标准**——顶层是**裸 JSON 数组** `[{...}]`，不是 `{object:"list", data:[...]}` 包装。
- **条目字段**：`object`（`"model"`）、`created`、`type`、`display_name`、`organization`、`link`、`license`、`context_length`、**`pricing`**（`base`/`finetune`/`hourly`/`input`/`output`/`cached_input`）。`type` 取值：`chat`/`language`/`code`/`image`/`embedding`/`moderation`/`rerank`/`audio`/`transcribe`/`video`。
- **示例 JSON**（摘自 https://docs.together.ai/reference/models ）：

```json
[
  {
    "id": "Austism/chronos-hermes-13b",
    "object": "model",
    "created": 1692896905,
    "type": "chat",
    "display_name": "Chronos Hermes (13B)",
    "organization": "Austism",
    "link": "<string>",
    "license": "other",
    "context_length": 2048,
    "pricing": { "base": 0, "finetune": 0, "hourly": 0, "input": 0.3, "output": 0.3, "cached_input": 0.2 }
  }
]
```

- **覆盖度**："Lists all of Together's open-source models and metadata"——全量目录而非按 key 过滤；支持 `?dedicated=true`。规模：多分类合计数百个（精确数字文档未给）。
- **坑**：裸数组结构对手写 OpenAI 兼容客户端是常见不兼容点（SDK `client.models.list()` 无碍）；`type` 远超 chat；pricing 为扩展字段。
- **来源**：https://docs.together.ai/reference/models （`/reference/list-models` 已 404）；鉴权行为本次 curl 实测。

## Fireworks

- **端点（两条线）**：
  1. **OpenAI 兼容推理面**：`GET https://api.fireworks.ai/inference/v1/models` **存在**（实测：无 key 返回 401 "You must provide an API key"；假 key 返回 401 "The API key you provided is invalid"——错误文案与 404 不同，说明路由存在）。返回字段/结构：官方文档无独立条目，**未证实**。
  2. **管理面**：`GET https://api.fireworks.ai/v1/accounts/{account_id}/models`（官方 List Models）。返回 Google AIP 风格 `{"models":[...], "nextPageToken":..., "totalSize":...}`，**非** `{object:"list"}`；字段为 camelCase（`contextLength`、`createTime`、`supportsImageInput`、`supportsTools`、`baseModelDetails` 等数十个）；分页 `pageSize` 默认 50 最大 200，支持 AIP-160 `filter`/`orderBy`/`readMask`。
- **管理面示例 JSON**（摘自 https://docs.fireworks.ai/api-reference/list-models ，占位值原样保留）：

```json
{
  "models": [
    {
      "name": "<string>", "displayName": "<string>", "createTime": "2023-11-07T05:31:56Z",
      "state": "STATE_UNSPECIFIED", "kind": "KIND_UNSPECIFIED",
      "contextLength": 123, "supportsImageInput": true, "supportsTools": true, "public": true
    }
  ],
  "nextPageToken": "<string>", "totalSize": 123
}
```

- **覆盖度**：管理面为账号作用域模型清单（含自建/微调/导入），需翻页遍历。
- **坑**：OpenAI 兼容客户端要的 `/inference/v1/models` 在文档中无 schema，字段未证实；管理面 camelCase 与 OpenAI snake_case 不兼容。
- **来源**：https://docs.fireworks.ai/api-reference/list-models ；`/inference/v1/models` 存在性为本次 curl 实测（2026-10-10）。

## Mistral

- **端点**：`GET https://api.mistral.ai/v1/models`，需鉴权（Bearer）。支持可选 query：`provider`、`model`。
- **返回结构**：标准 `{object:"list", data:[...]}`；`data` 元素为 `BaseModelCard | FTModelCard` 联合类型（基础模型与微调模型卡片字段不同）。
- **条目字段**：`object`（`"model"`）、`created`、`owned_by`、**`capabilities`**（`completion_chat`/`completion_fim`/`function_calling`/`fine_tuning`/`vision`/`classification` 布尔）、**`max_context_length`**、**`aliases`**、**`archived`**；FTModelCard 另有 `job`/`root`/`TYPE:"fine-tuned"`；schema 树中还存在 `deprecation`/`deprecation_replacement_model`。
- **示例 JSON**（摘自 https://docs.mistral.ai/api/ ；注意官方示例截断显示为裸数组，实际响应含 `{object:"list"}` 包装——文档示例与 wrapper 描述不一致）：

```json
[
  {
    "id": "<model_id>",
    "capabilities": { "completion_chat": true, "completion_fim": false, "function_calling": false, "fine_tuning": false, "vision": false, "classification": false },
    "job": "<job_id>",
    "root": "open-mistral-7b",
    "object": "model",
    "created": 1756746619,
    "owned_by": "<owner_id>",
    "max_context_length": 32768,
    "aliases": [],
    "TYPE": "fine-tuned",
    "archived": false
  }
]
```

- **覆盖度**："List all models available to the user"——该 key 可用模型（含用户微调模型）。
- **坑**：示例显示为数组易误判结构；解析需按 Base/FT 卡片字段区分；另有 `GET/DELETE /v1/models/{model_id}`（DELETE 仅限微调模型）。
- **来源**：https://docs.mistral.ai/api/ （models tag）

## SiliconFlow（硅基流动）

- **端点**：`GET https://api.siliconflow.cn/v1/models`（文档「获取用户模型列表」）。`Authorization: Bearer {API Key}` 标 required；实测无 token 返回 401 `{"code":30014,"message":"Token is invalid."}`。
- **过滤参数**：`type`（`text`/`image`/`audio`/`video`，**无 chat**）与 `sub_type`（`chat`/`embedding`/`reranker`/`text-to-image`/`image-to-image`/`speech-to-text`/`text-to-video`），可单独用 sub_type。
- **返回结构**：标准 `{object:"list", data:[...]}`，但条目**极简**：仅 `id`、`object`（`"model"`）、`created`、`owned_by`——无 context_length、无 pricing。
- **示例 JSON**（摘自 https://docs.siliconflow.cn/docs/api/models-get ，curl 抓取页面渲染文本核实）：

```json
{
  "object": "list",
  "data": [
    { "id": "deepseek-ai/DeepSeek-V4-Flash", "object": "model", "created": 0, "owned_by": "" }
  ]
}
```

cURL 示例：`curl --url 'https://api.siliconflow.cn/v1/models?sub_type=chat' --header 'Authorization: Bearer YOUR_API_KEY'`
- **覆盖度**：该 key 开放的平台模型目录；平台整体数百个模型（含 text/image/audio/video 全类型），精确数字未证实。
- **坑**：示例中 `created: 0`、`owned_by: ""` 为占位空值，不可依赖；筛聊天模型须用 `sub_type=chat`；错误响应为非 OpenAI 形态（`{"code":..., "message":..., "data":...}`，如 429 含 TPM 限额、504 为 `code:50505 Model service overloaded`）。
- **来源**：https://docs.siliconflow.cn/docs/api/models-get （官方文档，curl 抓取）；401 行为本次实测。

## Ollama

- **端点**：本地 `GET http://localhost:11434/v1/models`（OpenAI 兼容）与 `GET /api/tags`（原生）均存在。**本地无需鉴权**——官方原文 "The client requires an API key value, but Ollama ignores it"（示例仍传 `api_key='ollama'`）；云端 ollama.com 需 `OLLAMA_API_KEY`。
- **`/v1/models`**：标准 `{object:"list", data:[...]}`。官方仅说明两条：`created` 对应模型**最后修改时间**；`owned_by` 对应 Ollama 用户名，默认 `"library"`。其余字段未在文档列出——未证实。
- **`/api/tags`**（原生，字段丰富得多），官方示例（https://raw.githubusercontent.com/ollama/ollama/main/docs/api.md ）：

```json
{
  "models": [
    {
      "name": "deepseek-r1:latest",
      "model": "deepseek-r1:latest",
      "modified_at": "2025-05-10T08:06:48.639712648-07:00",
      "size": 4683075271,
      "digest": "0a8c266910232fd3291e71e5ba1e058cc5af9d411192cf88b6d30e92b6e73163",
      "details": { "parent_model": "", "format": "gguf", "family": "qwen2", "families": ["qwen2"], "parameter_size": "7.6B", "quantization_level": "Q4_K_M" }
    }
  ]
}
```

- **覆盖度**：两者都只列**本地已拉取**模型（量级取决于用户，几个到几十个），不含 ollama.com 目录；`GET /api/ps` 列「当前加载进内存」的模型（含 `size_vram`/`expires_at`），语义不同勿混淆。
- **坑**：要元数据用 `/api/tags`，`/v1/models` 仅适合 OpenAI 客户端连通性/模型名发现；`created` 是修改时间；模型 id 带 tag（缺省 `:latest`）。
- **来源**：https://raw.githubusercontent.com/ollama/ollama/main/docs/api/openai-compatibility.mdx 、https://raw.githubusercontent.com/ollama/ollama/main/docs/api.md （本次 curl 抓取核实；docs 正在迁移至 docs.ollama.com）

## LM Studio

- **端点**：`GET http://localhost:1234/v1/models`，列于官方 OpenAI 兼容端点表。
- **鉴权**：官方全部示例无 Authorization 头，本地默认无需鉴权（无鉴权时的确切响应码文档未写——未证实）。
- **覆盖度**：官方原文 "Returns the models visible to the server. **The list may include all downloaded models when Just-In-Time loading is enabled.**"——开 JIT 时可含全部已下载模型（不止已加载的）。
- **返回字段**：文档**未给出响应 JSON 示例**，字段（id/object/created/owned_by）未证实。官方导航提示：需要 loaded vs unloaded、max context、quantization 等丰富信息应使用 REST API v0（`/api/v0/models`）。
- **坑**：默认端口 1234；model 参数必须用 LM Studio 的模型标识符；要上下文长度/量化信息不要解析 `/v1/models`，改用 v0。
- **来源**：https://lmstudio.ai/docs/app/api/endpoints/openai 、https://lmstudio.ai/docs/developer/openai-compat/models

## vLLM

- **端点**：`GET /v1/models` 存在（官方文档列于 Basic APIs「List available models」；源码 `@router.get("/v1/models")` → `show_available_models()`）。
- **鉴权**：仅当启动时设置 `--api-key`（或 `VLLM_API_KEY`）才需鉴权（保护 `/v1` 前缀端点）；官方警告 `/invocations` 等非 /v1 路径不受保护。
- **返回结构**：标准 `{object:"list", data:[...]}`（源码 `ModelList: object="list", data: list[ModelCard]`）。
- **条目字段**（源码 `ModelCard`）：`object`（`"model"`）、`created`（**每次请求时 `int(time.time())` 动态生成**，非真实创建时间）、`owned_by`（固定 `"vllm"`）、`root`（模型路径）、`parent`（LoRA 条目的基座名）、**`max_model_len`**（非 `context_length`）、`permission` 数组（硬编码 `organization:"*"` 等）。无 pricing。
- **覆盖度**：**仅该实例启动时加载的模型**（`--served-model-name` 决定的基座 + 已加载 LoRA adapter），量级个位数到数十；无按 key 过滤。
- **来源**：https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/ （原 openai_compatible_server.html 已 301）；源码 https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/entrypoints/openai/models/api_router.py 、.../models/serving.py 、.../serve/engine/protocol.py

## one-api / new-api / Veloera 分叉

- **端点**：三家均有 `GET /v1/models`，均强制 `middleware.TokenAuth()`（必须持本站令牌 `sk-...`）。
  - one-api：`router/relay.go` 注册 `modelsRouter.GET("", controller.ListModels)` 及 `GET("/:model")`。
  - new-api：按请求头分派格式——带 `x-api-key`+`anthropic-version` 走 Anthropic 格式、`x-goog-api-key`/`?key=` 走 Gemini 格式、默认 OpenAI 格式；另有 `/v1beta/models`、`/v1beta/openai/models`。
  - Veloera：`/v1/models` + `/v1beta/models`（Gemini）+ `/hf/v1/models`。
- **返回结构**：
  - one-api / Veloera：`{"object":"list", "data":[...]}`（Veloera 响应行未逐字读到，结构与字段构造同源）。
  - new-api（OpenAI 分支）：`{"success": true, "data": [...], "object": "list"}`——**混入非标准 `success` 字段**。Anthropic 分支 `{data, first_id, has_more, last_id}`；Gemini 分支 `{models, nextPageToken}`。
- **条目字段**：one-api/Veloera 的 `OpenAIModels`：`id`、`object`、`created`（**硬编码 1626777600**）、`owned_by`（渠道名，自定义为 `"custom"`）、`permission`（伪造的固定 `modelperm-...`）、`root`、`parent`。new-api 精简为 `id/object/created/owned_by/supported_endpoint_types`（无 permission/root/parent）。三家均无 `context_length`/`pricing`。
- **覆盖度（重点）**：**不透传上游 `/models`，也不是全量**——本地按权限过滤：
  - one-api：取 `ctxkey.AvailableModels`（渠道同步过的话）或按用户分组 `CacheGetGroupModels` 与内置全量表取交集；表外模型以 `OwnedBy:"custom"` 追加。
  - new-api（本次已逐字核实 controller/model.go）：`getModelListGroups` 综合 userGroup/tokenGroup（含 `"auto"` 自动分组）→ `service.GetGroupsEnabledModels(ownerGroups)` → 若令牌开启模型限制（`token_model_limit_enabled`）按白名单过滤 → 过滤无计费配置的模型（除非 SelfUseMode 或用户设置允许）。`owned_by` 还会按渠道偏好覆盖为实际渠道名。
  - Veloera：同组过滤 + 令牌白名单，并为配置前缀的渠道生成 `前缀+模型名` 派生条目。
  - 规模：取决于管理员渠道配置，几到几百。
- **坑**：`created` 恒为 1626777600（2021-07-20）、permission 是假值；列表是「名义可用」不保证上游在线，与上游实时 `/models` 无关；one-api 的 `RetrieveModel` 查不到自定义模型时报错但 HTTP 状态仍是 200；new-api 的 `success:true` 与 OpenAI schema 有出入。
- **来源**（均为 GitHub raw 源码，2026-10-10 抓取）：
  - https://raw.githubusercontent.com/songquanpeng/one-api/main/router/relay.go 、.../controller/model.go
  - https://raw.githubusercontent.com/QuantumNous/new-api/main/router/relay-router.go 、.../controller/model.go 、.../relaykit/dto/pricing.go
  - https://raw.githubusercontent.com/Veloera/Veloera/main/router/relay-router.go 、.../controller/model.go

## Azure OpenAI

**分两条线（本次已从 azure-rest-api-specs 仓库逐版本 spec 核实）：**

1. **旧 dated data-plane（2022-12-01 起，含 2024-10-21 GA）**：
   - `GET {endpoint}/openai/models?api-version=2024-10-21` **存在**（在 OpenAIAuthoring spec 中；所有 stable/preview 版本的 authoring spec 均含 `/models`）。
   - Summary 原文："Gets a list of all models that are accessible by the Azure OpenAI resource. These include base models as well as all successfully completed fine-tuned models owned by the Azure OpenAI resource."——返回**基座模型+微调模型**，不是 deployments。
   - 鉴权：`api-key` 头或 Entra ID。
   - 返回 `{object:"list", data:[...]}`，但条目**不标准**：字段为 `status`、`capabilities`（fine_tune/inference/completion/chat_completion/embeddings）、`lifecycle_status`、`deprecation`（fine_tune/inference 时间戳）、`id`、**`created_at`（非 created）**、`object`；微调条目另有 `model`/`fine_tune`；**无 `owned_by`**。
   - 官方示例（摘自 OpenAIAuthoring/stable/2024-10-21/examples/get_models.json）：

```json
{
  "data": [
    {
      "status": "succeeded",
      "capabilities": { "fine_tune": true, "inference": true, "completion": true, "chat_completion": false, "embeddings": false },
      "lifecycle_status": "generally-available",
      "deprecation": { "fine_tune": 1677662127, "inference": 1709284527 },
      "id": "curie",
      "created_at": 1646126127,
      "object": "model"
    },
    { "status": "succeeded", "model": "curie", "fine_tune": "ft-72a2792ef7d24ba7b82c7fe4a37e379f", "id": "curie.ft-72a2792ef7d24ba7b82c7fe4a37e379f", "created_at": 1646126127, "object": "model" }
  ],
  "object": "list"
}
```

   - 注意：**inference spec（2024-10-21 等）只有 6 条 `/deployments/{id}/...` 路径，无 /models**——即「推理 spec 无 models，authoring spec 有 models」，两份 spec 合并服务于同一 data-plane URL 空间。
2. **新 v1 data-plane（2025-08 起 GA，`base_url` 为 `{endpoint}/openai/v1/`）**：
   - `GET {endpoint}/openai/v1/models` **存在**（OpenAI.v1 spec：`listModels`，"Lists the currently available models..."）。`api-version` 参数可选（默认 `v1`）。
   - 返回标准 `OpenAI.ListModelsResponse` = `{object:"list", data:[OpenAI.Model...]}`；Model 必填仅 `id`/`created`（unixtime）/`object`/`owned_by`，spec 内嵌示例 `{"id":"VAR_chat_model_id","object":"model","created":1686935002,"owned_by":"openai"}`。
   - v1 spec 中**不存在任何 /deployments 路径**；推理调用 `model` 字段直接填**部署名**。
   - 返回的是部署名还是基座模型——文档未逐字说明，**未证实**（实测口径一般认为等同该资源下的部署列表）。
3. **deployments 列表属管理面（control plane）**：`GET https://management.azure.com/.../Microsoft.CognitiveServices/accounts/{account}/deployments?api-version=2025-06-01`，返回 ARM 资源包装（`value` 数组，条目含 `sku`、`properties.model{name,format,version}`、`properties.provisioningState`），与 data-plane 完全不同。
- **坑**：
  - Azure 的 models ≠ deployments：旧 API 推理路径是 `/openai/deployments/{deployment-id}/chat/completions`，`model` 填部署名；v1 无 deployments 概念但 model 仍填部署名。
  - authoring `/openai/models` 与 OpenAI `/v1/models` 字段不兼容（`created_at` vs `created`、无 `owned_by`、多 `capabilities`/`deprecation`），不能混用。
  - v1 API 免 `api-version`；`base_url` 须以 `/openai/v1/` 结尾；官方提示响应可能随时新增字段，只解析所需字段。
- **来源**：
  - https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle
  - https://learn.microsoft.com/en-us/azure/ai-services/openai/reference （2024-10-21 image/audio inference）
  - https://github.com/Azure/azure-rest-api-specs/tree/main/specification/ai/data-plane/OpenAI.v1 （azure-v1-v1-generated.json，本次 clone 核实）
  - https://github.com/Azure/azure-rest-api-specs/tree/main/specification/cognitiveservices/data-plane/OpenAIAuthoring/stable/2024-10-21 （azureopenai.json + examples/get_models.json，本次 clone 核实；2022-12-01～2025-04-01-preview 全部版本逐版本验证 /models 存在）
  - 管理面 deployments：https://learn.microsoft.com/en-us/rest/api/microsoftfoundry/accountmanagement/deployments/list

---

## 汇总表（草稿）

| 服务商 | /models 可用性 | 除 id 外字段（要点） | 规模 | 备注 |
|---|---|---|---|---|
| OpenRouter | ✅ `/api/v1/models`，需 key | name、description、context_length、pricing（字符串/每 token$）、architecture、top_provider、supported_parameters 等；**无** object/owned_by 顶层非标准 | 数百，分页 limit≤1000 | 缺 `object:"list"`；默认只返回 text 输出模型 |
| DeepSeek | ✅ `/models` | owned_by、name、context_window、max_output_tokens、modalities、effort、api_capabilities；**无 created** | 个位数 | 字段名是 context_window 非 context_length |
| Moonshot (.ai/.cn) | ✅ 两站，必须 Bearer | created、owned_by、context_length、supports_image_in/video_in/reasoning | 几个~十几个 | 两站 key 不通用；示例 created:123 为占位 |
| xAI | ✅ `/v1/models`，按 key 过滤 | 条目精简未证实；价格须查 `/v1/language-models`（单位：美分/亿 token） | 未证实 | 价格单位非主流；分 language/image/video 三类端点 |
| z.ai | ❌ 文档无此端点 | —（未证实是否实现） | — | 模型目录看定价页；无 key 一律 401 无法探测 |
| Groq | ✅ `/openai/v1/models`，需 key | created、owned_by、active、context_window、public_apps | 几十个 | 含 Whisper/TTS/guard 非聊天模型；whisper 的 context_window=448 是音频帧 |
| Together | ✅ `/v1/models`，需 key | type、display_name、organization、license、context_length、pricing（数字） | 数百 | **顶层裸数组**非 list 包装；type 含 video/audio 等 |
| Fireworks | ✅ `/inference/v1/models` 存在（实测 401 路由在），字段未证实；另有管理面 `/v1/accounts/{id}/models`（camelCase、AIP 分页） | 管理面：contextLength、supportsImageInput/Tools 等数十字段 | 管理面账号级，分页 50-200 | OpenAI 兼容面返回结构文档未载明 |
| Mistral | ✅ `/v1/models`，需 key | created、owned_by、capabilities、max_context_length、aliases、archived、deprecation | 几十（含微调） | Base/FT 两种卡片联合类型；文档示例误显为裸数组 |
| SiliconFlow | ✅ `/v1/models`，需 key | 仅 object/created/owned_by（示例 created:0 为占位） | 平台数百，条目极简 | 筛选用 sub_type=chat；错误体非 OpenAI 格式 |
| Ollama | ✅ `/v1/models`（本地免鉴权） | created（=修改时间）、owned_by（="library"） | 本地已拉取，几个~几十个 | 元数据用 `/api/tags`；`/api/ps` 是内存中模型 |
| LM Studio | ✅ `/v1/models`（本地免鉴权） | 字段文档未载明（未证实） | 本机已下载（JIT 时） | 丰富信息走 REST v0 `/api/v0/models` |
| vLLM | ✅ `/v1/models`（设 --api-key 才需鉴权） | created（动态生成）、owned_by="vllm"、root、parent、max_model_len、permission（假值） | 启动加载的 1~数十个 | 只含本实例模型；created 每次请求现造 |
| one-api/new-api/Veloera | ✅ `/v1/models`，强制令牌 | created 恒 1626777600、owned_by=渠道名、permission 假值；new-api 有 supported_endpoint_types | 按分组/令牌过滤，几~几百 | 不透传上游；new-api 响应混入 success:true |
| Azure OpenAI | ✅ 双线：旧 dated `GET /openai/models?api-version=...`（authoring，基座+微调，字段不兼容）；新 v1 `GET /openai/v1/models`（标准四字段） | 旧：created_at、capabilities、lifecycle_status、deprecation，无 owned_by；新：created/object/owned_by | 资源级 | deployments 列表在管理面（ARM）；推理 model=部署名 |
