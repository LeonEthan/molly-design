# 模型配置 UX/UI 优化方案（Settings → AI models）

- 版本：v1（2026-10-10），状态：建议稿，未经人工批准。
- 支撑研究（同目录，均已通过独立复核）：
  - [oauth-and-competitors.md](oauth-and-competitors.md) — OpenAI OAuth 机制与 11 家竞品
  - [model-auto-discovery.md](model-auto-discovery.md) — 15 类服务 `/models` 行为与元数据源
  - [repo-touchpoints.md](repo-touchpoints.md) — 本仓库现状链路与最小改动面
  - [multi-provider-oauth.md](multi-provider-oauth.md) — 期 4 草案：复用 pi-ai 官方 OAuth 扩展到其他订阅 provider

## 问题与用途

用户目标：(1) 增加 OpenAI 官方账号登录（OAuth），不只是粘贴 API key；(2) OpenAI-compatible
连接从手工逐字段填模型改为自动获取；(3) 整体模型配置体验重做。本文是重做的完整方案，
供设计/实施决策；不含实现。

## 现状体验问题（代码核实）

| # | 问题 | 证据 |
|---|---|---|
| P1 | 唯一登录方式是粘 API key；设计师用户不知道 key 从哪来 | `model-connection-setting.tsx:350` 只有 password 输入框 |
| P2 | OpenAI-compatible 要逐模型手填 9 个字段（modelId/name/contextWindow/maxTokens/maxTokensField/图像/toolCalls/streaming usage/thinking 级别） | `compatible-model-fields.tsx:38-189`、`embedded-harness.ts:424` |
| P3 | 检查已经拿到 `/models` 列表却只用在一个角落的灰色标签上（not-listed），不自选、不预填 | `model-connection-setting.tsx:255-258`、`model-checklist.tsx:142` |
| P4 | 解析器只认 `{data:[{id}]}` 一种包装；OpenRouter（无 `object:"list"`）、Together（裸数组）、new-api（混入 `success:true`）会被误判 `invalid_response` | `connection-check.ts:63-77` |
| P5 | 「Models」没有自己的设置分类，挤在 `agents` tab 里，和图像连接、legacy 引擎清单混排 | `settings-tabs.tsx:86`、`machine-agent-settings.tsx:171-177` |
| P6 | 模型子集选择藏在「More options」折叠区，默认全量 catalog 进 picker（OpenAI 打包 57 个模型） | `model-connection-setting.tsx:423-497` |
| P7 | Provider 选择是 11 宫格等权按钮，无推荐、无分组 | `model-connection-setting.tsx:146-183` |
| P8 | 空态引导弱（一行字 + 小按钮）；错误只用通用 `settings.models.error` | `model-connection-setting.tsx:718-744` |
| P9 | spec 级措辞假设「API key」（`specs/molly-embedded-pi-harness.md` L16），引 OAuth 属 intent 变更，spec 需回 draft 评审 | repo-touchpoints §5.2 |

## 关键调研结论（决定方案的事实）

1. **OpenAI OAuth 可行且有成熟配方**：Codex CLI 公开 client_id + PKCE + localhost:1455/1457
   回调（端口被占回退 1457），OpenCode/Roo/Cline/Zed 四家长期公开复用同一流程；token
   三件套（id/access/refresh）可存现有 safeStorage vault。**但 OpenAI 无书面授权第三方，
   Anthropic 有明确禁止先例（OpenCode 1.3.0 被迫移除）——必须做成可整体关闭的可选通道，
   且落地前人工精读 OpenAI ToS 原文。**
2. **OAuth 与 API key 是两个后端**：OAuth 走 `chatgpt.com/backend-api/codex/responses`
   （订阅额度、模型子集、400K 上下文），key 走 `api.openai.com/v1`（按 token 计费、全量
   模型）。UI 必须把两者呈现为同一 OpenAI 提供者的两种「连接方式」，并诚实标注差异。
3. **自动发现分层可行**：`/models` 在 13/15 类服务可列 id；但只有 modelId 是定论「可
   自动」，contextWindow/能力字段需「服务端自带字段 → models.dev（MIT，可打包快照）→
   OpenRouter 在线补充 → 启发式 → 用户声明」逐级兜底。Azure（deployment 名）与 z.ai
   （无文档化 /models）必须保留手输一等通道。
4. **`usageInStreaming` 不需要是用户字段**：业内（OpenCode 实证）无条件发
   `include_usage:true`，不支持的网关静默忽略——从必填移除，默认开启。
5. **改造面小**：OAuth 若「main 侧授予前刷新、access token 仍按单字符串下发」，则
   worker/harness-pi/grant schema/preload 全部零改动（独立复核已逐环核实）。自动发现若
   结果仍写入 `customModels`，shared schema/store/worker 零改动，只动表单 + 一个放宽的
   解析器。

## 优化方案

### 设计原则

1. **先连上，再挑选，缺什么问什么**——渐进式披露；任何自动步骤失败都降级到手工通道，
   绝不阻塞保存。
2. **账号优先，key 兜底**——对每个 provider 同时给「登录」（有 OAuth 时）与「API key」
   两个入口；key 入口永远存在（CI/自动化场景）。
3. **列表来自服务，事实来自元数据库，声明来自用户**——三者职责分离，UI 上看得出每个
   模型信息的来源与置信度。
4. **诚实能力**——检查是免费的 `/models` 列表，不代表计费与可用性；OAuth 通道标注
   「非官方集成，可能随 OpenAI 政策变化」。
5. 沿用现有设计系统（CompactSection/Row/Form 三段式、connection-check 组件、
   molly-model picker 投影），不做视觉革命。

### IA 调整（小步）

- 把 `agents` tab 内的三段明确分节：**① 模型连接（Models）② 图像生成（Image）③
  引擎与历史（Engine & legacy）**。不把 Models 提成顶级 tab（避免动路由；收益不成比例）。
- `DesignReadiness` 就绪条保留，成为空态的「下一步」引导主体。

### 核心流程 1：连接一个 provider（重做后）

```
选 provider（分组网格：推荐 6 个 / 更多 5 个，保留现有图标语言）
  └─ OpenAI → 方式选择卡（仅此 provider 有）：
       A.「使用 ChatGPT 账号登录（推荐）」——OAuth
       B.「使用 API key」——现有流程
  └─ 其他 native preset → 直接进 key 表单（现状，已可用）
  └─ OpenAI-compatible → 端点 +（可选）key → 自动发现（流程 2）
```

**OAuth 子流程（已实现）**：main 起 127.0.0.1:1455（占用回退 1457）一次性回调服务 →
`shell.openExternal` 打开 `auth.openai.com/oauth/authorize?...&originator=molly` → PKCE 换
token → token set 原子写入 vault（`saveOAuthConnection`）→ 用 id_token claims 显示账号。
授予前 main 侧刷新 access token（`usableOAuthAccessToken`），仍以单字符串 + 可选
`oauthAccountId` 下发；worker 对 OAuth 连接注册 codex 后端（`openai-codex-responses`）并
把 `ChatGPT-Account-Id` 原地写入已注册的 provider headers（不重注册，避免触发 model-change
守卫）。登出 = best-effort revoke + 删除连接。refresh 轮换语义，denied 即要求重新登录。

**风险护栏（必须随功能落地）：**

- 功能做成独立 preset 分支（`openai` 的 authType=oauth），单点开关可整体禁用；
  被 OpenAI 封 originator 时降级提示「请改用 API key」，不丢连接配置。
- UI 文案诚实：「此登录方式复用 Codex CLI 的公开集成，非 OpenAI 对 Molly 的正式授权。」
- 落地前人工动作：精读 OpenAI ToS / Codex 条款（调研被 Cloudflare 拦截，未能核）。
- PKCE + state 校验 + 回调端口只绑 127.0.0.1、一次性、120s 超时关闭。

### 核心流程 2：OpenAI-compatible 自动发现

```
端点 +（可选）key 输入 → 现有防抖检查自动发 GET /models
  ✓ 成功 → 「发现 N 个模型」卡：
      · 搜索框 + 类型过滤（按 id 关键词滤掉 embedding/tts/whisper/dall-e 等，
        消费 new-api 的 supported_endpoint_types 扩展字段）
      · 每行：模型 id + 元数据置信徽标（服务端自带 / models.dev / 未识别）
      · 勾选 → 元数据自动补全（contextWindow/maxTokens/图像/toolCalls/thinking）
      · 未识别的模型：行内展开只问缺失字段（带启发式默认值）
  ✗ 失败（401/403/404/超时分类提示）→ 「手动添加模型」通道始终可见
```

**字段处理规则**（对应 `CompatibleModelDefinitionSchema`）：

| 字段 | 新来源 | 变化 |
|---|---|---|
| modelId | /models 列表（Azure 手输） | 自动 |
| name | 服务端 display_name → models.dev → modelId | 自动 |
| contextWindow / maxTokens | 服务端字段（五种字段名兼容）→ models.dev `limit.*` → OpenRouter 在线 → 手填 | 自动+兜底 |
| input（图像） | models.dev `modalities` → OpenRouter `architecture` → 启发式（-vision/-vl）→ 用户确认 | 半自动 |
| toolCalls | models.dev `tool_call` → LiteLLM `supports_function_calling` → 用户确认 | 半自动 |
| thinking 级别 | models.dev `reasoning_options`（仅知名模型）→ 默认 `['off']` + 用户可加 | 半自动 |
| maxTokensField | 启发式（o\d/gpt-5+ → max_completion_tokens），用户可覆盖 | 半自动 |
| usageInStreaming | **删除该字段**，运行时无条件发 include_usage | 移除 |

**解析器放宽（第一个落地项）**：`listedModels` 兼容三种包装
（`{object, data}` / `{data}` / 裸数组）+ 忽略 `success` 等杂键 + 五种 context 字段名；
Google 形态保持特例。

**元数据快照**：构建期把 models.dev 按 Molly 11 个 preset + 常见兼容服务裁剪打包
（MIT 许可，无再分发风险）；运行期在线补充 OpenRouter（缓存、7 天 TTL，参照 Chatbox）。
未命中一律落到用户声明，不用探测请求（业内无人做能力探测，成本与语义都不可行）。

### 模型子集选择（picker 治理）

- 把「models in conversation picker」从 More options 折叠区提升为表单一等区块；
  默认策略从「全量 57 个」改为「推荐子集（catalog 标 recommended/最新一代）+ 用户可加」。
- checklist 增加分组（按代际/能力）与「此账号可见」排序优先（listed 集合已有）。
- 连接行摘要从「All models」改为「57 可用 · picker 显示 8」。

### 空态 / 错误 / 就绪

- 空态：大号「连接你的第一个模型」卡，推荐入口 = OpenAI OAuth + DeepSeek/OpenRouter key
  三个快捷按钮（而不是 6 个等权小按钮）。
- 保存后 toast 给「去会话里选它」的跳转，闭环到 picker。
- 错误分场景文案（沿用 `settings.check.failures.*` 分类，补 OAuth 新态：
  waiting/expired/revoked/plan_changed）。
- onboarding 的 providers 步自动继承新表单（组件复用）；注意图像连接**不在**
  onboarding（复核意见 4），首跑引导若纳入图像属新增改动。

### 分期

| 期 | 内容 | 状态 |
|---|---|---|
| 1 | 解析器放宽 + usageInStreaming 移除 + 自动发现勾选流程（结果写 customModels） | ✅ 已交付（`113ca444`） |
| 2 | picker 治理 + 空态/错误/onboarding 收尾 | ✅ 已交付（`3f54a361`） |
| 3 | OpenAI OAuth（spec 回 draft 评审、ToS 人工精读） | ✅ 已交付（本提交）——ToS 人工精读仍是发布前人工闸门 |
| 4 | 多 provider OAuth（Anthropic/Kimi/xAI 等复用 pi-ai 官方流程） | 📋 草案，见 [multi-provider-oauth.md](multi-provider-oauth.md)；各 provider 合规闸门独立 |

期 1 独立价值最大（直接解决「手填 9 字段」），期 3 风险最高（政策敞口），隔开交付。

## 关键未知（影响落地而非方向）

1. OpenAI ToS 原文未读（反爬拦截）——期 3 开工前的人工闸门。
2. `chatgpt.com/backend-api/codex/models` 是非官方协议，字段可能变；静态清单兜底必须有。
3. models.dev 对小厂（DeepSeek/Moonshot 各仅 4 模型）可能滞后——手输通道吸收。
4. OAuth 通路是否暴露图像模型：无证据，ImageConnection 保持 key 通路不动。
5. z.ai 是否实现 /models：需一把真 key curl 一次定论。

## 复核结果

两轮独立复核（均未参与调研，2026-10-10）：

1. **整体复核：通过。** 10 余项关键主张抽查全部成立（Codex 常量逐字命中、Anthropic 禁令
   原文、models.dev MIT、listedModels 解析形态、9 字段 schema、改动面行号）；「不需要动」
   三处证伪（preload 组级放行、grant 单字符串链、molly-compatible registerProvider）
   全部通过。5 条非阻断意见已并入上文（spec 引用偏差、打包 catalog 耦合、token 独立
   字段、onboarding 无图像连接、ToS 人工精读）。
2. **自动发现专项复核（含 curl 复测）：通过。** 修正了 4 处呈现瑕疵并已并入
   [model-auto-discovery.md](model-auto-discovery.md)：OpenRouter `/models` 实为免鉴权
   （复核复测确认）、「13/15」改为 12 家确认 + 3 家保留条件、难字段表补 maxTokens、
   补 Molly schema 边界说明（input 仅 text/image → 非聊天模型只过滤，过滤因此是正确性
   要求；name 必填在自动流程中只能由 modelId 派生）。另提示落地第一张表：11 个
   ProviderPreset 与研究 15 家清单的交集/差集映射（如 minimax 在 preset 内未被研究覆盖）。
