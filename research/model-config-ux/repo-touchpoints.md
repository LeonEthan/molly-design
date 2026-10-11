# Molly 桌面设置页「Models」模型配置 —— 现状改造面清单

> 只读调查，不修改任何产品文件。目标：为「Models UX 重做 + OpenAI OAuth 登录 + OpenAI-compatible
> 自动模型发现」提供精确的现状文件/行号清单与最小改动面。
> 仓库：worktree `707e376b-50aa-4694-a1cf-0477fef06e89`。

---

## 1. 设置页信息架构

### 1.1 Tab/分类注册表（唯一真相）

`settings-tabs.tsx` (packages/components/src/components/settings/settings-tabs.tsx)

- `SettingsTabId` 联合类型：L18-33（`account/preferences/appearance/browser-accounts/
  keyboard-shortcuts/workspace/people/machines/agents/mcp/projects/advanced/ai-usage/billing/about`，
  多个 hosted 遗留 id 只保留解析兼容）。
- `SETTINGS_TAB_CONFIGS`：L68-153。section 只有 `main` / `other` 两组：
  - `main`：preferences(L69)、appearance(L78)、**agents(L86, icon=Bot, labelKey=
    `settings.tabs.agents` = “AI models”)**、browser-accounts(L94, `localDesktopOnly`)、
    keyboard-shortcuts(L103)、machines(L111, `multiMemberOnly`)。
  - `other`：advanced(L120)、mcp(L128, `parent: 'advanced'`)、projects(L137,
    `parent: 'advanced'`)、about(L146)。
- `useVisibleSettingsTabs`：L155-164（按 multiMember/localDesktop 过滤）。
- `getActiveSettingsTabId` 路径后缀映射：L166-191；注意 **没有独立的
  `/settings/models` 路径**，遗留路径 `/settings/agent-config` 与 `/settings/image-connection`
  都解析到 `agents`（L180、L182）。

**结论：「Models」没有自己的 tab；它是 `agents` tab 内的第一个 section。** 若 UX 重做要把
Models 提成顶级分类，需要动 `SettingsTabId`、路由后缀表、desktop modal 的 switch 与
`SettingsCategoryList`（settings-category-list.tsx L74-98 按 section+`!tab.parent` 渲染）。

### 1.2 桌面设置弹窗

`desktop-settings-modal.tsx` (packages/components/src/components/settings/desktop-settings-modal.tsx)

- 布局：左侧 208px 导航列（L90-136）+ 右侧内容列（L138-169），section 顺序硬编码
  `['main', 'other']`（L82）。
- `SettingsTabContent` switch：L179-219。`agents` → `<MachineAgentSettings mode="agents"/>`
  （L194-201）；`advanced/mcp/projects` → `<AdvancedSettings/>`（L190-193）。
- 移动/窄屏入口用 `settings-category-list.tsx` (packages/components/src/components/settings/settings-category-list.tsx)
  L40-102（`SettingsCategoryList`）与 L148-200（`SettingsCategoryGrid`，含全部 tab 卡片）。

### 1.3 `agents` tab 的实际内容（“AI models”页）

`machine-agent-settings.tsx` (packages/components/src/components/settings/machine-agent-settings.tsx)

- L138-141：`mode === 'machines'` 走机器管理视图；否则 `EmbeddedAgentSettings`。
- `EmbeddedAgentSettings` L145-181，自上而下：
  1. `<DesignReadiness>`（L165-169）：设计就绪条，见 1.4。
  2. `<ModelConnectionSetting onConnectionsChange={...}>`（L171）：模型连接管理本体，
     通过 `onConnectionsChange` 把连接列表回传给就绪条。
  3. `<ImageConnectionSetting onConnectionChange={...}>`（L174）：图像连接。
  4. `<AgentEngineCatalog>`（L177）：仅当本机存在 legacy 配置时显示。
- `reveal()`（L158-162）用 scrollIntoView 把就绪条点击滚到对应 section。

### 1.4 相关组件分工

| 组件 | 文件 | 职责 |
|---|---|---|
| ModelConnectionSetting / ModelConnectionForm / ModelConnectionRow | `model-connection-setting.tsx` (packages/components/src/components/settings/model-connection-setting.tsx) L542/L185/L777 | 模型连接的列表、表单（provider 选择、key、endpoint、models 子集）、行开关/删除/检查 |
| ImageConnectionSetting | `image-connection-setting.tsx` (packages/components/src/components/settings/image-connection-setting.tsx) L565（form L224，summary L485） | 图像生成连接（独立单槽，走同一 vault/IPC 组，支持模型列表 suggestions L181-222） |
| DesignReadiness / DesignReadinessView | `design-readiness.tsx` (packages/components/src/components/settings/design-readiness.tsx) L155/L35 | 顶部就绪条：Models / Image generation / Pinterest 三个 chip，纯派生展示，不存储不测试（L154 注释） |
| AgentEngineCatalog | `agent-engine-catalog.tsx` (packages/components/src/components/settings/agent-engine-catalog.tsx) L9 | legacy 引擎配置只读清单（`legacyAgentConfigs` L5-6 过滤非 builtin/molly） |
| BundledCapabilitiesSetting | `bundled-capabilities-setting.tsx` (packages/components/src/components/settings/bundled-capabilities-setting.tsx) L147 | 展示打包的 Pi 引擎与插件版本；挂在 **Advanced → System**（`advanced-settings.tsx` (packages/components/src/components/settings/advanced-settings.tsx) L7、L63），不在 agents tab |
| connection-check | `connection-check.tsx` (packages/components/src/components/settings/connection-check.tsx) | `useConnectionCheck`（L21，700ms 防抖 L14）、`ConnectionCheckLine`（L79）、`ConnectionCheckBadge`（L140）；models 与 image 两个表单共用 |
| ModelChecklist | `model-checklist.tsx` (packages/components/src/components/settings/model-checklist.tsx) L35 | native preset 的打包 catalog 勾选清单（搜索/全选/“not on this account”标记） |
| CompatibleModelFields | `compatible-model-fields.tsx` (packages/components/src/components/settings/compatible-model-fields.tsx) L38 | openai-compatible 的手工模型声明表（modelId/name/contextWindow/maxTokens/thinking/toolCalls/usageInStreaming/maxTokensField，L66-186） |
| AcpAuthenticationPanel | `acp-authentication-panel.tsx` (packages/components/src/components/settings/acp-authentication-panel.tsx) | **legacy 外部 agent CLI 的认证面板**（含 OAuth URL 展示），仅被 agent-config-dialog / provider-setup-row / ai-gui 使用，**不在 Models 连接表单内**；其 UX 可借鉴但不可直接复用（绑定 MachineAcpAuthentication RPC） |

### 1.5 Onboarding 中的模型配置

- 步骤表：`onboarding-steps.ts` (packages/components/src/components/onboarding/onboarding-steps.ts) L3-15；
  桌面顺序 L22-30：`ceremony → (login?) → (workspace?) → providers → projects → firstTask`。
- 模型配置步骤 = `providers`：
  `providers-screen.tsx` (packages/components/src/components/onboarding/screens/providers-screen.tsx)
  - L93-108 `ProvidersScreen` 直接把 `<ModelConnectionSetting/>` 作为 `connections` 插槽挂入
    （L106），即 onboarding 与设置页**共享同一个表单组件**。
  - 下方再列本机 Molly agent config 供选择（L70-87，`isOnboardingMollyConfig` 过滤），
    未选不能 Next（L53-63），可 Skip。
- `firstTask` 步骤也消费模型 picker 投影：
  `first-task-screen.tsx` (packages/components/src/components/onboarding/screens/first-task-screen.tsx)
  L17、L74-75、L140-141 用 `decodeMollyModelOption` 校验/过滤 `molly-model:` 选项。
- settings/AGENTS.md L77-78 明确：onboarding 复用 `ModelConnectionSetting`，不挂
  `AgentConfigDialog`。

**含义：重做模型连接 UX 必然同时改变 onboarding 的 providers 步**；若给表单新增参数
（如 OAuth 入口），providers-screen 需要同步传递。

---

## 2. 连接存储与凭据链路

### 2.1 Vault（main 进程）

`model-connection-store.ts` (apps/electron/src/main/services/model-connection-store.ts)

- `ModelConnectionStore` L60-471。**单例**由
  `model-connections.ts` (apps/electron/src/main/services/model-connections.ts) L6-9 创建：
  目录 = `app.getPath('userData')/secrets`，cipher = Electron `safeStorage`。
- 存储文件：`secrets/model-connections.enc`（L97、L150），整体 `safeStorage.encryptString(
  JSON.stringify(store))`，原子写（tmp + rename + dir fsync，L134-165）。
- StoreSchema L36-57：
  `entries: Array<{ connection: ModelConnectionSchema, apiKey: string(1..16384) }>`（最多 256
  条）+ 可选 `image` + 可选 `legacyImages` + 可选 `mcp`。**凭据就是每条 entry 里一个明文
  `apiKey` 字段**（在加密文件内）；`credentialRef`（store L407 生成 `randomUUID()`）目前
  只是公开元数据里的 opaque 引用，**renderer 从未拿到 key**（SaveModelConnectionSchema
  omit 了 `credentialRef`，shared schema 见 2.3）。
- 防降级：`assertProtectedStorage` L76-84（safeStorage 不可用、或 Linux 下
  `basic_text/unknown` 后端时抛 `credential_storage_unavailable`，fail closed）。
- 串行化：`serial()` L86-90 把所有操作排成 promise 链。
- revision CAS：
  - `save()` L377-421：更新必须 `data.id` 命中且 `expectedRevision` 相等，否则
    `model_connection_revision_conflict`（L386-390）；revision 单调 +1（L406）；
    `credentialRef` 在首次创建后保持不变（L407）；**改了 baseUrl 或 providerPresetId
    而未附新 key → `model_connection_destination_requires_credential`**（L394-402）；
    无 key（新建且未给）→ `model_connection_credential_required`（L392-393）。
  - `delete()` L423-435：同样 `expectedRevision` CAS。
- 供运行/检查读取 secret 的内部入口（**均非 IPC**）：
  `credentialForCheck` L438-446、`acquireForRun` L459-470（要求 enabled + revision 精确匹配）、
  以及 image/mcp 对应物（L359-375、L238-248）。

### 2.2 IPC 层

`model-connections-ipc.ts` (apps/electron/src/main/ipc/services/model-connections-ipc.ts)
`ModelConnectionsIpc`，`groupName = 'modelConnections'`（L36-37）：

| 方法 | 行号 | 作用 |
|---|---|---|
| getBundledCapabilities | L39-42 | 打包引擎/插件清单 |
| getSnapshot | L44-47 | 全部 ModelConnection（无 key） |
| getImageSnapshot | L49-52 | 图像连接 |
| getMcpSnapshot / saveMcp / deleteMcp / listMcpTools | L54-116 | MCP 凭据 |
| saveImage / deleteImage / checkImage | L118-137 | 图像连接 |
| **check** | L139-144 | `CheckModelConnectionSchema` 校验 → `checkModelConnection(store, input)` |
| **getModelCatalog** | L146-149 | `readBundledModelCatalog()`（打包 model-catalog.json，带 sha256 校验） |
| **save / delete** | L151-163 | 再次 safeParse 后直传 store |

注册：`register-services.ts` (apps/electron/src/main/ipc/register-services.ts) L9、L25；
`ElectronIpcServices` 类型 L40 由此推导（renderer 端类型安全代理
`electron-ipc-client.ts` (packages/components/src/lib/electron-ipc-client.ts) L15-17、L52-54，
运行期是 `window.ipc.invoke('modelConnections.<method>')` 的 Proxy，L23-45）。

**Preload 白名单**：`ipc-invoke-policy.ts` (apps/electron/src/preload/ipc-invoke-policy.ts)
L1-15（`IPC_INVOKE_SERVICE_GROUPS` 含 `'modelConnections'`，L6），由
`ipc-bridge.ts` (apps/electron/src/preload/ipc-bridge.ts) L29-34 在每次 invoke 前强制校验。
**新增 IPC 方法不需要改白名单**（白名单按组放行，不按方法）；新增服务组才需要。

### 2.3 共享契约（renderer 可见的 schema）

`embedded-harness.ts` (packages/shared/src/embedded-harness.ts)

- `ProviderPresetIdSchema` L398-410：11 个 preset（openai/anthropic/google/xai/deepseek/
  moonshot/kimi-coding/zai/minimax/openrouter/openai-compatible）。
- `MOLLY_PROVIDER_IDS` L455-467：preset → pi SDK provider id（`openai-compatible` →
  `'molly-compatible'`）。
- `PROVIDER_PRESET_DEFAULT_BASE_URLS` L474-488 + `isProviderPresetDefaultEndpoint` L495-500。
- `PROVIDER_PRESET_CHECKS` L507-522：每个 preset 用哪种免费检查协议。
- `ConnectionCheckFailure` L524-534、`ConnectionCheckResult` L536-538（
  `ok:true` 可带 `models?: string[]` —— 检查得到的模型列表）。
- `CheckModelConnectionSchema` L541-550（apiKey 或 stored{id,revision} 二选一）。
- `ModelConnectionSchema` L610-637：公开字段 = schemaVersion/id/revision/
  providerPresetId/displayName/baseUrl/credentialRef/enabled/customModels?/models?；
  refine：customModels 仅 openai-compatible，models 仅非 openai-compatible。
- `SaveModelConnectionSchema` L640-667：omit id/revision/credentialRef，增加
  `expectedRevision` 与可选 `apiKey`；**这里没有任何 OAuth 字段**。
- `ModelSelectionSchema` L723-730、`encode/decodeMollyModelOption` L735-756
  （`molly-model:<connId>/<modelId>` 编码，picker 投影用）。

### 2.4 新增凭据类型（OAuth token set）会碰到的文件

假设要为 OpenAI 存 `{accessToken, refreshToken, expiresAt}`：

**必须动：**
1. `packages/shared/src/embedded-harness.ts` —— `SaveModelConnectionSchema`（L640）
   需要能表达“本连接走 OAuth”；`ModelConnectionSchema`（L610）公开元数据可能加
   `authType` 字段；`CheckModelConnectionSchema`（L541）若检查也要用 OAuth。
2. `apps/electron/src/main/services/model-connection-store.ts` —— `StoreSchema` L36-48
   的 entry（目前只有 `apiKey`），`save()` L392-402 的 key 保留/目的地变更规则，
   `credentialForCheck`/`acquireForRun` 的返回类型（L438-470 现在返回
   `{connection, apiKey}`），以及 **access token 过期刷新逻辑放这里或单独 service**
   （store 现在纯同步读写，无网络；刷新需要 fetch → 更像 connection-check.ts 的邻居）。
3. `apps/electron/src/main/ipc/services/model-connections-ipc.ts` —— 新增 OAuth 开始/完成
   方法（发起授权 URL、轮询或接收回调、换取 token 写入 vault）。注意现有 check/save
   签名假设单 apiKey。
4. `apps/electron/src/main/services/connection-check.ts` —— `checkModelConnection` L120-143
   目前把 saved 凭据当 `apiKey: string`；OAuth 需要先用 access token（或先刷新）。
5. **运行时取凭据链**（见 §3）：`harness-credential-host.ts` L86-93 的
   `store.acquireForRun(...).then(({connection, apiKey}) => ...)` 与
   `HarnessCredentialReportSchema.result.ok.apiKey`（shared L895-897，max 16384 的 string），
   再到 `WorkerCredentialGrantSchema.apiKey`（worker-config.ts L32-39）与
   `PiAcpHost.execute` 的 `runtime.setRuntimeApiKey(providerId, grant.apiKey)`
   （host.ts L388-395）。整条“credential grant”链路只搬一个字符串；OAuth 要么在授予前
   由 main 侧刷新并仍以 access token 作为 apiKey 下发（改动最小），要么改 schema。
6. OAuth 回调通道：现有 deep link 已存在（`app.deepLink` push 通道
   `electron-ipc-channels.ts` (packages/shared/src/electron-ipc-channels.ts) L44、L72；
   main 处理 `deep-link.ts` (apps/electron/src/main/deep-link.ts) L23+；renderer 消费例：
   `desktop-invite-deep-link.ts` (packages/components/src/lib/desktop-invite-deep-link.ts)），
   新增一种 callback 类型走同一通道即可，不需要新 push 通道。
7. `packages/components/src/components/settings/model-connection-setting.tsx` —— 表单
   （L185-536）目前围绕 `apiKey` 输入框 + `requiresKey` 逻辑（L231-232、L307）；
   OAuth 连接没有可粘贴的 key，需要新的表单分支。
8. i18n（§6）+ USER_GUIDE.md（§5）+ 上述各层测试。

**不需要动（如按上述最小方案）：**
- preload 白名单（组级放行）；
- `HarnessRunSnapshotSchema` / `HarnessCredentialRequestSchema`（snapshot 只带公开
  ModelConnection；grant 仍是一个 string）；
- `packages/harness-pi` 的 worker 侧（host.ts 只认一个 apiKey string）；
- `ModelSelection`/picker 投影（与凭据类型无关）；
- onboarding 结构（复用同一表单组件，自动继承）。

---

## 3. 运行时消费链：ModelConnection 如何进入一次运行

### 3.1 广播与 catalog 投影

1. main 侧轮询桥：
   `harness-credential-host.ts` (apps/electron/src/main/services/harness-credential-host.ts)
   `startHarnessCredentialHost(cliService)` L11-125，每 1s tick（L113-115）：
   - L22-25：读 `store.snapshot()` / `imageSnapshot()` / `mcpSnapshot()`；
   - L26-41：通过 `cliService.sendLocalMachineRpc({ method: 'harness/host', ... })`
     把公开 connections 推给本地 daemon（apps/cli）。
2. daemon 侧：
   `message-handler.ts` (apps/cli/src/lib/message-handler.ts) L6197-6206：
   `harnessCredentials.exchange(params)`（入 broker）→ `embeddedHarnessCatalog.publish(
   request.params.connections)`。
3. catalog 投影：
   `embedded-harness-catalog.ts` (apps/cli/src/agent/embedded-harness-catalog.ts)
   `projectEmbeddedHarnessCatalog` L19-80：
   - 对每个 enabled 连接：native preset 取**打包 catalog** 中同 preset 的模型并按
     `connection.models` 过滤（L30-40）；openai-compatible 取 `connection.customModels`
     （L31-35）；
   - 生成 `molly-model:` 编码的 `models[]` 与 ACP `configOptions`（model + reasoning_effort），
     `group` = connection.displayName（L47、L62-64）。
   `EmbeddedHarnessCatalogPublisher.publish` L94-137：读打包 catalog
   （`embedded-harness-runtime.ts` (apps/cli/src/agent/embedded-harness-runtime.ts)
   `readEmbeddedHarnessCatalog` L52-78，校验 sha256 于 L59-68），写入 Loro 的
   ACP capability cache（`updateAcpCapabilities` L117-132）。**这就是会话页 picker
   的数据源**——renderer 不直接读连接，而是读 daemon 投影的 capability cache。
4. renderer picker：`desktop-run-config-menu.tsx` (packages/components/src/components/sessions/desktop-run-config-menu.tsx)
   - `modelPickerOptions` L309-315（modelOptions 或 ACP model selector）；
   - Provider 子菜单 L378-388（从 `molly-model:` 值解码 connectionId 分组，
     >1 个 provider 才显示 Provider 行 L403）；
   - Model 子菜单 L516-543（搜索列表）、Reasoning L544-566。

### 3.2 派发与凭据授予

1. 会话创建：
   `session-manager.ts` (apps/cli/src/session/session-manager.ts) L1273-1287：
   builtin+molly 必须有 `modelSelection.connectionId` 命中 broker catalog 且 enabled，
   否则 `harness_connection_required`；冻结 connection 进 `embeddedHarness` config。
2. run config 校验：
   `session.ts` (apps/cli/src/commands/session.ts) L1191-1217
   `mergeTurnDispatchConfig` → `validateMollyRunConfigProjection`（shared L780-803）→
   L2410-2432 校验 capability cache 里确有该 model 且 thinking 支持。
3. Worker 配置：
   `worker-config.ts` (packages/harness-pi/src/worker-config.ts) L11-30
   `WorkerConfigSchema` 含冻结的 `connection`（ModelConnectionSchema）与 `selection`。
4. run 时快照：
   `embedded-harness-control.ts` (apps/cli/src/agent/embedded-harness-control.ts)
   L224-241 构造 `HarnessRunSnapshotSchema`；L259-273 通过
   `broker.acquire(snapshot, ...)` 拿到 apiKey 并经私有 pipe 写
   `WorkerCredentialGrant`。
5. broker：`harness-credential-broker.ts` (apps/cli/src/agent/harness-credential-broker.ts)
   `exchange` L234-323 收公开 catalog、校验 lease（runId/epoch/connectionId/revision
   全匹配 L303-311）后 resolve apiKey；catalog 变化使 lease 失效并 retire worker
   （L280-298）。
6. worker（harness-pi）：
   `host.ts` (packages/harness-pi/src/host.ts)
   - `createRuntime` L152-175 → `configureModelConnection`；
   - `execute` L388-395：读 grant，`runtime.setRuntimeApiKey(providerId, apiKey)`；
   - snapshot 一致性 L313-329（connection 序列化全等，否则 retire）。
7. provider 注册：
   `model-connection.ts` (packages/harness-pi/src/model-connection.ts) L13-67：
   - **molly-compatible provider 定义点**：L32-61，openai-compatible 时
     `runtime.registerProvider('molly-compatible', { baseUrl, api: 'openai-completions',
     authHeader: true, models: [...customModels 映射...] })`；
   - 非默认 endpoint 的原生 preset：L62-63 只覆写 baseUrl；
   - `runtime.getModel(providerId, modelId)` L64 从打包 SDK catalog 取模型；
     `connection.models` 白名单校验 L24-25，customModels 声明校验 L26-30。
   打包 catalog 由 `model-catalog.ts` (packages/harness-pi/src/model-catalog.ts) L14-36
   在构建时从 pi SDK 投影（`createBundledModelCatalog`），构建脚本
   `build-embedded-harness.mjs` (apps/cli/scripts/build-embedded-harness.mjs) L131-157。

**自动模型发现（OpenAI-compatible）的含义**：今天 openai-compatible 的模型集合 =
用户手工声明的 `customModels`（schema 强制 L630-636 与 worker L26-30 强制命中声明）。
自动发现若要落地，需要决定：发现结果写入 `customModels`（则上面链路零改动，只是
表单里多一个“从服务获取”按钮 + 一个新 IPC），还是引入“已发现模型”新状态（则
SaveModelConnectionSchema refine、worker 校验、UI 都要动）。

---

## 4. 连接检查链路

### 4.1 调用链

```
ModelConnectionForm (renderer)
  useConnectionCheck(checkRequest, onCheck)        connection-check.tsx L21-54 (700ms 防抖 L14)
  → ipc.modelConnections.check(input)              model-connection-setting.tsx L586-592
→ ModelConnectionsIpc.check                        model-connections-ipc.ts L139-144
  → checkModelConnection(store, input)             connection-check.ts L120-143
      stored 路径: store.credentialForCheck(id, revision)   model-connection-store.ts L438-446
      （连接被改/provider/baseUrl 不符 → 'changed'/'needs_key'，L128-135）
  → runConnectionCheck(PROVIDER_PRESET_CHECKS[preset], baseUrl, apiKey)
                                                   connection-check.ts L83-118
      CHECK_REQUESTS L16-33: anthropic→GET /v1/models?limit=1000,
      google→GET /models?pageSize=1000, openrouter→GET /key,
      openai（含 openai-compatible/xai/deepseek/moonshot/zai）→GET /models
      15s timeout、redirect:error、2MB 响应上限 L11/L94-95
  失败映射 L100-107: 401/403→key_rejected, 404/405/501→unsupported,
      429→rate_limited, 其它→http_error；网络错→unreachable；体非法→invalid_response
  成功: listedModels L63-77 提取 id 列表（openrouter 只验证 key 不带 models，L112）
```

### 4.2 结果渲染

- 表单内：`ConnectionCheckLine`（connection-check.tsx L79-137），文案
  `settings.check.ok` / `settings.check.okListed{,_one,_other}` /
  `settings.check.failures.<reason>`（L64-76）。
- 行徽标：`ConnectionCheckBadge`（L140-174），`settings.check.badge.<reason>`。
- 行级“Check connection”：model-connection-setting.tsx L598-608（`checkRow`），
  菜单项 L841-843；结果按 `{revision, state}` 存本地 state（L593-597、L653-656）。

### 4.3 `models`（listed IDs）的消费面

确认：**只有一个消费点**。
- model-connection-setting.tsx L255-258 把 `check.result.models` 变成 `listed: Set`，
  传入 `ModelChecklist`（L480-487）；
- model-checklist.tsx L142-144 给不在列表中的模型打 `settings.models.picker.notListed`
  灰标签（“Not on this account”），**纯提示、从不改变选择**（L31-34 注释 + 表单
  L270-278 注释明确不得用 listing 预选择）。
- 另外 image-connection-setting.tsx L181-222 用同一份 `models` 做“模型建议”（datalist），
  那是 image 表单内部，与模型连接无关。
- grep 全仓无其它 `result.models` 消费。

**自动发现可复用的现成机制**：`runConnectionCheck('openai', ...)` 已经返回任意
OpenAI 兼容服务的 `/models` 列表，renderer 已经能拿到它——只差“把列表写入
customModels”的 UI 与校验。

---

## 5. 测试与文档

### 5.1 测试文件

| 文件 | 覆盖 |
|---|---|
| `model-connection-store.test.mjs` (apps/electron/src/main/services/model-connection-store.test.mjs) | vault 全量：密文持久化、revision CAS、目的地变更需重签、check 请求构造与失败映射（L344、L400）、saved key 检查绑定（L433）、models 列表 round-trip（L480）、delete/disable 使 acquire 失效（L566）、keychain 不可用 fail-closed（L576）等 |
| `model-connection-setting.test.tsx` (packages/components/tests/model-connection-setting.test.tsx) | 表单/行/列表/检查/checklist 全部交互（describe 分布 L87/382/427/481/533/714） |
| `image-connection-setting.test.tsx` (packages/components/tests/image-connection-setting.test.tsx) | 图像连接（同 IPC 组、同 connection-check 组件） |
| `bundled-capabilities-setting.test.tsx` (packages/components/tests/bundled-capabilities-setting.test.tsx) | getBundledCapabilities 展示态 |
| `design-readiness.test.tsx` (packages/components/tests/design-readiness.test.tsx) | 就绪条派生逻辑 |
| `embedded-agent-settings.test.tsx` (packages/components/tests/embedded-agent-settings.test.tsx) | EmbeddedAgentSettings 组合 |
| `onboarding-flow.test.tsx` (packages/components/tests/onboarding-flow.test.tsx) | onboarding 步序（含 providers） |
| `model-connection-defaults.test.ts` (packages/harness-pi/tests/model-connection-defaults.test.ts) | `configureModelConnection` provider 注册/endpoint 覆写/models 白名单 |
| `embedded-harness-catalog.test.ts` (apps/cli/src/agent/embedded-harness-catalog.test.ts) | catalog 投影（molly-model 编码、group、models 过滤） |
| `harness-credential-broker.test.ts` (apps/cli/src/agent/harness-credential-broker.test.ts) / `embedded-harness-control.test.ts` (apps/cli/src/agent/embedded-harness-control.test.ts) | 凭据 lease 与 run 快照 |
| [embedded-agent-settings 相关 story] | packages/components/src/stories/{DesignReadiness,BundledCapabilities,AgentEngineCatalog,ConnectionCheck,DesktopRunConfigMenu,OnboardingFirstTaskScreen}.stories.tsx |

另：`e2e/fixtures/scripted-model-server.mjs` 是 e2e 的假模型服务。

### 5.2 文档/记录

- `components-package.md` (.agents/docs/components-package.md) L125-160：“First design
  session and image settings”一节记录 Agents 设置页结构、ModelConnectionSetting 独立挂载、
  BundledCapabilities 只读语义、onboarding 复用。
- `sessions-run-config.md` (.agents/docs/sessions-run-config.md) 全文：composer picker 的
  Provider/Model/Reasoning 语义、molly-model 编码、空 catalog 引导去 Settings。
- `cli-lib-provider-setup.md` (.agents/docs/cli-lib-provider-setup.md)：legacy 外部 CLI
  provider 安装/认证流程（与 ModelConnection 无关，OAuth 面板历史背景在此）。
- 笔记：`.agents/notes/implemented/bug-fix/2026-10-05-connection-form-clarity.md`（表单
  最近一轮 UX 修正）、`.agents/notes/proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md`。
- settings 域规则：`settings/AGENTS.md` (packages/components/src/components/settings/AGENTS.md)
  —— L46-63（导航顺序、连接表单规则、key 免费检查规则、models 列表只提示不预选）、
  L64-78（AI models tab 组合、onboarding 复用、不动 AgentConfigDialog）、
  L95-103（“Model credentials use the encrypted connection form; settings does not expose
  legacy Agent CLI authentication”——**新增 OAuth 需要在这一节补规则**）。
- specs 约束：
  - `graphic-design-platform.md` (specs/graphic-design-platform.md) L157：models 列表选择、
    key 免费检查、image 建议的意图（改语义需回到 draft）。
  - `molly-embedded-pi-harness.md` (specs/molly-embedded-pi-harness.md) L16、L26-27：
    “configure a model connection, an API key and an explicit model”——**“API key”是
    spec 级措辞，引入 OAuth 属于 intent 变更，需要 spec 评审**。
- 用户流程：`USER_GUIDE.md` (USER_GUIDE.md) L26-75（Settings → AI models → Models
  四步流程、Kimi Code、image connection、OpenAI-compatible 手工声明）与 L165-175
  （证据/限制矩阵）、L14-17（Keychain “Always Allow”对保存连接可读性的影响）。

---

## 6. i18n 键清单

文件：`locales/en.json` (locales/en.json) 与 `locales/zh_CN.json` (locales/zh_CN.json)
（两文件键集合一致；仅 `settings.models.summary.count_one` 在 zh_CN 缺少——i18next 复数
规则下中文不需要 `_one`，属正常）。以下给出全部 `settings.models.*` 与
`settings.check.*` 键 + 英文原文（en.json）。相关邻近键族 `settings.readiness.*`、
`settings.engine.*`、`settings.imageConnection.*`、`onboarding.models.*` 见附录。

### settings.models.*

| 键 | 英文 |
|---|---|
| settings.models.add | Add model connection |
| settings.models.addCustomModel | Add custom model |
| settings.models.apiKey | API key |
| settings.models.capabilitiesBuild | Build: {{build}} |
| settings.models.capabilitiesHint | Read-only: this list installs no add-ons, calls no model and does not scan for other Pi installs. It shows what ships, not what a running conversation has turned on. |
| settings.models.capabilitiesLimits | Terminal UI and the optional grill-me command are excluded. Slash-command mapping and native desktop acceptance remain incomplete; cancellation or timeout never supplies consent. |
| settings.models.capabilitiesLoading | Reading bundled capabilities… |
| settings.models.capabilitiesQuestionActivation | Included; enabled for a session only when the host negotiates the version-1 question interface. This inventory is not a live-session status. |
| settings.models.capabilitiesTitle | Engine details |
| settings.models.capabilitiesUnavailable | The bundled capability manifest could not be verified. Availability is unknown. |
| settings.models.changeProvider | Change |
| settings.models.chooseProvider | Choose a provider |
| settings.models.compatible | OpenAI-compatible (advanced) |
| settings.models.compatibleHint | OpenAI Chat Completions streaming only. Declare each model's actual capabilities and limits; Molly does not discover or verify them. Thinking levels use reasoning_effort (off maps to none). Tool execution requires tool-call support. No custom headers, endpoint scripts, automatic model selection or price estimates. |
| settings.models.compatibleLead | List each model on this service and what it can do. |
| settings.models.contextWindow | Context window (tokens) |
| settings.models.customModel | Model {{number}} |
| settings.models.customModelId | Exact model ID |
| settings.models.customModelName | Model display name |
| settings.models.customModelsInvalid | Complete the connection and model fields. Use unique model IDs, positive token limits (output ≤ context), and at least one thinking level. Up to 32 models per connection. |
| settings.models.delete | Delete |
| settings.models.deleteConfirm | Delete {{name}}? Conversations that use it will stop working. A copy of the key may stay in Molly's private engine data on this Mac. |
| settings.models.empty | Pick a provider to connect. Canvas editing and export work without a key. |
| settings.models.endpoint | API base URL |
| settings.models.endpointDefault | Sends requests to {{url}} |
| settings.models.engineHint | New conversations use the bundled Molly engine. No external Agent CLI is required. |
| settings.models.engineSelectionHint | Choose a configured connection and model in the conversation before sending. |
| settings.models.engineTitle | Built-in Molly |
| settings.models.error | The connection could not be read or saved. Check system credential storage; reopen settings after a concurrent edit. No plaintext fallback is used. |
| settings.models.imageInput | Accepts image input |
| settings.models.keyHelp | Create an API key in your service provider’s developer console, then paste it here. For a custom address, use a key issued by that service. |
| settings.models.keyRequired | Paste a key for this service address. |
| settings.models.keyStoredPlaceholder | Stored — leave empty to keep |
| settings.models.kimiCode | Kimi Code (membership API key) |
| settings.models.kimiCodeEndpointRequired | For Kimi Code on api.kimi.com, use https://api.kimi.com/coding/ without /v1. This preset uses the Anthropic-compatible protocol. |
| settings.models.kimiCodeHint | Uses the Anthropic-compatible API at https://api.kimi.com/coding/. Model IDs such as kimi-for-coding are selected separately; saving does not select a model or verify account access. |
| settings.models.kimiCodeProviderRequired | This is a Kimi Code endpoint. Edit this connection, choose Kimi Code, and re-enter your key locally. Moonshot Open Platform is a separate service. |
| settings.models.legacyHint | Preserved for history only. To continue an old design, open its session menu and choose “Continue this design with Molly”. Migrate Roles explicitly in Agent Roles. |
| settings.models.legacyReadOnly | Retired · read-only |
| settings.models.legacySetupRetired | Previous setup · no longer runnable |
| settings.models.legacyTitle | Previous Agent configurations |
| settings.models.loading | Loading local connections… |
| settings.models.maxOutputTokens | Maximum output tokens |
| settings.models.maxTokensField | Output limit request field |
| settings.models.moonshot | Moonshot Open Platform (API) |
| settings.models.moreActions | More actions for {{name}} |
| settings.models.moreOptions | More options |
| settings.models.moreProviders | More providers… |
| settings.models.name | Connection name |
| settings.models.nameHint | Shown in the conversation's model picker. |
| settings.models.notVerified | Connect the AI that creates your designs. Your key stays on this computer. |
| settings.models.notVerifiedDetail | Molly checks a key for free as soon as you paste it, using the provider's model list. Keys are encrypted on this computer, never shown, and never written to your design files. Saving does not call the model or change existing conversations; you pick the connection and model in each conversation. |
| settings.models.picker.all | All {{count}} |
| settings.models.picker.choose | Choose |
| settings.models.picker.chooseOne | Choose at least one model. |
| settings.models.picker.clearAll | Clear |
| settings.models.picker.clearShown | Clear shown |
| settings.models.picker.count | {{selected}} of {{total}} |
| settings.models.picker.empty | No models match. |
| settings.models.picker.hint | Choose which of this provider's models you can pick in a conversation. |
| settings.models.picker.notListed | Not on this account |
| settings.models.picker.search | Search models |
| settings.models.picker.seesImages | Sees images |
| settings.models.picker.selectAll | Select all |
| settings.models.picker.selectShown | Select shown |
| settings.models.picker.thinks | Thinks |
| settings.models.picker.title | Models in the conversation picker |
| settings.models.picker.unavailable | The model list couldn't be read, so the current choice is kept. |
| settings.models.provider | Provider |
| settings.models.providers.anthropic | Anthropic (Claude) |
| settings.models.providers.deepseek | DeepSeek |
| settings.models.providers.google | Google (Gemini) |
| settings.models.providers.minimax | MiniMax |
| settings.models.providers.openai | OpenAI |
| settings.models.providers.openrouter | OpenRouter |
| settings.models.providers.xai | xAI (Grok) |
| settings.models.providers.zai | Z.ai (GLM) |
| settings.models.removeCustomModel | Remove model {{number}} |
| settings.models.streamingUsage | Reports token usage in streaming responses |
| settings.models.summary.all | All models |
| settings.models.summary.count | {{count}} models |
| settings.models.summary.count_one | {{count}} model |
| settings.models.summary.count_other | {{count}} models |
| settings.models.thinkingLevels | Supported reasoning_effort levels |
| settings.models.title | Models |
| settings.models.toolCalls | Supports tool calls |
| settings.models.toolsRequiredHint | This model cannot run turns with tools, including design tools. Enable only if the service supports tool calls. |
| settings.models.unavailable | This surface cannot access the local encrypted credential service. |
| settings.models.useConnection | Use {{name}} |
| settings.models.useCustomEndpoint | Use a custom endpoint |
| settings.models.useDefaultEndpoint | Use the default endpoint |

### settings.check.*

| 键 | 英文 |
|---|---|
| settings.check.again | Check again |
| settings.check.badge.changed | Changed |
| settings.check.badge.http_error | Error |
| settings.check.badge.invalid_response | Unexpected reply |
| settings.check.badge.key_rejected | Key rejected |
| settings.check.badge.needs_key | Needs key |
| settings.check.badge.ok | Key check passed |
| settings.check.badge.rate_limited | Busy |
| settings.check.badge.unreachable | Unreachable |
| settings.check.badge.unsupported | Can't check |
| settings.check.checking | Checking… |
| settings.check.detail | Molly only asks the provider for its free model list. No design request is sent, so billing and access to a particular model aren't checked. |
| settings.check.failures.changed | This connection changed elsewhere. Reopen it to check again. |
| settings.check.failures.http_error | The provider answered with an error ({{status}}). |
| settings.check.failures.invalid_response | The provider answered, but not with a model list. |
| settings.check.failures.key_rejected | The provider rejected this key ({{status}}). |
| settings.check.failures.needs_key | Paste the key to check this address. |
| settings.check.failures.rate_limited | The provider is busy ({{status}}). Try again in a moment. |
| settings.check.failures.unreachable | Couldn't reach {{host}}. Check the address and your network. |
| settings.check.failures.unsupported | This service can't be checked for free. Molly uses the key when you send a message. |
| settings.check.ok | Key check passed |
| settings.check.okListed | Key check passed · {{count}} models listed |
| settings.check.okListed_one | Key check passed · {{count}} model listed |
| settings.check.okListed_other | Key check passed · {{count}} models listed |
| settings.check.run | Check connection |

### 附录：邻近键族（仅键名）

- `settings.readiness.*`：configured / keyMissing / label / moreConnections / needsFix /
  notConnected / notSignedIn / off / optional / signInNotVerified。
- `settings.engine.*`：addonsTitle、addons.{fileSearch,mentions,questions,safetyNet,skills}
  .{title,description}、description、pi.{title,description}、technicalDetails。
- `settings.imageConnection.*`：apiKey、apiKeyPlaceholderStored、baseUrl、baseUrlHint、
  baseUrlHintDashscope、delete、deleteConfirm、enabled、intro、invalidBaseUrl、invalidModel、
  legacyHistoryWarning、model、modelHint、modelListed、modelNotListed、moreActions、
  moreSuggestions、protocol、protocolDetail、protocolHint、protocols.{dashscope,openaiImages}、
  removeApiKey、saveFailed、saving、sectionConnection、sectionConnectionHint、setUp、
  statusNotReady、suggestions、testUnsupportedDashscope、unavailable。
- `onboarding.models.*`：description、retiredDescription、retiredTitle、selectionHint、
  title、unavailable。

---

## 7. 两个新需求的最小改动面汇总

### 7.1 OpenAI OAuth 登录（token set: access+refresh+expires）

**必须动（8 处）：**
1. `packages/shared/src/embedded-harness.ts` —— ModelConnection 公开元数据加 authType
   （或等价字段）；SaveModelConnection 允许无 apiKey 的 OAuth 连接；如检查要走 token，
   CheckModelConnection 也要扩。
2. `apps/electron/src/main/services/model-connection-store.ts` —— StoreSchema entry
   （L36-48）、save 的凭据规则（L392-402）、`credentialForCheck`/`acquireForRun`
   返回类型；刷新逻辑建议新文件（store 保持无网络）。
3. `apps/electron/src/main/ipc/services/model-connections-ipc.ts` —— 新增
   `beginOAuth` / `completeOAuth`（或轮询态查询）方法；现有 save/check 签名适配。
4. `apps/electron/src/main/services/connection-check.ts` —— check 对 OAuth 连接用
   access token（必要时先刷新）。
5. `apps/electron/src/main/services/harness-credential-host.ts` —— 授予前刷新并仍以
   单字符串 access token 进 `reports[].result.apiKey`（L83-107），可保 grant schema 不变。
6. `packages/components/src/components/settings/model-connection-setting.tsx` —— 表单
   apiKey 分支、`requiresKey` 逻辑（L231-232、L307、L363-367）、行 UI；deep link 回调
   渲染层接线（现有 `app.deepLink` 通道，preload/白名单零改动）。
7. i18n：en.json + zh_CN.json 新增 settings.models.oauth.* 等键。
8. 文档：`packages/components/src/components/settings/AGENTS.md`（L95-103 凭据规则）、
   `USER_GUIDE.md` L26-45、spec `molly-embedded-pi-harness.md` L16 的 “API key” 措辞
   （intent 变更 → spec 回 draft）。

**不需要动：** preload 白名单与 ipc-bridge（组级放行）、register-services 以外的 IPC
基建、HarnessRunSnapshot/HarnessCredentialRequest/WorkerCredentialGrant schema（若沿用
“授予时下发热乎 access token”方案）、packages/harness-pi 全部 worker 代码、picker 投影
与 DesktopRunConfigMenu、onboarding 步序（表单组件复用自动继承，但 onboarding 的
OAuth 入口交互需自测）。

### 7.2 OpenAI-compatible 自动模型发现

**必须动（4 处）：**
1. `packages/components/src/components/settings/model-connection-setting.tsx` +
   `compatible-model-fields.tsx` —— “从服务获取模型列表”入口；把
   `check.result.models`（已存在！）映射成 `CompatibleModelDraft` 列表让用户逐项确认/
   编辑能力声明。注意 CompatibleModelDefinition 要求 thinking/toolCalls/
   contextWindow/maxTokens 等**手工声明**字段，发现只能预填 modelId/name，能力仍须
   用户确认（spec: graphic-design-platform.md L157 “does not discover or verify”）。
2. i18n 新键（发现按钮、发现结果态、错误态）。
3. 测试：model-connection-setting.test.tsx + model-connection-store.test.mjs
   （若 save 路径有变化）。
4. 文档：settings/AGENTS.md L37-39（compatible 规则）、USER_GUIDE.md L71-75。

**不需要动（若发现结果仍写入 customModels）：** shared schema（customModels 语义不变）、
store、IPC（check 已返回 models）、worker 的 `configureModelConnection`（仍校验声明命中）、
catalog 投影（openai-compatible 走 customModels 分支 L31-35 不变）。
**若**引入“已发现但未声明”的中间态或把发现结果直接当可运行模型，则额外要动：
SaveModelConnectionSchema refine（shared L640-667）、worker 校验
（model-connection.ts L26-30）、catalog 投影与 spec 措辞。
