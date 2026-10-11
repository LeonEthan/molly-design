# OpenAI 官方账号登录（OAuth）机制与竞品「登录代替填 key」调研

- 调研日期：2026-10-10（所有来源均于当日核查）
- 调研目的：Molly 设置页目前只支持粘贴 API key（`ModelConnection` + safeStorage 加密存储 `credentialRef`，主进程 `connection-check.ts` 用 fetch 直接发请求），拟增加「OpenAI 官方账号登录（OAuth）」。本文只交付事实与机制分析，不涉及 Molly 的 UI 设计。
- 标注约定：**[观察]** = 在一手来源（源码/官方文档）中直接核实；**[推导]** = 由一手材料推理；**[传闻]** = 未能核实的说法。

---

## 问题与用途

回答三个子问题：

1. Codex CLI 式「Sign in with ChatGPT」OAuth 在第三方桌面应用中的技术机制，以及 OpenAI 是否允许/默许第三方这样做。
2. 同类产品（Codex CLI、Claude Code、OpenCode、Aider、Cline/Roo Code、Continue、Cherry Studio、LobeChat、Raycast、Zed）各自的模型连接方式、模型列表来源、登录态失效处理。
3. OpenAI API key 与 OAuth（ChatGPT 订阅）两种方式的能力差异：可用模型、计费、Responses API、rate limit、服务条款风险。

---

## 当前结论

1. **机制公开、可复现、无保密成分**。Codex CLI 的 OAuth 实现完全在开源仓库 `openai/codex`（Apache-2.0）中：issuer `https://auth.openai.com`，公开 client_id `app_EMoamEEZ73f0CkXaXp7hrann`（无 client secret，PKCE），回调白名单只有 `http://localhost:1455/auth/callback` 和 `http://localhost:1457/auth/callback`。**[观察]**
2. **第三方复用该流程已是普遍事实**：OpenCode（v2 起内建）、Roo Code、Cline、Zed 均在自己的开源代码里直接使用同一个 client_id 走同一流程，OpenCode 官方文档甚至把「ChatGPT Plus 订阅零配置可用」作为卖点。**[观察]** 但 **OpenAI 没有面向第三方发布过公开的 OAuth 开发者计划或正式授权文档**；可找到的唯一 OpenAI 官方文字是 Codex FAQ 中被 Roo Code 源码引用的 "Using Codex with your ChatGPT plan" 帮助文章（未能直接抓取，help.openai.com 被 Cloudflare 拦截）。因此定性为：**OpenAI 明知且容忍（多个头部开源产品长期公开这样做，未见公开封禁），但没有书面授权，政策风险不可排除**。**[推导]**
3. **对照案例（Anthropic）说明风险是真实的**：Anthropic 明确禁止第三方用 Claude Pro/Max 订阅 OAuth 驱动非官方工具，OpenCode 因此在 1.3.0 移除了内建 Claude 订阅插件（OpenCode 文档原文 "Anthropic explicitly prohibits this"）。**[观察]** 这是「供应商随时可能收紧」的直接先例。
4. **OAuth 通路（ChatGPT 订阅）与 API key 通路是两个不同的后端**：OAuth 走 `https://chatgpt.com/backend-api/codex/responses`，API key 走 `https://api.openai.com/v1`。模型集合、计费、限额、上下文窗口都不同，二者不能互换 token（OAuth 的 access token 不能当 API key 用，反之亦然）。**[观察]**
5. **对 Molly 的意义**：Electron 主进程实现该流程没有架构障碍——需要的只是：起一个 127.0.0.1:1455（回退 1457）的临时 HTTP 回调服务、`shell.openExternal` 打开授权 URL、两次 POST 到 `auth.openai.com/oauth/token`（code 交换 / refresh）、一次可选的 token-exchange 换 API key。token 集合（id_token/access_token/refresh_token）可沿用现有 `credentialRef` + safeStorage 的存储模型。**[推导]** 主要成本在请求层（自定义头、请求体重写、模型目录来源不同）和政策风险敞口。

---

## 机制细节（子问题 1）

### 授权流程（Codex CLI 官方实现）

来源：`openai/codex` 仓库 `codex-rs/login/src/`（server.rs, oauth/authorization.rs, auth/manager.rs, auth/storage.rs, device_code_auth.rs），核查于 2026-10-10。

| 要素 | 值 | 出处 |
|---|---|---|
| Issuer | `https://auth.openai.com` | server.rs `DEFAULT_ISSUER` |
| 授权端点 | `{issuer}/oauth/authorize` | server.rs `build_authorize_url` |
| Token 端点 | `{issuer}/oauth/token` | auth/manager.rs `REFRESH_TOKEN_URL` |
| 撤销端点 | `{issuer}/oauth/revoke` | auth/manager.rs `REVOKE_TOKEN_URL` |
| client_id | `app_EMoamEEZ73f0CkXaXp7hrann`（公开，无 secret） | auth/manager.rs `CLIENT_ID` |
| PKCE | S256（32 随机字节 verifier → SHA-256 → base64url） | oauth/pkce.rs |
| state | 32 随机字节 base64url，回调校验防 CSRF | oauth/authorization.rs |
| scope | `openid profile email offline_access api.connectors.read api.connectors.invoke`（Codex CLI 版） | server.rs:608 |
| redirect_uri 白名单 | `http://localhost:1455/auth/callback`（回退 1457）；用别的 host/端口/路径会被 auth.openai.com 以 `unknown_error` 拒绝 | server.rs 注释 + Zed 源码注释（实测验证） |
| 额外授权参数 | `id_token_add_organizations=true`、`codex_cli_simplified_flow=true`、`originator=<客户端标识>`、可选 `allowed_workspace_id` | server.rs `build_authorize_url` |

流程：本地起一次性 HTTP 服务监听 1455（被占则 1457）→ 打开浏览器到授权 URL → 用户在 ChatGPT 页面登录并授权 → 浏览器重定向到 `http://localhost:1455/auth/callback?code=…&state=…` → 应用校验 state、用 PKCE verifier 向 `/oauth/token` 换 token。**[观察]**

返回的 token 三件套（存储在 `~/.codex/auth.json`，文件权限 0600，也可存系统 keyring）：

- `id_token`：JWT，claims 含 email、`https://api.openai.com/auth` 下的 `chatgpt_plan_type`（free/plus/pro/business/enterprise/edu）、`chatgpt_user_id`、`chatgpt_account_id`、`chatgpt_account_is_fedramp`。**[观察]**（login/src/token_data.rs）
- `access_token`：JWT，用作调用 Codex 后端的 Bearer token；有效期可由 JWT exp 解析（Codex 在过期前 5 分钟主动刷新）。**[观察]**
- `refresh_token`：换取新 token；refresh 会轮换（旧 refresh token 失效，复用即报 "refresh token was already used"，要求重新登录）。**[观察]**（manager.rs 错误文案）

### 授权码粘贴 / 设备码（无浏览器环境）

- Codex CLI 提供 device code 流程：`POST {issuer}/api/accounts/deviceauth/usercode`（body 含 client_id）→ 用户到 `auth.openai.com/codex/device` 输入 user_code → 轮询 `{issuer}/api/accounts/deviceauth/token` → 拿到 authorization_code + 服务端生成的 code_verifier → 以 `redirect_uri={issuer}/deviceauth/callback` 做标准 code 交换。**[观察]**（device_code_auth.rs）
- OpenCode 也实现了同样的 device flow。**[观察]**
- Claude Code 的 fallback 是「浏览器显示 code，用户粘贴回终端」（本地回调不可达时，如 WSL2/SSH/容器）。**[观察]**（code.claude.com/docs/en/authentication）

### token 如何用于 API 调用

- **OAuth（ChatGPT 订阅）模式**：请求打到 `https://chatgpt.com/backend-api/codex/responses`（Codex 把 `/v1/responses` 和 `/chat/completions` 路径重写到该端点）。必须头：`Authorization: Bearer <access_token>`、`ChatGPT-Account-Id: <chatgpt_account_id>`（多 workspace 账号必需）、`originator: <客户端标识>`、`session_id`；可选 `x-openai-internal-codex-residency`（数据驻留）。**[观察]**（Codex `model-provider-info` CHATGPT_CODEX_BASE_URL + `to_api_provider` 按 AuthMode 选后端；OpenCode codex.ts:413-426；Roo openai-codex.ts:359-362）
- **API key 模式**：`https://api.openai.com/v1`，`Authorization: Bearer sk-…`。**[观察]**
- 副产品：Codex 登录后还会用 id_token 做一次 RFC 8693 token-exchange（`requested_token=openai-api-key`）换得一把 API key 存入 auth.json（用于那些只认 key 的组件）；失败不阻塞登录。**[观察]**（server.rs `obtain_api_key`）
- 请求头里的 `originator` 是自我申报的客户端标识（`codex_cli_rs`、`opencode`、`zed`、`roo-code`、`cline` 各用各的），服务端可据此区分客户端。**[观察]**——这意味着 OpenAI 一直能看到第三方客户端的存在。

### 刷新与登出

- 主动刷新：access token 距 exp ≤5 分钟即刷新（manager.rs `CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES`）；兜底按 `last_refresh` 每 8 天刷新一次（`TOKEN_REFRESH_INTERVAL`）。**[观察]**
- 失败分类：refresh token 过期 / 已被复用 / 已被撤销 / 账号不匹配，均提示「重新登录」；网络类错误为 transient。**[观察]**
- 登出：先向 `https://auth.openai.com/oauth/revoke` 发 best-effort 撤销（优先 refresh token，带 client_id），即使撤销失败也删除本地凭据。**[观察]**（auth/revoke.rs）
- 401 恢复：有 `UnauthorizedRecovery` 机制（manager.rs 导出）。**[观察]**

### OpenAI 的政策立场

- **允许/默许的证据**：Codex CLI 是开源的（client_id 本就是公开常量）；OpenCode、Roo、Cline、Zed 长期公开复用且 OpenCode 官方文档公开宣传「ChatGPT Plus zero setup」；未检索到 OpenAI 对任何第三方客户端采取封禁行动的公开报道。**[观察/推导]**
- **未授权的证据**：OpenAI 没有公开的第三方 OAuth 注册门户；redirect_uri 白名单写死在 OpenAI 服务端，第三方无法注册自己的回调地址（只能借用 1455/1457）；`codex_cli_simplified_flow`、`originator` 参数名都表明这是 Codex CLI 的第一方流程。**[观察/推导]**
- **风险先例（Anthropic）**：Anthropic 明确禁止订阅 OAuth 用于第三方工具，OpenCode 1.3.0 移除了内建 Claude Pro/Max 插件。**[观察]**（opencode.ai/docs/providers 原话：*"There are plugins that allow you to use your Claude Pro/Max models with OpenCode. Anthropic explicitly prohibits this. Previous versions of OpenCode came bundled with these plugins but that is no longer the case as of 1.3.0"*）
- **[传闻]** 社区有「OpenAI 曾封禁某些滥用 Codex OAuth 的客户端/账号」的说法，本次调研未找到可核实的一手来源，按传闻处理。
- OpenAI 服务条款原文未能直接核查（openai.com/policies 被 Cloudflare challenge 拦截，403）。**[未知]**

---

## 竞品对照表（子问题 2）

核查日期均为 2026-10-10。模型列表来源列中，「动态」指从服务端拉取，「静态」指代码内置清单。

| 产品 | OpenAI 连接方式 | 模型列表来源 | 登录态失效处理 |
|---|---|---|---|
| **Codex CLI**（官方） | OAuth（localhost 1455/1457 回调 + device code 备选）或 API key；token 存 `~/.codex/auth.json`（0600）或系统 keyring | 静态（按 AuthMode 过滤；ChatGPT 模式走 codex 后端） | exp 前 5 分钟主动刷新；refresh 轮换，复用/过期/撤销→要求重新登录；登出先调 revoke 端点 |
| **Claude Code**（Anthropic 官方） | OAuth（claude.ai 账号，浏览器 + 本地回调；回调不可达时改为「粘贴 code」）；或 `ANTHROPIC_API_KEY`；另有 Console 免 key OAuth（v2.1.242+，自动刷新，refresh 失败报 "Anthropic profile login expired"） | 静态内置 | OAuth 自动刷新；`/logout` 清除并撤销凭据；多账号用 `CLAUDE_CONFIG_DIR` 隔离 |
| **OpenCode**（第三方 TUI/桌面） | 内建 ChatGPT OAuth 插件：同一 client_id、localhost:1455 回调 + device code 备选；`originator=opencode`；token 存 `~/.local/share/opencode/auth.json`（0600） | models.dev 目录 + OAuth 模式下的 allow/deny 规则（ALLOWED_MODELS + "新于 GPT-5.4" 版本规则，pro/nano/o 系排除） | access 过期自动调 `/oauth/token` refresh（单flight refreshPromise）；Anthropic 订阅 OAuth 因 Anthropic 禁止已于 1.3.0 移除 |
| **Aider** | 仅 API key（`OPENAI_API_KEY` / `--api-key`）；无 OAuth | 静态（litellm 目录） | 无登录态概念，key 失效即报错 |
| **Cline** | 内建 OpenAI Codex OAuth（同 client_id、1455 回调、`originator=cline`），token 存 VS Code 全局状态；另有自有 Cline 账号（Firebase OAuth） | 静态 codex 模型清单（含 400K/272K/128K 上下文修正，注明「镜像 Codex CLI」） | refresh token 自动刷新 |
| **Roo Code**（Cline 分支） | 内建 OpenAI Codex OAuth（同 client_id、1455 回调、`originator=roo-code`） | 静态 `openAiCodexModels` 清单（gpt-5.1-codex 系列等，价格记 0）；另有 `chatgpt.com/backend-api/wham/usage` 拉取订阅用量窗口（5 小时/周窗口百分比） | 自动刷新；提供用量面板 |
| **Continue** | 仅 API key（OpenAI.ts 为标准 key 客户端） | 静态 + 可配 | 无登录态概念 |
| **Zed** | 内建「ChatGPT Subscription」provider：同 client_id、localhost 1455/1457 回调（源码注释明确说明白名单限制）、`originator=zed`；凭据存系统 credential store；**刻意省略 `api.connectors.*` scope** 以把 token 塞进 Windows Credential Manager 的 2560 字节上限 | **动态**：登录后拉 `chatgpt.com/backend-api/codex/models?client_version=…`（按账号返回可见模型，含 slug/visibility/priority/context_window/最低客户端版本），5s 起等 + 60s 上限 | 凭据过期自动刷新；sign-out 清凭据 |
| **Cherry Studio** | OpenAI 本体仅 API key；OAuth 用于 GitHub Copilot（device flow，套用 copilot.vim 的 client_id/UA）和自家 CherryIN/TokenDance（PKCE + 127.0.0.1 随机端口回调） | 动态（`/v1/models` 拉取，key 模式） | Copilot token 定期换发 |
| **LobeChat** | API key 为主；服务端组件用 better-auth/OIDC；观察到有 codex quota 相关服务（desktop 版通过本机 Codex CLI 读取订阅用量），未见内建 OpenAI OAuth 登录通路 | 动态 + 静态混合 | —（未深入） |
| **Raycast** | 闭源，未能核实源码。其 AI 功能主要为自家订阅网关（Raycast AI）+ 可选自带 key；未见公开资料表明内建 ChatGPT OAuth。**[部分未知]** | — | — |

### 横向规律

1. **「登录代替填 key」的第一方标配形态**：官方 CLI（Codex、Claude Code）= OAuth 优先、key 兜底（CI 场景）；本地回调不可达时用 device code / 粘贴 code 降级。
2. **第三方复用 Codex OAuth 的通用配方**（OpenCode/Roo/Cline/Zed 四家几乎逐行一致）：同一公开 client_id + localhost:1455 回调 + PKCE + `codex_cli_simplified_flow=true` + 自家 `originator` + 请求时带 `ChatGPT-Account-Id` + 把请求重写到 `chatgpt.com/backend-api/codex/responses`。
3. **模型列表三种做法**：静态清单（多数）、动态目录（Zed 拉 `/codex/models`，最贴近账号实际可见性）、目录+规则过滤（OpenCode 用 allow/deny + 版本规则）。
4. **登录态失效的统一处理**：refresh token 自动刷新（轮换语义，旧 refresh 不可复用）；refresh 失败 → 标记凭据失效 → 提示重新登录；登出 best-effort 调 revoke 端点。
5. **Anthropic 通路是反面教材**：第三方订阅 OAuth 被明确禁止并移除（OpenCode 1.3.0），说明这条路的政策窗口随时可能关闭。

---

## API key vs OAuth（ChatGPT 订阅）能力差异（子问题 3）

来源：developers.openai.com/codex/pricing、developers.openai.com/codex/auth（2026-10-10 核查）、各客户端源码。

| 维度 | API key（api.openai.com/v1） | OAuth（chatgpt.com/backend-api/codex） |
|---|---|---|
| 计费 | 按 token 计费（OpenAI Platform 账户，标准 API 价格） | 订阅包含额度（Plus $20 / Pro $100-500 等），按 5 小时窗口 + 周窗口限流；Plus 可用 ChatGPT credits 追加 |
| 可用模型 | 你的 key 可用的全部 API 模型（含 pro 变体等） | 子集：Codex 系列 + 策划的 GPT 模型；pro 变体、o 系、部分 nano 被排除（OpenCode/Cline 过滤规则 + Codex 官方 pricing 页按套餐列模型） |
| 端点/协议 | `api.openai.com/v1`（Responses + Chat Completions） | `chatgpt.com/backend-api/codex/responses`（仅 Responses 形态；客户端把 `/v1/responses` 与 `/chat/completions` 重写过去） |
| 上下文窗口 | API 目录值（GPT-5.5+ 标称 1.05M） | Codex 后端统一 400K context / 272K input / 128K output（约 95% 输入上限后拒绝）；Cline 源码注明「镜像 Codex CLI」 |
| rate limit | API 账户的 RPM/TPM 档位 | 订阅消息额度：Plus 每 5 小时约 15-160 条本地消息（GPT-6.1 Sol）至 350-3000 条（GPT-6 Luna），云端任务另计；Pro 无 5 小时硬限（2026-10 官方定价页） |
| 云端/平台功能 | 无（GitHub code review、Slack 等云功能不可用） | 有（Codex cloud、Work Cloud、插件等，视套餐） |
| 管理/数据策略 | API 组织的数据/保留策略 | ChatGPT workspace 的 RBAC/保留/驻留策略；企业可强制登录方式（`forced_login_method`）与 workspace 白名单（`allowed_workspace_id`），Codex 端 enforce |
| 适用场景 | 自动化、CI、程序化调用（官方定位） | 交互式本地开发（官方定位） |

### 服务条款风险

- **API key 通路**：标准商用条款，第三方应用集成是设计用途，无特殊风险。
- **OAuth 通路复用 Codex client_id**：
  - 无书面授权（见「政策立场」）；OpenAI 可单方面改白名单、按 originator 封客户端、或对账号限速/封号——技术上 OpenAI 完全看得见（originator + UA 自我申报）。**[推导]**
  - 对用户的实际后果模型：最严重是账号侧处罚（ChatGPT 账号被限）；更常见的是客户端被封（auth.openai.com 拒绝该 originator/client 的请求），用户换工具即可。**[推导]**
  - Anthropic 先例表明行业内有供应商会主动执法；OpenAI 截至目前（2026-10）未对 OpenCode/Roo/Cline/Zed 采取公开行动。**[观察]**
  - OpenAI ToS 具体条文未能核实（网站反爬拦截），任何方案落地前应人工精读 Terms of Use / Codex 条款中关于「通过非官方客户端访问服务」的表述。**[未知]**

---

## 关键未知

1. **OpenAI 书面政策**：是否存在禁止/允许第三方复用 Codex OAuth client 的明文条款（ToS 原文本次未抓到，被 Cloudflare 拦截；help.openai.com 的 Codex FAQ 同被拦截，仅在 Roo/Cline 源码注释中看到引用）。落地前需人工阅读条款原文。
2. **Raycast 现状**：闭源，无法核实其 AI 连接的实现方式。
3. **OAuth 通路的图像生成能力**：Molly 是设计应用，图像模型（gpt-image 系列）是否经 `chatgpt.com/backend-api/codex` 暴露，未见任何证据——Codex 后端面向编码模型，**[推导]** 图像连接大概率仍需 API key 通路（Molly 的 ImageConnection 独立于 ModelConnection，本任务不展开）。
4. **`chatgpt.com/backend-api/codex/models` 目录的具体协议**：Zed 源码展示了请求/响应形状（client_version 门控、visibility、priority），但非官方文档，字段可能随时变。
5. **封禁先例**：未能找到 OpenAI 封禁第三方客户端或用户账号的可核实案例（社区有说法，标注为传闻）。
6. **Windows 凭据存储限制**：Zed 为塞进 Windows Credential Manager 2560 字节而砍 scope（issue #58541）——Molly 用 safeStorage 加密文件而非 Credential Manager，理论上不受此限，但跨平台存储方案需单独确认。**[推导]**

---

## 来源清单

一手来源（均为 2026-10-10 核查）：

1. OpenAI Codex CLI 源码（openai/codex，main 分支）：
   - `codex-rs/login/src/server.rs`（issuer、端口 1455/1457、scope、originator、obtain_api_key token-exchange）— https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs
   - `codex-rs/login/src/auth/manager.rs`（CLIENT_ID、refresh/revoke 端点、刷新窗口、错误文案、enforce_login_restrictions）— https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs
   - `codex-rs/login/src/token_data.rs`（id_token claims 结构）— https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs
   - `codex-rs/login/src/auth/storage.rs`（auth.json 结构、0600、keyring）— https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs
   - `codex-rs/login/src/auth/revoke.rs`（登出撤销）— https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/revoke.rs
   - `codex-rs/login/src/device_code_auth.rs`（device flow）— https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs
   - `codex-rs/login/src/oauth/authorization.rs`（PKCE S256 授权 URL 构造）— https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/authorization.rs
   - `codex-rs/model-provider-info/src/lib.rs`（CHATGPT_CODEX_BASE_URL、按 AuthMode 选后端）— https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs
   - `codex-rs/core/src/client.rs`（originator/session 头、/responses 路径）— https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs
2. OpenCode（anomalyco/opencode，dev 分支）：
   - `packages/opencode/src/plugin/openai/codex.ts`（client_id 复用、重写端点、刷新、device flow、模型过滤）— https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/plugin/openai/codex.ts
   - `packages/opencode/src/auth/index.ts`（auth.json 存储）— https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/auth/index.ts
   - OpenCode Providers 文档（Anthropic 禁令原文、ChatGPT Plus zero setup）— https://opencode.ai/docs/providers/
3. Zed（zed-industries/zed，main 分支）：
   - `crates/openai_subscribed/src/openai_subscribed.rs`（重定向白名单注释、动态模型目录、Windows 凭据上限、scope 裁剪）— https://github.com/zed-industries/zed/blob/main/crates/openai_subscribed/src/openai_subscribed.rs
   - `crates/language_models/src/provider/openai_subscribed.rs`（"Sign in with your ChatGPT Plus or Pro subscription" UI）— https://github.com/zed-industries/zed/blob/main/crates/language_models/src/provider/openai_subscribed.rs
4. Roo Code（RooCodeInc/Roo-Code，main 分支）：
   - `src/integrations/openai-codex/oauth.ts`（OAuth 配置、JWT 账号提取）— https://github.com/RooCodeInc/Roo-Code/blob/main/src/integrations/openai-codex/oauth.ts
   - `src/api/providers/openai-codex.ts`（后端 URL、请求头）— https://github.com/RooCodeInc/Roo-Code/blob/main/src/api/providers/openai-codex.ts
   - `src/integrations/openai-codex/rate-limits.ts`（wham/usage 用量接口）— https://github.com/RooCodeInc/Roo-Code/blob/main/src/integrations/openai-codex/rate-limits.ts
   - `packages/types/src/providers/openai-codex.ts`（静态模型清单、订阅 0 成本）— https://github.com/RooCodeInc/Roo-Code/blob/main/packages/types/src/providers/openai-codex.ts
5. Cline（cline/cline，main 分支）：
   - `apps/vscode/src/integrations/openai-codex/oauth.ts` — https://github.com/cline/cline/blob/main/apps/vscode/src/integrations/openai-codex/oauth.ts
   - `sdk/packages/llms/src/providers/openai-codex-models.ts`（模型过滤、上下文窗口注释）— https://github.com/cline/cline/blob/main/sdk/packages/llms/src/providers/openai-codex-models.ts
6. Claude Code 官方文档：Authentication — https://code.claude.com/docs/en/authentication
7. OpenAI Codex 官方文档：
   - Authentication — https://developers.openai.com/codex/auth
   - Pricing（套餐/消息额度/API key 差异）— https://developers.openai.com/codex/pricing
8. Cherry Studio（CherryHQ/cherry-studio，main 分支）：
   - `src/main/services/CopilotService.ts`（GitHub Copilot device flow）— https://github.com/CherryHQ/cherry-studio/blob/main/src/main/services/CopilotService.ts
   - `src/main/services/tokenDanceOAuth.ts`（自有 PKCE OAuth）— https://github.com/CherryHQ/cherry-studio/blob/main/src/main/services/tokenDanceOAuth.ts
9. Aider 文档：OpenAI 连接 — https://aider.chat/docs/llms/openai.html
10. Continue（continuedev/continue）：`core/llm/llms/OpenAI.ts` — https://github.com/continuedev/continue/blob/main/core/llm/llms/OpenAI.ts
11. LobeChat（lobehub/lobehub，canary 分支）：`src/services/codexQuota.ts` — https://github.com/lobehub/lobehub/blob/canary/src/services/codexQuota.ts
12. 本仓库：apps/electron/src/main/services/connection-check.ts（现状确认）
