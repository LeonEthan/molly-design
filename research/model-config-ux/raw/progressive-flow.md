# 渐进式模型配置流程：产品事实清单

> 核查日期：2026-10-10。目标流程：「先连上 → 自动列模型 → 用户勾选 → 元数据自动补全 → 缺什么再问什么」。
> 证据等级：源码 > 官方文档 > 评测/社区。源码证据均注明仓库、文件与（如可得）commit。

---

## 1. 各产品「连接后自动拉取模型列表」现状

### 1.1 Cherry Studio（开源桌面客户端）

- **交互流程**：设置 → 模型服务 → 选择内置 Provider（内置 60+ 模板）→ 填 API 密钥/地址 → 点「获取模型列表」按钮（手动触发，非连接成功后自动触发）→ 在弹出列表中勾选要启用的模型；另有「检测」按钮用任一对话模型验证连接。文档原话：「点击 **获取模型列表**，按需添加你常用的对话/嵌入/视觉模型」「添加模型（点击管理自动获取或手动输入）」。
  - 证据：https://docs.cherry-ai.com/pre-basic/providers ；https://docs.cherry-ai.com/pre-basic/providers/oneapi （核查 2026-10-10）
- **实现架构**：主进程 Strategy Registry（第一个命中的 fetcher 生效），针对不同 Provider 走不同拉取器：`ollamaFetcher`（`/api/tags` + 逐模型 `/api/show` 补 contextWindow）、`lmStudioFetcher`（优先原生 `/api/v1/models`，失败回退 OpenAI 兼容 `/v1/models`）、`openRouterFetcher`（同时拉 `/models`、`/embeddings/models`、`/images/models` 三端点合并）、`newApiFetcher`（读 new-api 扩展字段 `supported_endpoint_types`）、通用 `openAICompatibleFetcher`（兜底，直接 `GET {baseUrl}/models`）。
  - 证据：github.com/CherryHQ/cherry-studio，commit `1cceda97`（2026-10-10），`src/main/ai/provider/listModels.ts` 第 282/1026/673/609/911 行。
- **去重**：所有 fetcher 均用 `dedup(list, m => m.id)` 按模型 id 去重（listModels.ts 多处）。
- **过滤非聊天模型**：
  - OpenAI 官方 provider 有明确关键词黑名单：`EXCLUDED_OPENAI_MODEL_KEYWORDS = ['tts', 'whisper', 'transcribe', 'speech', 'audio', 'realtime', 'sora']`，仅对「官方 OpenAI provider」生效（listModels.ts 第 831–836、899 行）。**注意：仅排除音频/视频类；embedding 模型不在黑名单，仍会被列出**（embedding 是 Cherry Studio 支持的能力类型）。
  - GitHub Copilot fetcher 另过滤 `policy.state === 'disabled'`、`tts|whisper|speech` 前缀（listModels.ts 约 459–470 行）。
  - 通用 OpenAI 兼容 fetcher（自定义 provider 兜底）**不过滤**，返回什么列什么（listModels.ts 第 901–919 行 `listOpenAICompatibleModels`）。
- **能力/元数据补全**：new-api 系读 `supported_endpoint_types` 映射端点类型与能力（listModels.ts 第 557–604 行 `ENDPOINT_TYPE_ALIASES`）；Ollama 从 `/api/show` 读 `context_length`、从 `/api/tags` 的 `capabilities` 数组映射 thinking/tools（listModels.ts 第 234–302 行）；LM Studio 原生 API 读 `type: 'embedding'`、`trained_for_tool_use`、`vision`、`max_context_length`（约 1010–1070 行）。**通用 OpenAI 兼容端点不做元数据补全，只拿 id/owned_by**。
- **拉取失败回退**：次端点（OpenRouter embedding/image、PPIO embedding/reranker）失败仅记 warn 并用空数组兜底继续（`recoverOptionalModelListFailure`）；LM Studio 原生端点失败自动回退 `/v1/models`；LM Studio 列表为空时文档提示「LM Studio 只暴露已 Load 的模型，先 Load 再获取」。Azure 文档明确：「点击获取模型列表，或手动添加你已在 Azure 上部署的模型名（即 Deployment Name，而非 OpenAI 原始模型 ID）」「填错会 404」。
  - 证据：listModels.ts 第 129–137、1034 行；https://docs.cherry-ai.com/pre-basic/providers/lm-studio ；https://docs.cherry-ai.com/pre-basic/providers/azure-openai
- **列表巨大时处理**：设置页有 `ModelListSearchBar.tsx`、`ModelTypeFilterTabs.tsx`（按模型类型分组筛选）；同步抽屉 `ModelListSyncDrawer.tsx` / `useModelListSyncSelections.ts` 提供勾选式同步预览。未证实有分页（列表一次性内存渲染）。
  - 证据：`src/renderer/src/pages/settings/ProviderSettings/ModelList/`（实际路径 `src/renderer/pages/settings/ProviderSettings/ModelList/`）。

### 1.2 LobeChat（开源 Web/桌面）

- **交互流程**：应用设置 → AI Providers → 选 provider → 填 key/代理 → 点「Check」测连接 → 模型列表区域有「获取远程模型列表」入口（空态页按钮 + 列表标题刷新按钮，手动触发）；支持标记 `fetchOnClient` 的 provider 由浏览器直接请求。文档流程：「Enter the API key → Select **Check** to test the connection → Enable the OpenAI models you need」。
  - 证据：https://lobehub.com/docs/usage/providers/openai ；lobehub/lobe-chat commit `19478f19`（2026-10-10），`src/features/Settings/provider/features/ModelList/EmptyModels.tsx`、`src/services/models.ts`。
- **拉取与去重**：`fetchRemoteModelList` 拉远程列表后保留本地 enabled 状态（按 id 映射），`deduplicateRemoteModels` 去重并对重复 id 弹 toast 警告；远程模型打 `source: 'remote'`，无类型时默认 `type: 'chat'`。
  - 证据：`src/store/aiInfra/slices/aiModel/action.ts` 第 70–130 行。
- **过滤**：通用路径不过滤；`postProcessModelList` 给无类型模型补 `type: 'chat'`，并按 `IMAGE_GENERATION_MODEL_WHITELIST` 为白名单聊天模型额外派生 `xxx:image` 图像模型条目。
  - 证据：`packages/model-runtime/src/utils/postProcessModelList.ts`。
- **元数据补全（与 model-bank 结合，强证据）**：Ollama provider 的 `models()` 会把本地列出的模型名与内置 `LOBE_DEFAULT_MODEL_LIST`（model-bank 包，约 80 个 provider 文件 / ~1900 条模型卡片）按 id 精确匹配（不区分大小写），命中则补 `contextWindowTokens / displayName / functionCall / reasoning / vision`。服务端 `aiInfra` 仓库层把 model-bank 卡片在读取时合并进用户模型（用户改动优先，contextWindow 用户手填值优先，type 以 builtin 卡片为准）。
  - 证据：`packages/model-runtime/src/providers/ollama/index.ts` 第 145–170 行；`packages/database/src/repositories/aiInfra/index.ts` 第 149–215、367–373 行；`.agents/skills/model-bank-metadata/SKILL.md`（说明 model-bank 维护规则与来源要求）。
- **Azure**：model-runtime 的 azureOpenai provider 支持模型卡上的 `config.deploymentName`，请求时用 deploymentName 替换逻辑 model id；文档/UI 中有 `showDeployName` 概念（自定义 provider 上下文）。
  - 证据：`packages/model-runtime/src/providers/azureOpenai/index.ts` 第 102–108 行；`src/features/Settings/provider/features/ModelList/EmptyModels.tsx` 第 58 行。
- **列表巨大时处理**：模型列表有搜索框（`ModelList/ModelTitle/Search.tsx`）、启用/停用分栏（`EnabledModelList` / `DisabledModels.tsx`）、排序弹窗（`SortModelModal`）。未证实分页。

### 1.3 Open WebUI（开源自托管 Web）

- **交互流程**：Admin 面板 → Settings → Connections 添加 OpenAI 兼容连接（URL + key，可多个）→ 后台周期性对所有连接并发拉 `GET {url}/models` 合并为全局模型列表；Anthropic 端点走 `get_anthropic_models` 特殊路径。也支持在 api_config 里填 `model_ids` 白名单：填了就**不拉取**，直接用白名单构造假列表（含 Azure 连接：azure 连接直接用 `model_ids` 作为模型列表，不请求 `/models`）。
  - 证据：open-webui/open-webui commit `8bd8b4fa`（2026-09-21），`backend/open_webui/routers/openai.py` 第 688–718、889–894 行。
- **去重**：`get_merged_models` 按 model id 字典合并，多连接重复 id 后到的覆盖先到的；每个模型记录 `urlIdx` 标记来源连接（openai.py 第 816–856 行）。
- **过滤非聊天模型**：关键词黑名单 `_UNSUPPORTED_OPENAI_MODEL_KEYWORDS = ('babbage', 'dall-e', 'davinci', 'embedding', 'tts', 'whisper')`，**只对 hostname == 'api.openai.com' 的连接生效**，第三方网关不过滤（openai.py 第 80、813–814、828–832、920–923 行）。
- **权限裁剪**：合并后的列表再按用户角色和 `Models` 表的访问控制（AccessGrants）过滤，普通用户只看到被授权的模型（openai.py 第 767–790 行附近）。
- **元数据**：`/models` 响应本身只透传上游字段；Open WebUI 依赖自己的 `models` 表（管理员可编辑模型元数据）补充；无内置公开元数据库自动匹配机制（未证实有 contextWindow 自动补全）。
- **本地无鉴权**：`send_get_request` 在无 key 时直接不加 `Authorization` 头（openai.py 第 102 行 `{... if key else {}}`）。
- **大列表处理**：前端模型选择器搜索式；后端有 `models.base_models_cache` + Redis 缓存，手动 refresh 清缓存（`utils/models.py` 第 69–110 行）。

### 1.4 LibreChat（开源自托管 Web）

- **交互流程**：YAML 配置（`librechat.yaml`）而非纯 UI。自定义端点配 `models.default`（必选兜底列表）+ `models.fetch: true` 即尝试从 `{baseURL}/models` 拉列表，**拉取失败回退到 `default` 列表**（文档原话：「If fetching models fails, these defaults are used as a fallback」）。默认 `fetch: false`。
  - 证据：https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint （核查 2026-10-10）
- **Anthropic 兼容端点**：`provider: anthropic` 时明确「OpenAI-style `models.fetch` is not used」，必须手写 `models.default`。
- **能力/元数据**：不自动补全；per-model 的上下文窗口/价格通过 `tokenConfig` 手工声明（如 `context: 128000`）。
- **本地无 key**：支持 `apiKey: 'user_provided'`（让用户在 UI 填）或留空由环境变量注入。
- **大列表处理**：未证实有专门处理；YAML 配置场景由管理员自管。

### 1.5 Cline（VSCode 扩展）

- **交互流程**：OpenRouter provider：选 provider → 填 key → 「Model」下拉直接列全部模型。官方文档原话：「Roo Code automatically fetches all available models from OpenRouter's API (100+ models)」（Cline 文档同源同构，见 docs.roocode.com 与 docs.cline.bot 两页逐字相同）。
  - 证据：https://docs.roocode.com/providers/openrouter ；https://docs.cline.bot/provider-config/openrouter （核查 2026-10-10）
- **实现**：`refreshOpenRouterModels` 现走 models.dev 支持的 SDK catalog（bundled + live refresh）；对 Ollama 用 `GET {baseUrl}/api/tags`、LM Studio 用 `api/v0/models`、OpenAI 兼容用 `GET {baseUrl}/models`，均 try/catch 失败返回空数组（UI 保留手输 model id 框）。
  - 证据：cline/cline commit `bf71bf7c`（2026-10-09），`apps/vscode/src/core/controller/models/refreshOpenRouterModels.ts`、`getOllamaModels.ts`、`getLmStudioModels.ts`、`refreshOpenAiModels.ts`。
- **去重**：`refreshOpenAiModels`/`getOllamaModels` 用 `new Set` 去重并排序；不过滤 embedding/tts（直接全量 id）。
- **元数据**：OpenRouter 的 `/models` 响应自带 `context_length`、`architecture`（含 modalities）、`pricing`，Cline 用其填充 contextWindow/supportsImages 等（`providerCatalogShared.ts` 第 244–266 行）。
- **「OpenAI Compatible」provider**：文档流程是手填 Base URL + API Key + **Model ID**，「Model Configuration」手填 Max Output Tokens / Context Window / Image Support / Computer Use / 价格——即 Cline 对通用兼容端点保留全手填兜底。
  - 证据：https://docs.roocode.com/providers/openai-compatible

### 1.6 Jan（开源桌面）

- **交互流程**：provider 只需 `base_url` 必填、`api_key` 可选（代码注释原话：「base_url is required, api_key is optional」）；自动用 `GET {base_url}/models` 拉取，key 缺失时直接无 Authorization 请求（适配本地 Ollama/LM Studio 无鉴权）。结果在 provider 设置 UI 展示并缓存（带 TTL 的 Map 缓存）。
  - 证据：janhq/jan commit `f2cd837f`（2026-10-09），`web-app/src/hooks/useProviderModels.ts` 第 22–75 行；`web-app/src/services/providers/tauri.ts` 第 147–200 行。
- **本地优化**：localhost/127.0.0.1 自动加 `Origin: tauri://localhost` 头绕 Tauri CORS（tauri.ts 第 166–171 行）。
- **多 key**：支持 key 轮换链 `providerRemoteApiKeyChain`，401/403/429 时尝试下一 key。
- **失败回退**：失败时报错信息按 401/403/404 分类提示（如「Models endpoint not found… Check the base URL configuration」），列表为空/格式异常时 warn 并返回空数组，用户仍可手输。
- **元数据**：`engine.getModelContextLimit(modelId)` 由各引擎扩展读取模型上下文上限（`services/models/default.ts` 第 50–54 行）；另有 Jan 自有模型 catalog（MODEL_CATALOG_URL）用于本地模型下载推荐。通用 OpenAI 兼容 provider 不做能力自动补全（未证实）。
- **过滤/大列表**：拉取后不区分类型过滤（未证实）；UI 侧排序 + 缓存。

### 1.7 Chatbox（开源桌面）

- **交互流程**：自定义 OpenAI 兼容 provider 设置里有获取远程模型列表能力（`listModels()` → `fetchRemoteModels` → `GET {apiHost}/models`）。
  - 证据：chatboxai/chatbox commit `0ac6385a`（2026-09-24），`src/shared/providers/definitions/models/custom-openai.ts` 第 93 行；`src/shared/models/openai-compatible.ts` 第 134 行。
- **元数据自动补全（本研究最强证据）**：双层机制——
  1. `/models` 响应自带字段即解析：OpenRouter 的 `name/context_length/architecture/pricing/supported_parameters` 被映射为 nickname、contextWindow、vision、web_search、reasoning 能力（openai-compatible.ts 第 160–200 行）。
  2. **内置 models.dev 注册表**：应用内置 `MODELS_DEV_SNAPSHOT`（models.dev 快照打包进产物），启动后 7 天 TTL 缓存 + 15s 超时从 `https://models.dev/api.json` 热更新。`enrichModelsFromRegistry` 把拉到的模型 id 在注册表里匹配，capabilities/contextWindow/maxOutput **覆盖**已有值（「registry is more authoritative and up-to-date」），昵称/type/labels 只在缺失时填充。拉取失败时用 `getProviderModelsFromRegistry` 从注册表整体兜底出该 provider 的模型列表；「Fetch」时还提供 `getDiscoveredModels` 把注册表近 6 个月新模型标记为 New。
  - 证据：`src/renderer/packages/model-registry/enrich.ts`、`fetch.ts`。
- **特殊 provider 头**：openrouter.ai 自动加 HTTP-Referer/X-Title；aihubmix 加 APP-Code。
- **过滤**：未证实在拉取列表时过滤 embedding/tts（enrich 只补类型，不删条目）。

### 1.8 Msty（闭源桌面，仅文档证据）

- **交互流程**：Model Hub → Model Providers → Add Provider → 选 provider → 填 key/endpoint → 保存 → 聊天里选模型测试。Azure OpenAI 向导：填 Key + Base URL（或 Resource name）+ 可选 API Version → **「Select the Model(s) that you have deployed in Azure OpenAI - note that all models will be listed but you can only utilize the ones you've deployed」**——即 Msty 对 Azure 列出全量官方模型目录供勾选，不依赖 Azure `/models`（用户自己负责选已部署的）。
  - 证据：https://docs.msty.ai/studio/managing-models/online-providers ；https://docs.msty.ai/studio/how-tos/azure-openai （核查 2026-10-10）
- **BYO Provider**：任意 OpenAI 兼容端点可接入（自建网关/企业平台）。
- **备注**：Msty Studio（v2）为闭源 SaaS/桌面，是否从端点自动拉列表未证实。

---

## 2. 已知坑与对策

### 2.1 本地服务无鉴权

- **Ollama 有两套模型 API**：`/api/tags`（原生，含 size/digest/`capabilities` 数组如 thinking/tools，无 context length）和 OpenAI 兼容 `/v1/models`。Cherry Studio 的 Ollama fetcher 用 `/api/tags` + 逐模型 `POST /api/show` 读 `model_info` 里的 `context_length` 补全 contextWindow（注释明确：`/api/tags` 无上下文长度，否则回退到按显存猜 4k 窗口导致 agent 工具前言就超窗截断，issue #18643）。Cline 也用 `/api/tags`。
  - 证据：Cherry listModels.ts 第 242–302 行；cline `getOllamaModels.ts`。
- **key 可留空**：Cherry 文档：「Ollama 默认不需要 API 密钥。您可以将此字段留空，或者填写任意内容」「LM Studio…API 密钥可留空」。Jan 代码层即 api_key optional；Open WebUI 无 key 不发 Authorization 头。
  - 证据：https://docs.cherry-ai.com/pre-basic/providers/ollama ；/lm-studio ；jan `useProviderModels.ts` 注释；open-webui `openai.py` 第 102 行。
- **LM Studio 只暴露已 Load 模型**：Cherry 文档 FAQ 明示「列表为空？LM Studio 只暴露已 Load 到内存的模型」。对策：Cherry 优先原生 `/api/v1/models`（能列已下载未加载），失败回退 `/v1/models`；Cline 用 `api/v0/models`。
  - 证据：https://docs.cherry-ai.com/pre-basic/providers/lm-studio ；Cherry listModels.ts 第 1016–1036 行注释；cline `getLmStudioModels.ts`。

### 2.2 Azure OpenAI 无通用 /models

- **模型 id 即 Deployment Name**，且不同租户不同名（如 `gpt-4o-prod`）。对策汇总：
  - Cherry Studio：文档显式区分 Deployment Name vs Model ID，「填错会 404」，允许点获取模型列表或手动添加；provider 有专属 API Version 字段。
    - 证据：https://docs.cherry-ai.com/pre-basic/providers/azure-openai
  - Open WebUI：连接配 `azure: true` 时**完全不请求 /models**，直接把管理员填的 `model_ids` 白名单当列表。
    - 证据：openai.py 第 889–894 行。
  - LobeChat：模型卡片带 `config.deploymentName`，请求时替换为部署名。
    - 证据：lobe-chat `packages/model-runtime/src/providers/azureOpenai/index.ts` 第 102–108 行。
  - Msty：列全量官方目录让用户勾选已部署者（「all models will be listed but you can only utilize the ones you've deployed」）。
    - 证据：https://docs.msty.ai/studio/how-tos/azure-openai
  - （另注：Azure 新版 API 2024-08+ 已支持 `GET /openai/models?api-version=…`，但旧 api-version 无此端点；产品普遍不做依赖，仍走 deployment 手工/白名单路径。此句为 OpenAI 官方 API 变更事实，未在本次产品中逐一验证各家是否已支持新版列表——标「部分未证实」。）

### 2.3 代理/聚合服务列表巨大与非聊天模型过滤

- **过滤规则是「名称关键词黑名单」**，不是类型推断（`/v1/models` 响应本身无类型字段）：
  - Cherry Studio：`['tts','whisper','transcribe','speech','audio','realtime','sora']`（仅官方 OpenAI provider；自定义兼容端点不过滤，embedding 保留作为能力类型）。
    - 证据：listModels.ts 第 831–836 行。
  - Open WebUI：`('babbage','dall-e','davinci','embedding','tts','whisper')`（仅 `api.openai.com` hostname；第三方网关不过滤）。
    - 证据：openai.py 第 80、828 行。
  - LobeChat：不过滤，默认 `type: 'chat'`，靠 model-bank 卡片纠正类型（数据库合并时 type 以 builtin 卡片为准）。
    - 证据：`repositories/aiInfra/index.ts` 第 367–373 行。
- **利用网关扩展字段更可靠**：new-api 在 `/v1/models` 响应里带 `supported_endpoint_types`（如 openai/anthropic/embeddings/image-generation），Cherry 的 newApiFetcher 直接读它映射端点与能力，避免名称猜测。
  - 证据：Cherry listModels.ts 第 557–604 行；new-api `model/pricing.go` 第 45 行（QuantumNous/new-api，核查 2026-10-10）。
- **OpenRouter 多端点分流**：Cherry 并行拉 `/models`、`/embeddings/models`、`/images/models` 合并打标；OpenRouter 官方 `/models` 响应自带 `architecture/pricing/context_length`，Chatbox/Cline 直接消费。
  - 证据：Cherry listModels.ts 第 662–710 行；Chatbox openai-compatible.ts 第 102–132 行。
- **大列表 UX**：各家做法收敛为「搜索框 + 分组/标签过滤 + 启用/停用分栏」（Cherry 的 ModelListSearchBar/ModelTypeFilterTabs/Sync 抽屉；LobeChat 的 Enabled/Disabled 分栏 + 搜索 + 排序；Open WebUI 全局合并 + 管理端授权）。**未证实任何一家做分页**，都是一次性列表 + 客户端搜索。

### 2.4 拉取失败/列表为空的回退

- LibreChat：`models.fetch` 失败回退 `models.default` 手填列表（官方文档明示）。
- Cherry Studio：「点击获取模型列表，或手动添加你已在 Azure 上部署的模型名」；OneAPI 文档「点击管理自动获取或手动输入」；LM Studio 原生 API 失败自动回退 `/v1/models`。
- Cline：各 get/refresh 函数失败返回空数组，UI 保留手输 Model ID（文档明确把 Model ID 列为手动配置项）。
- Jan：失败按 401/403/404 分类报错，列表为空时返回 `[]`，用户手输。
- LobeChat：EmptyModels 空态页同时给「获取远程模型列表」与「Create New Model（手动新建）」两个入口。
  - 证据：见 §1 各节 URL。

### 2.5 列表与 key 权限不一致（聚合网关子集）

- **new-api 实锤**：`/v1/models` 走 TokenAuth，服务端按「用户所在分组的可用模型集合」∩「令牌 ModelLimits 白名单」过滤后返回（`service.GetGroupsEnabledModels(ownerGroups)` + `tokenModelLimit` 双重裁剪）。
  - 证据：QuantumNous/new-api `controller/model.go` 第 218–270 行；`router/relay-router.go` 第 21–33 行（核查 2026-10-10）。
- **含义**：拉到的列表就是该 key 实际可用集合——这是**优点**（避免用户选了不能用的模型），不是 bug；但设计时要认知到「拉取结果 ≠ 网关全部模型」，不要把拉不到的模型从元数据匹配中排除（用户可能换 key 后手输）。
- Open WebUI 侧也在自己服务内二次做用户级访问控制（AccessGrants），即「上游子集 × 本地授权子集」。

---

## 3. 元数据自动补全的产品证据汇总

| 产品 | 自动补全来源 | 补全内容 | 证据 |
|---|---|---|---|
| Cherry Studio | 各 provider 专属拉取端点（Ollama `/api/show`、LM Studio `/api/v1/models`、new-api `supported_endpoint_types`、OpenRouter 多端点）；**通用兼容端点不补全** | contextWindow、能力标记（reasoning/function_call/vision/embedding）、端点类型 | listModels.ts（commit 1cceda97） |
| LobeChat | 内置 model-bank 包（~80 provider/~1900 模型卡片，有专门 skill 维护 cutoff/family 元数据）；Ollama 列出后按 id 匹配命中即补；服务端读取时合并用户覆盖 | contextWindowTokens、displayName、functionCall、reasoning、vision、type、pricing | `packages/model-runtime/src/providers/ollama/index.ts`、`repositories/aiInfra/index.ts`、`.agents/skills/model-bank-metadata/SKILL.md` |
| Chatbox | 内置 models.dev 快照 + 热更新注册表，按 id 匹配覆盖；拉取失败整体用注册表兜底；近 6 个月新模型打「New」 | capabilities、contextWindow、maxOutput、nickname、type | `src/renderer/packages/model-registry/enrich.ts`、`fetch.ts` |
| Cline | models.dev 驱动的 SDK catalog（bundled + live refresh）+ OpenRouter `/models` 自带字段 | contextWindow、supportsImages、价格等 | `refreshOpenRouterModels.ts`、`providerCatalogShared.ts` |
| Open WebUI | 无公共元数据库自动匹配；管理员在本地 `models` 表手工补充 | —（未证实自动补全） | `routers/models.py`、`utils/models.py` |
| LibreChat | 无；YAML `tokenConfig` 手工声明每模型 context/价格 | — | librechat.yaml 文档 |
| Jan | 引擎扩展 `getModelContextLimit`（本地引擎可用）；自有 catalog 服务下载推荐 | context limit（仅引擎侧） | `services/models/default.ts` |
| Msty | 未证实（闭源） | — | — |

合并优先级共识（LobeChat/Chatbox 一致）：**事实性数据（contextWindow、能力、价格）以注册表/远端为准覆盖；用户自定义展示（昵称、排序、启用状态）保留**。

---

## 4. 结论：可行性与风险点排序

### 4.1 流程分档

- **全流程可自动（连接 → 列表 → 元数据）**：标准 OpenAI 兼容端点且响应规范时——OpenRouter（自带丰富元数据）、new-api 系网关（`supported_endpoint_types`）、LM Studio（原生 API）、Ollama（`/api/tags`+`/api/show`）。Cherry Studio、LobeChat、Chatbox 在这几类上已能做到「拉完即用」。
- **半自动（列表自动 + 元数据靠本地库匹配，未命中需手填）**：任意 OpenAI 兼容网关（one-api 无扩展字段的旧版、自建 liteLLM 等）——列表能拉，但 `/v1/models` 无类型/无 contextWindow，需要内置元数据库（model-bank / models.dev 快照）按 id 匹配兜底，长尾模型仍要用户手填。
- **必须手填**：Azure OpenAI（模型 id 是租户自定义 deployment 名，无法被任何公共元数据库匹配；各家均退化到白名单/手输/全量勾选）；Anthropic 协议兼容端点（LibreChat 明示不走 fetch；Cherry 对 Anthropic 官方有专属 fetcher `limit=1000` 例外）；本地服务没 Load/没下载任何模型时（列表为空）。

### 4.2 风险点排序（高→低）

1. **Azure/私有部署的 id 不可枚举**：deployment 名任意（`gpt-4o-prod`），列表端点在旧 API 版本缺失 → 必须保留「手输 model id」一等公民通道，且元数据匹配逻辑要对「含知名子串的自定义 id」谨慎（不可盲信子串匹配）。
2. **聚合网关大列表 + 无类型信息**：one-api 类返回数百条 id（含 embedding/tts/dall-e）。过滤只能靠名称关键词黑名单（两家开源实现一致，仅对官方 OpenAI 生效）→ 推荐像 Cherry/new-api 那样优先消费网关的类型扩展字段，黑名单只作兜底；UI 必须配搜索 + 类型分组。
3. **拉取列表 ≠ 可调用**：网关按令牌分组裁剪返回子集（new-api 源码实锤）→ 刷新策略要意识到换 key/换分组后列表会变；保留「手输不在列表里的 id」能力。
4. **本地服务状态敏感**：LM Studio 只列已 Load 模型；Ollama 原生/兼容端点信息不对齐（`/api/tags` 有 capabilities 无 context，`/v1/models` 反之且不同实现参差）→ 对 Ollama 需要双端点组合补全，或接受 contextWindow 缺失时标「待确认」。
5. **失败回退是必备而非可选**：所有成熟产品都保留手输兜底（LibreChat default 列表、Cherry/Azure 手输、Cline 空数组 + 手输框）。拉取失败（TLS/代理/超时/401 分组）应给分类错误提示（Jan 的 401/403/404 分类做法可参考）。
6. **元数据库的新鲜度**：LobeChat 为此专门有维护 skill（只采信官方来源、拒绝第三方聚合站抄错值）；Chatbox 用 models.dev 快照 + 7 天 TTL 热更新。自建元数据库意味着长期维护承诺——可以直接消费 models.dev 公共 API 降低维护成本（Chatbox/Cline 均已如此）。

### 4.3 对目标流程的落地建议（基于证据）

1. 连接检测通过后自动触发 `/v1/models` 拉取（各家现状是手动「获取」按钮，自动触发是合理的 UX 改进，未见冲突证据）。
2. 勾选式启用 + 搜索 + 类型分组（Cherry/LobeChat 的收敛形态）。
3. 元数据双层：远端响应自带字段（OpenRouter/new-api/Ollama/LM Studio 类）优先 → 本地元数据库（models.dev 快照/自建 model-bank）按 id 匹配 → 未命中标「待确认」并只追问缺失字段（contextWindow 必填、能力可选）。
4. 保留并显式呈现「手输 model id」入口（Azure、分组 key 子集、拉取失败三类场景都靠它兜底）。
5. 已知 provider（Ollama/LM Studio/OpenRouter/new-api/Azure）做专属协议适配，通用 OpenAI 兼容端点按最低假设处理（不过滤、不强求元数据）。

---

## 附：证据文件与版本锚点

| 仓库/站点 | 版本锚点 | 核查方式 |
|---|---|---|
| CherryHQ/cherry-studio | main@`1cceda97`（2026-10-10） | git 浅克隆源码 + docs.cherry-ai.com |
| lobehub/lobe-chat | main@`19478f19`（2026-10-10） | git 浅克隆源码 + lobehub.com/docs |
| open-webui/open-webui | main@`8bd8b4fa`（2026-09-21） | git 浅克隆源码 |
| cline/cline | main@`bf71bf7c`（2026-10-09） | git 浅克隆源码 + docs.cline.bot / docs.roocode.com |
| janhq/jan | main@`f2cd837f`（2026-10-09） | git 浅克隆源码 |
| chatboxai/chatbox | main@`0ac6385a`（2026-09-24） | git 浅克隆源码 |
| QuantumNous/new-api | main（2026-10-10） | git 浅克隆源码 |
| LibreChat | librechat.ai 在线文档 | 官方文档 |
| Msty Studio | docs.msty.ai 在线文档 | 官方文档（闭源） |
