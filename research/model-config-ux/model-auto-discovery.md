# OpenAI 兼容连接的模型自动获取：事实与机制研究

核查日期：2026-10-10。研究范围：公开网络一手来源（各厂商 API 文档、models.dev、OpenRouter API、LiteLLM 仓库、Cherry Studio/LobeChat/OpenCode/Continue/Cline/Roo Code/Open WebUI/Jan/Chatbox 源码），全部来源 URL 见文末清单。原始核查记录在同目录 `raw/`（provider-models-endpoints.md / metadata-sources.md / capability-inference.md / progressive-flow.md）。

## 问题与用途

Molly 的 OpenAI 兼容连接目前要求用户手工为每个模型填写 `CompatibleModelDefinitionSchema` 的全部字段（`embedded-harness.ts:424` (packages/shared/src/embedded-harness.ts#L424)）：`modelId`、`name`、`input`（text/image）、`contextWindow`、`maxTokens`、`thinking`（级别集合）、`toolCalls`、`usageInStreaming`、`maxTokensField`。目标是评估「自动获取」的可行性：连接检查（已会发 `GET {base}/models` 并解析 id 列表，`connection-check.ts:63` (apps/electron/src/main/services/connection-check.ts#L63)）成功后自动列模型、用户勾选、元数据自动补全、缺什么再问什么。

本文只交付事实与机制分析，不设计 Molly UI。每个字段给出明确结论：可 / 部分可 / 不可自动获得 + 条件。

## 当前结论

1. **「自动列模型」对绝大多数 OpenAI 兼容端点可行**：15 类服务商中 12 类确认 `GET /models` 返回 id 列表；Fireworks（路由存在但返回结构未证实）、z.ai（文档无此端点）、Azure（v1 端点返回基座模型还是部署名未证实）三家带保留条件。返回结构有三处常见不兼容（OpenRouter 顶层无 `object:"list"`；Together 顶层是裸数组；new-api 混入 `success:true`），解析器必须宽松。
2. **`/models` 响应平均只能自动补 2-3 个字段**（modelId、部分家的 contextWindow、少数家的能力布尔）。modelId 是唯一定论「可自动获得」的字段；name、contextWindow 为「部分可」。
3. **补全其余字段的现实路径是「内置元数据快照 + 在线补充」**：models.dev（MIT、单文件 JSON、字段为客户端配置而生、9 家中小厂商全覆盖）是唯一适合离线打包进桌面应用的兜底库；OpenRouter `/api/v1/models` 字段最富、免鉴权，适合在线补充；LiteLLM JSON 作交叉核对。这条路径已被 OpenCode（models.dev）、Chatbox（内置 models.dev 快照 + 热更新）、Cline（models.dev 驱动的 catalog）、LobeChat（内置 model-bank）验证。
4. **thinking 级别、max_tokens 字段名、tool calling、图像输入、streaming usage 五个字段均为「部分可自动获得」**：知名模型可查中央数据库/厂商目录；自定义/私有模型必须保留用户声明兜底。业内没有任何产品用探测请求推断能力字段（探测只用于连通性健康检查）。
5. **Azure OpenAI 是唯一「必须手填 model id」的主流场景**（id 是租户自定义 deployment 名）；z.ai 无文档化 `/models`；聚合网关（one-api 系）返回的是按令牌分组过滤后的子集——这些场景都必须保留「手输 model id」一等通道。
6. **逐字段结论**（详见后文各节）：

| 字段 | 可自动获得？ | 主要来源 |
|---|---|---|
| modelId | **可** | `GET /models`（Azure 除外） |
| name（显示名） | 部分可 | OpenRouter/Together/Fireworks 自带；否则用 modelId 或元数据库 |
| contextWindow | 部分可 | OpenRouter/DeepSeek/Moonshot/Groq/Together/Mistral/Ollama/LM Studio/vLLM 自带；其余靠 models.dev |
| maxTokens（输出上限） | 部分可 | OpenRouter `top_provider.max_completion_tokens`、DeepSeek、models.dev `limit.output`；多数家 /models 不给 |
| input（图像输入） | 部分可 | OpenRouter/Moonshot/Mistral/models.dev/LiteLLM 可查；否则启发式或用户声明 |
| thinking 级别 | 部分可（仅知名模型） | models.dev `reasoning_options`、Cherry/Cline 目录；无探测手段 |
| toolCalls | 部分可 | models.dev `tool_call`、LiteLLM `supports_function_calling`、OpenRouter `supported_parameters` |
| usageInStreaming | **不需要推断** | 业内无条件发 `include_usage:true`，不支持的网关静默忽略 |
| maxTokensField | 部分可 | 模型名启发式（o\d/gpt-5+ → max_completion_tokens）+ 用户覆盖 |

## 各家 /models 实测行为

核查日期 2026-10-10；详情与示例 JSON 见 [raw/provider-models-endpoints.md](raw/provider-models-endpoints.md)。

| 服务商 | /models 可用性 | 除 id 外字段（要点） | 规模 | 备注 |
|---|---|---|---|---|
| OpenRouter | ✅ `/api/v1/models`（免鉴权实测可用；Molly 场景用户必有 key） | name、description、context_length、pricing（字符串/每 token$）、architecture（modalities）、top_provider.max_completion_tokens、supported_parameters | 实测 458 个，分页 limit≤1000 | 顶层**无** `object:"list"`；默认只返回 text 输出模型 |
| DeepSeek | ✅ `/models` | owned_by、name、context_window、max_output_tokens、modalities、effort、api_capabilities；**无 created** | 个位数 | 字段名是 `context_window` 非 `context_length` |
| Moonshot (.ai/.cn) | ✅ 两站，必须 Bearer | created、owned_by、context_length、**supports_image_in/video_in/reasoning** 布尔 | 几个~十几个 | 两站 key 不通用；文档示例 created:123 为占位 |
| xAI | ✅ `/v1/models`，按 key 过滤 | 条目精简（具体字段集文档未列全）；价格须查 `/v1/language-models`（单位：美分/亿 token） | 未证实 | 分 language/image/video 三类端点 |
| z.ai | ❌ **官方文档无此端点** | —（未证实是否实现，无 key 一律 401 无法探测） | — | 模型目录看定价页；OpenAI SDK 兼容仅演示 chat.completions |
| Groq | ✅ `/openai/v1/models`，需 key | created、owned_by、active、**context_window**、public_apps | 几十个 | 含 Whisper/TTS/guard 非聊天模型；whisper 的 context_window=448 是音频帧非 token |
| Together | ✅ `/v1/models`，需 key | **type**（chat/image/embedding/audio 等）、display_name、organization、license、context_length、pricing（数字） | 数百 | **顶层裸数组**非 list 包装 |
| Fireworks | ✅ `/inference/v1/models` 存在（实测 401 路由在），返回字段未证实；管理面 `/v1/accounts/{id}/models` 为 camelCase AIP 分页格式 | 管理面：contextLength、supportsImageInput、supportsTools 等数十字段 | 管理面账号级，分页 50-200 | OpenAI 兼容面返回结构文档未载明 |
| Mistral | ✅ `/v1/models`，需 key | created、owned_by、**capabilities**（function_calling/vision 等布尔）、**max_context_length**、aliases、archived、deprecation | 几十（含用户微调） | Base/FT 两种卡片联合类型；文档示例误显为裸数组 |
| SiliconFlow | ✅ `/v1/models`，需 key | 仅 object/created/owned_by（示例 created:0 为占位空值） | 平台数百，条目极简 | 筛聊天模型须用 `?sub_type=chat`；错误体非 OpenAI 格式 |
| Ollama | ✅ `/v1/models`，本地免鉴权 | created（=最后修改时间）、owned_by（="library"） | 本地已拉取，几个~几十个 | 元数据用 `/api/tags`（含 size/family/capabilities）+ `/api/show` 补 context_length |
| LM Studio | ✅ `/v1/models`，本地免鉴权 | 字段文档未载明（未证实） | 本机已下载（开 JIT 时）或已加载 | 丰富信息走原生 REST v0 `/api/v0/models`（max context、量化等） |
| vLLM | ✅ `/v1/models`（设 --api-key 才需鉴权） | created（每次请求现造）、owned_by="vllm"、root、parent、**max_model_len**、permission（假值） | 启动加载的 1~数十个 | 只含本实例模型 |
| one-api / new-api / Veloera | ✅ `/v1/models`，强制本站令牌 | created **恒 1626777600**、owned_by=渠道名、permission 假值；new-api 有 `supported_endpoint_types` 扩展字段 | 按用户分组 ∩ 令牌白名单过滤，几~几百 | **不透传上游 /models**；new-api 响应混入 `success:true`；列表是该 key 可用子集 |
| Azure OpenAI | ✅ 双线：旧 dated `GET /openai/models?api-version=...`（authoring spec，2022-12-01 起含 2024-10-21 GA；返回基座+微调模型，字段不兼容：created_at、capabilities、deprecation，无 owned_by）；新 v1 `GET /openai/v1/models`（2025-08 GA，标准四字段） | 见左 | 资源级 | **推理时 model 填 deployment 名**（用户自定义，如 `gpt-4o-prod`）；deployments 列表只在 ARM 管理面（`management.azure.com`），data-plane 拿不到 |

结构兼容性要点（对解析器的直接影响）：

- 顶层包装三种形态：`{object:"list", data:[...]}`（多数）、`{data:[...]}`（OpenRouter）、裸数组 `[...]`（Together）。new-api 多一个 `success:true`。
- 条目里 `created`/`owned_by`/`permission` 普遍存在但常为占位/假值（one-api 恒 1626777600、vLLM 每次现造、SiliconFlow 示例为 0），**不可依赖**。
- context 字段名至少有五种写法：`context_length`（OpenRouter/Moonshot/Together）、`context_window`（DeepSeek/Groq）、`max_context_length`（Mistral）、`max_model_len`（vLLM）、以及 Ollama 的 `/api/show` 里 `model_info.*.context_length`。

## 元数据源对照

核查日期 2026-10-10；详情与实测字段见 [raw/metadata-sources.md](raw/metadata-sources.md)。

| 来源 | 数据格式 | 关键字段 | 更新机制 | 许可证 | 可程序化消费 |
|---|---|---|---|---|---|
| OpenRouter `/api/v1/models`（+ `/models/{author}/{slug}/endpoints`） | 在线 JSON，免鉴权（实测），约 765 KB / 458 模型 | context_length、architecture.input_modalities、pricing（美元/token，字符串）、top_provider.max_completion_tokens、supported_parameters、endpoints 级的 supports_tool_choice/max_completion_tokens | 运营方实时维护 | **再分发无明文条款**（仅确认 API 公开免鉴权） | 可（在线）；但只覆盖 OpenRouter 渠道，价格是渠道价 |
| models.dev（sst/opencode 维护）`api.json` | 在线/可打包 JSON，约 5.4 MB / 226 provider；另有 models.json、catalog.json | provider 层：api（baseURL）、doc、env、npm；模型层：limit.context/output、modalities、tool_call、reasoning、**reasoning_options**（effort 值列表/toggle/budget_tokens 三种方言）、attachment、structured_output、cost（美元/百万 token）、release_date、status | 社区 PR 高频（核查当天有提交），CI 构建 | **MIT**（仓库 LICENSE 原文） | 可；静态、免鉴权、有 JSON Schema |
| LiteLLM `model_prices_and_context_window.json` | 仓库根目录单文件，约 2.7 MB / 4035 条目 | max_input_tokens、max_output_tokens、input/output_cost_per_token、litellm_provider、supports_function_calling/vision/reasoning/prompt_caching 等布尔、mode、source | 日级高频社区 PR；2026-10 起正在删除 openrouter 派生行 | **MIT**（根目录；仅 enterprise/ 目录例外） | 可；但 key 命名不规则（需前缀匹配+别名表）、max_tokens 语义含混、长尾准确性有公开 issue（#35904/#37274/#41782）背书的不良记录 |
| 厂商文档页（DeepSeek pricing 页、Moonshot 定价页、SiliconFlow 文档等） | HTML | — | — | — | **不可**；只适合人工核对入口（models.dev 的 `doc` 与 LiteLLM 的 `source` 字段可直接取得链接） |
| Helicone `packages/cost` | TS 代码形式的成本表（Apache-2.0） | 成本映射 | 随仓库 | Apache-2.0 | 部分可（需写适配器抽取），覆盖以 Helicone 接入方为限 |

覆盖度对照（9 家中小厂商，2026-10-10 实测）：

- models.dev **全覆盖**：siliconflow(57)+siliconflow-cn(44)、zai(18)+zai-coding-plan(7)、deepseek(4)、moonshotai(4)+moonshotai-cn(4)、groq(16)、togetherai(29)、fireworks-ai(22)、mistral(42)、xai(13)。注意 DeepSeek/Moonshot 各仅 4 个模型，可能滞后于厂商在售列表。
- LiteLLM 缺 **SiliconFlow**（0 命中），其余 8 家有覆盖且条目更多，但前缀需别名表（`together_ai` vs `togetherai`、`fireworks_ai` vs `fireworks-ai`）。
- 两家互补：SiliconFlow 只能靠 models.dev（或 OpenRouter）。

结论倾向（与子任务一致）：**离线打包兜底用 models.dev 快照**（MIT 明确、字段面向客户端配置、单位统一、可按 provider 裁剪体积）；**在线补充用 OpenRouter**（字段最富、实时，但再分发条款不确定，只适合在线查询+缓存）；**LiteLLM 作第二在线来源/交叉核对**（`supports_*` 布尔更细，但不宜单独作兜底）。

## 不可自动字段的处理惯例

详情与源码证据见 [raw/capability-inference.md](raw/capability-inference.md)。业内五类机制按主流程度排序：

1. **中央数据库/厂商目录**（覆盖率最高、零延迟零计费，是 OpenCode/Cline/LobeChat/Cherry 的主力）：OpenCode 全量消费 models.dev（`tool_call`/`reasoning_options`/`modalities` 直接进 schema）；Cline 内置生成目录（`capabilities`、`reasoningOptions` 含 effort 值全集）；LobeChat 内置 model-bank（~80 provider/~1900 模型卡片，手写 `abilities`）；Cherry Studio 内置 `@cherrystudio/provider-registry`（60+ 厂商文件，含 `reasoning.selectableEfforts` 逐 SKU 正则表）；Roo Code 消费 OpenRouter `/models`（`architecture.input_modalities`→图像、`supported_parameters`含"reasoning"→thinking）与 LiteLLM `/v1/model/info`。
2. **用户声明兜底**（所有产品都保留）：Continue 唯一机制即用户声明（`capabilities: ["tool_use","image_input"]`，其 `autodetectModels` 只展开模型名不推断能力）；Cherry/Roo 对自定义模型同样靠用户声明。
3. **模型名启发式**（仅用于「规则稳定」的属性）：max_tokens 字段名——Continue `/^o[0-9]+/` 或 `/gpt-[5-9]/` → `max_completion_tokens`（core/llm/llms/OpenAI.ts:221）；Cherry 的 o1/o3/o4-mini/gpt-5/gpt-6 前缀表（reasoningModelTransform.ts）。OpenCode 则按 provider 一刀切改写（Snowflake 插件 max_tokens→max_completion_tokens；Cerebras 反向删除）。
4. **试探请求**（只测连通不测能力）：唯一完整实现是 Cherry Studio 健康检查（AiService.checkModel 发 `prompt:'hi'`，对图像/视频/TTS 等烧钱端点主动跳过），**不判定任何能力字段**。其余 6 家产品源码中均未找到能力探测证据。
5. **streaming usage 无人探测**：OpenCode 对 openai-compatible 无条件发 `stream_options.include_usage:true`（provider.ts:1806）；不支持的网关通常静默忽略未知字段而非报错，因此业内不设能力位——这直接支持 Molly 将 `usageInStreaming` 从必填改为「默认开启 + 出问题再关」。

逐字段结论（对应 Molly schema 的难字段）：

| 字段 | 可自动获得？ | 条件 |
|---|---|---|
| maxTokens（输出上限） | 部分可 | OpenRouter `top_provider.max_completion_tokens`、DeepSeek `max_output_tokens`、models.dev `limit.output`；多数家 /models 不给，未命中靠 models.dev，再不命中用户声明（schema 要求 ≤ contextWindow 的正整数） |
| thinking 级别集合 | 部分可 | models.dev `reasoning_options`（effort 值列表）/Cline 目录/Cherry 正则表可给精确集合，**仅对知名模型**；自定义/私有模型不可；探测成本过高（7 级 × 每模型）且无法区分「不支持」与「忽略」，业内无人做 |
| maxTokensField | 部分可 | 模型名启发式对 OpenAI 系稳定；第三方代理转发旧模型名但要求新字段的情形无规则可判，需用户覆盖 |
| usageInStreaming | 不需要推断 | 无条件发送 + 静默忽略是业内共识（OpenCode 实证） |
| toolCalls | 部分可 | models.dev `tool_call`、LiteLLM `supports_function_calling`、OpenRouter `supported_parameters`、LobeChat `abilities.functionCall`；未命中靠启发式（id/description 文本匹配）或用户声明 |
| input（图像输入） | 部分可 | models.dev `modalities.input`、OpenRouter `architecture.input_modalities`、Moonshot `supports_image_in`、Mistral `capabilities.vision`、LiteLLM `supports_vision`；未命中靠启发式（`-vision`/`-vl` 等）或用户声明 |

## 渐进式流程的最佳实践与坑

详情与逐产品证据见 [raw/progressive-flow.md](raw/progressive-flow.md)。

已验证该流程的产品（按实现强度排序）：**Chatbox**（拉 `/models` → 解析自带字段 → 内置 models.dev 快照 enrich 覆盖能力/contextWindow/maxOutput → 拉取失败整体用注册表兜底 → 近 6 个月新模型打「New」标）；**LobeChat**（拉远程列表 → model-bank 按 id 精确匹配合并，事实性字段以卡片为准、用户展示性自定义保留）；**Cherry Studio**（Strategy Registry 多 fetcher：Ollama `/api/tags`+`/api/show`、LM Studio 原生 API 优先、OpenRouter 三端点合并、new-api 读 `supported_endpoint_types`、通用 OpenAI 兼容兜底只拿 id）；**Cline**（models.dev 驱动 catalog + OpenRouter 自带字段；通用兼容端点保留全手填）；Open WebUI（后台周期拉取合并 + 白名单模式）、Jan（api_key 可选、失败按 401/403/404 分类提示）、LibreChat（`models.fetch` 失败回退 `models.default`）、Msty（Azure 列全量官方目录让用户勾选已部署者）。

主要坑与对策（按风险排序）：

1. **Azure/私有部署的 id 不可枚举**：deployment 名任意（`gpt-4o-prod`），公共元数据库无法匹配；旧 API 版本无 `/models`。所有产品的对策都是保留手输 id 一等通道（Open WebUI 直接用白名单不拉取；Msty 列官方目录让用户自行勾选）。元数据匹配对「含知名子串的自定义 id」不可盲信子串匹配。
2. **聚合网关大列表 + 无类型信息**：one-api 系返回数百条 id（含 embedding/tts/dall-e）。`/v1/models` 响应本身无类型字段，名称关键词黑名单是普遍兜底（Cherry `['tts','whisper','transcribe','speech','audio','realtime','sora']`、Open WebUI `('babbage','dall-e','davinci','embedding','tts','whisper')`，且两家都只对官方 OpenAI 生效）；更可靠的做法是消费网关扩展字段（new-api 的 `supported_endpoint_types`）。UI 收敛形态为「搜索框 + 类型分组 + 启用/停用分栏」，无一家做分页（一次性列表 + 客户端搜索）。
3. **拉取列表 ≠ 网关全部模型**：new-api 按用户分组 ∩ 令牌白名单过滤（controller/model.go 实锤）；xAI 也明示按 key 过滤。这是优点（避免选了不能用的模型），但要认知「拉不到的 ≠ 不存在」，保留手输通道，换 key 后列表会变。
4. **本地服务状态敏感**：LM Studio `/v1/models` 只列已 Load 模型（Cherry 对策：原生 API 优先、失败回退 `/v1/models`）；Ollama 需 `/api/tags`（capabilities）+ `/api/show`（context_length）双端点组合才补得全；本地服务免鉴权（Ollama 官方明示忽略 key；Jan/Open WebUI 无 key 不发 Authorization 头）。
5. **失败回退是必备而非可选**：所有成熟产品都保留手输兜底；拉取失败应给分类错误提示（Jan 的 401/403/404 分类）。
6. **元数据库新鲜度是长期承诺**：LobeChat 有专门维护 skill（只采信官方来源）；Chatbox 用 models.dev 快照 + 7 天 TTL 热更新。直接消费 models.dev 公共 API 可显著降低维护成本（Chatbox/Cline/OpenCode 均已如此）。

对 Molly 目标流程的可行性分档（事实性归纳，非 UI 设计）：

Molly 侧边界先行说明：`CompatibleModelDefinitionSchema` 的 `input` 枚举只有 text/image，即 Molly 只消费聊天（+可选视觉）模型；研究发现的非聊天模型（whisper/embedding/dall-e/tts 等）对 Molly 的处置就是「过滤掉、不进勾选列表」，schema 本身不构成缺口，但这让「巨量列表过滤」从体验优化变成正确性要求。另外 `name` 为必填非空字符串，自动流程中绝大多数服务不返回显示名，只能由 modelId 派生（或元数据库补），UI 上不应把它当作「信息缺失」。

- **全流程可自动**（连接 → 列表 → 元数据）：OpenRouter、new-api 系、Moonshot、Mistral、DeepSeek、Groq、Ollama、LM Studio——`/models`（或原生端点）自带 contextWindow 与部分能力字段，剩余字段由 models.dev 快照补齐。
- **半自动**（列表自动 + 元数据靠本地库匹配，未命中手填）：通用 OpenAI 兼容网关（one-api 旧版、自建 LiteLLM 等）、SiliconFlow（/models 只有 id）、xAI。
- **必须手填 model id**：Azure OpenAI（deployment 名）；z.ai（无文档化 /models，只能手输 + models.dev 的 zai provider 补元数据）。

## 关键未知

1. **z.ai 是否实现了 `/models`**：官方 openapi.json 无此路径，无有效 key 一律 401，无法从外部证实。若有 z.ai key 可一次 curl 定论。
2. **xAI `/v1/models` 条目的完整字段集**：文档只描述为 "minimalized information" 未逐字段列出；价格字段确认在 `/v1/language-models`。
3. **Fireworks `/inference/v1/models` 的返回结构**：路由存在（401 实测），但官方文档无 schema，字段未证实。
4. **Azure v1 `/openai/v1/models` 返回的是部署名还是基座模型**：spec 未逐字说明；这决定 Azure 能否从「必须手填」降级为「半自动」。需一个真实 Azure 资源实测。
5. **OpenRouter `/api/v1/models` 数据的再分发/镜像许可**：无明文条款；在线查询+缓存无虞，打包进应用存在条款不确定性（models.dev 的 MIT 无此问题）。
6. **models.dev 的更新延迟未量化**：小厂（DeepSeek/Moonshot 各仅 4 模型）可能滞后于在售列表；对 Molly 的影响是「兜底库可能缺最新模型」，需手输通道吸收。
7. **new-api 系之外的聚合网关**（如 aihubmix、DMXAPI 等国产聚合站）返回结构未逐一核查；按 one-api 同源推断大概率类似，但未证实。
8. **LM Studio `/v1/models` 的具体字段**：官方文档无响应示例（丰富信息在 REST v0 `/api/v0/models`）。

## 来源清单

全部核查日期 2026-10-10。示例 JSON 与更完整 URL 见 raw/ 各文件。

厂商 API 文档与规范：

- OpenRouter：https://openrouter.ai/openapi.yaml ；https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- DeepSeek：https://api-docs.deepseek.com/api/list-models
- Moonshot：https://platform.moonshot.ai/docs/api/list-models ；https://platform.moonshot.cn/docs/api/list-models
- xAI：https://docs.x.ai/developers/rest-api-reference/inference/models
- z.ai：https://docs.z.ai/api-reference/introduction ；https://docs.z.ai/openapi.json
- Groq：https://console.groq.com/docs/api-reference ；https://console.groq.com/docs/models
- Together：https://docs.together.ai/reference/models
- Fireworks：https://docs.fireworks.ai/api-reference/list-models
- Mistral：https://docs.mistral.ai/api/ （models tag）
- SiliconFlow：https://docs.siliconflow.cn/docs/api/models-get
- Ollama：https://raw.githubusercontent.com/ollama/ollama/main/docs/api/openai-compatibility.mdx ；https://raw.githubusercontent.com/ollama/ollama/main/docs/api.md
- LM Studio：https://lmstudio.ai/docs/app/api/endpoints/openai ；https://lmstudio.ai/docs/developer/openai-compat/models
- vLLM：https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/ ；源码 vllm/entrypoints/openai/models/api_router.py、serving.py、serve/engine/protocol.py
- one-api：https://raw.githubusercontent.com/songquanpeng/one-api/main/router/relay.go 、controller/model.go；new-api：https://raw.githubusercontent.com/QuantumNous/new-api/main/router/relay-router.go 、controller/model.go、relaykit/dto/pricing.go；Veloera：https://raw.githubusercontent.com/Veloera/Veloera/main/router/relay-router.go 、controller/model.go
- Azure：https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle ；https://github.com/Azure/azure-rest-api-specs/tree/main/specification/ai/data-plane/OpenAI.v1 ；https://github.com/Azure/azure-rest-api-specs/tree/main/specification/cognitiveservices/data-plane/OpenAIAuthoring/stable/2024-10-21 ；https://learn.microsoft.com/en-us/rest/api/microsoftfoundry/accountmanagement/deployments/list

元数据源：

- models.dev：https://models.dev/api.json ；https://github.com/sst/models.dev （dev 分支，LICENSE 为 MIT）
- LiteLLM：https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json ；LICENSE https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE ；准确性 issue #35904/#37274/#41782
- Helicone：https://github.com/Helicone/helicone （packages/cost，Apache-2.0）

开源客户端源码（均为浅克隆，commit 锚点见 raw/capability-inference.md 与 raw/progressive-flow.md）：

- CherryHQ/cherry-studio main@1cceda97（listModels.ts、AiService.ts、provider-registry、reasoningModelTransform.ts）
- lobehub/lobe-chat main@19478f19 / 6c7a6fb0（model-bank、model-runtime/providers、repositories/aiInfra）
- sst/opencode dev@055d95bb（packages/core/src/models-dev.ts、provider.ts、plugin/）
- continuedev/continue main@5522c6f4（core/llm/llms/OpenAI.ts、packages/config-yaml/src/schemas/models.ts）
- cline/cline main@bf71bf7c（sdk/packages/llms/src/catalog、controller/models/）
- RooVetGit/Roo-Code main@b867ec91（api/providers/fetchers/openrouter.ts、litellm.ts；packages/types/src/model.ts）
- open-webui/open-webui main@8bd8b4fa（backend/open_webui/routers/openai.py）
- janhq/jan main@f2cd837f（web-app/src/hooks/useProviderModels.ts、services/providers/tauri.ts）
- chatboxai/chatbox main@0ac6385a（src/renderer/packages/model-registry/enrich.ts、fetch.ts；shared/providers/definitions/models/custom-openai.ts）
- danny-avila/LibreChat main@e1dfc104 + https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint
- 产品文档：https://docs.cherry-ai.com/pre-basic/providers（及 /ollama、/lm-studio、/azure-openai、/oneapi）；https://lobehub.com/docs/usage/providers/openai ；https://docs.roocode.com/providers/openrouter 与 /openai-compatible ；https://docs.cline.bot/provider-config/openrouter ；https://docs.msty.ai/studio/how-tos/azure-openai

Molly 侧现状（本次 grounding）：

- `packages/shared/src/embedded-harness.ts:424` (packages/shared/src/embedded-harness.ts#L424) `CompatibleModelDefinitionSchema`（9 个必填字段）
- `apps/electron/src/main/services/connection-check.ts:29` (apps/electron/src/main/services/connection-check.ts#L29) openai 风格检查发 `GET {base}/models`；`connection-check.ts:63` (apps/electron/src/main/services/connection-check.ts#L63) `listedModels` 解析 `{data:[{id}]}`（当前只兼容标准包装，OpenRouter/Together/new-api 三种非标准形态均会被判 `invalid_response`——这是落地时第一个要解决的解析兼容点）
- `packages/components/src/components/settings/model-connection-setting.tsx:255` (packages/components/src/components/settings/model-connection-setting.tsx#L255) `listed` 仅用于 checklist 的 not-listed 标记
