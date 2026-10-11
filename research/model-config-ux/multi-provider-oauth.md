# Phase 4 方案草案：多 provider OAuth（复用 pi-ai 官方流程）

- 版本：v1（2026-10-10），状态：草案，未经人工批准。
- 前置：Phase 3 已把 OpenAI 登录迁到 pi-ai 的 `openaiChatGPTOAuth`（OpenAI 官方动态客户
  端注册，access token 直上 api.openai.com），并建立了全部通用件：Electron 侧
  `Models.login(providerId, 'oauth', interaction, { getDeviceId })` 编排、vault 的
  `mutateOAuth(connectionId, fn)` 锁内刷新适配、worker 的 OAuth account 锚
  （`chatgpt_account_id` claim）、设置 UI 的 waiting/cancel 流。本文评估其余 pi-ai 内建
  OAuth provider 的复用面与增量成本。

## pi-ai 1.0.4 的 OAuth provider 清单与 Molly 映射

| pi-ai OAuthAuth | Molly preset | 流程 | 用户价值 | 备注 |
|---|---|---|---|---|
| `anthropicOAuth`（Claude Pro/Max） | `anthropic` | 浏览器回调，loopback 端口 53692 | 高 | 订阅持有率最高；**合规需单独确认**（见下） |
| `kimiCodingOAuth`（Kimi Code 订阅） | `kimi-coding` | device-code（RFC 8628, auth.kimi.com） | 高 | 国内主力；无回调端口占用问题 |
| `xaiOAuth`（Grok/X 订阅） | `xai` | device-code | 中 | — |
| `gitHubCopilotOAuth` | （无 preset） | device-code | 中 | 需新增 preset + catalog 映射 |
| `openRouterOAuth` | `openrouter` | 浏览器回调 | 低 | OpenRouter 按用量计费，订阅增益小 |
| `metaOAuth` / `radiusOAuth` | （无 preset） | device-code | 低 | 不在 Molly catalog |

未覆盖 preset：`google`（pi-ai 的 Gemini CLI / Antigravity OAuth 在 1.0.4 未进
`load.*` 公共面）、`deepseek` / `moonshot` / `zai` / `minimax`（pi-ai 无 OAuth，
保持 API key）。

## 复用面（Phase 3 已建成的通用件）

1. **Electron 服务**：`OpenAiAuthService` 泛化为 provider 参数化即可——`createModels` +
   `setProvider(<provider>())` + `login(providerId, 'oauth', interaction)` 对全部
   provider 同一 API。浏览器回调类（Anthropic/OpenRouter）与现流程一致；device-code 类
   （Kimi/xAI/Copilot）不需要 loopback 端口，回调竞态整类消失。
2. **Vault**：token-set schema（`{accessToken, refreshToken, accessTokenExpiresAt,
   clientId?}`）与 `mutateOAuth(connectionId, fn)` 锁已通用。需要泛化的是
   `authType: 'openai_oauth'` 的 OpenAI 专名与「每 provider 至多一个 OAuth 行」约束。
3. **Worker 锚**：`grantedOAuthAccountId` 比较与 provider 无关；Anthropic 等的 account
   标识 claim 名不同（需逐个确认 JWT claim 或退化为「同 provider 同连接即接受轮换」）。
4. **Catalog/picker**：pi-ai 每个 OAuth provider 自带 catalog，正好落在同名 preset 上；
   picker 无需再分 codex catalog（已随迁移删除）。

## 增量成本（每个 provider 真实要新增的东西）

| 件 | 浏览器回调类 | device-code 类 |
|---|---|---|
| Schema | `authType` 枚举扩值（或改为 `'oauth'` + provider 字段） | 同左 |
| IPC | 现 begin/complete/cancel 加 providerId 参数 | 同左 |
| UI | 现 waiting/cancel 卡片复用 | **新增 device-code 态**：显示 userCode + 「打开验证页」按钮（`notify` 的 `device_code` 事件） |
| 连接检查 | 各 provider `/models` 或等价探测 | 同左 |
| Vault | 每 provider 至多一行的约束落到 schema refine | 同左 |

## 合规分层（不能照搬 OpenAI 结论）

- **OpenAI**：官方动态客户端注册（`dynamic_agent_client` + `agent_name_hint`），第三方
  属明确支持的路径。Phase 3 已落地。
- **Anthropic**：pi 用的 client 是否官方认可未见公开声明；Anthropic 历史上对第三方借用
  Claude 订阅 OAuth 有过限制性表态。上线前需人工确认 Anthropic 条款，措辞参照 Phase 3
  的 ToS 闸门。
- **Kimi/xAI/Copilot**：device-code 流程本身多为公开 RFC 8628 端点；但「第三方 app 用
  订阅配额」的条款仍需逐个读。建议每个 provider 上线前各过一次人工条款确认。

## 建议顺序

1. **`kimi-coding`**（先落地 device-code 泛化层：UI 新态 + schema 泛化，国内用户价值最高，
   且无回调端口竞态）。
2. **`anthropic`**（订阅持有率最高，但先过合规闸门）。
3. `xai` → `github-copilot`（后者要新增 preset）→ 其他按需。

每期独立交付；任何一期的合规闸门不通过都不阻塞其他期。

## 关键未知

1. Anthropic OAuth 第三方使用的条款现状（人工精读）。
2. 各 provider access token 的 account 标识 claim 名（worker 锚需要；无 claim 的退化为
   provider+connection 身份）。
3. device-code 流程在无人值守/远程会话下的 UX（Molly 是桌面 app，浏览器在本机，风险低）。
4. `google` preset 的 OAuth 是否值得向 pi-ai 上游提需求（Gemini CLI OAuth 已在 pi 代码
   库但未进 1.0.4 公共 API）。
