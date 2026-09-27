# 内置浏览器：现有产品经验与复用边界

Status: proposed
Date: 2026-09-23
Translation: pending

## 摘要

Molly 的目标是让 Agent 在内置网页中使用用户选择的登录态完成设计调研，不要求控制用户日常 Chrome。Claude Cowork 和 OpenAI 桌面浏览器的官方文档均支持“独立内置 profile、用户登录或导入、站点授权”的产品方向，但未公开采用官方 Playwright MCP 的证据。Lody 提供可复用的浏览器外壳，当前核验的源码明确没有 Agent 页面操作工具；VS Code 则公开了 Electron 页面隔离、CDP 消息适配与 Playwright 驱动的完整接入路径。建议优先复用后者的必要适配代码，并让成熟 Playwright/MCP 负责页面操作；稳定版 Playwright 已支持消息 transport，原方案“必须新增 WS 监听”的依据需要撤回。这是有源码依据的候选，尚未在 Molly 验证，也不表示存在可零适配安装的完整 SDK。

本记录补充[原浏览器方案](2026-09-22-embedded-browser-account-import.zh.md)，纠正“产品有内置浏览器，就等于用了 Playwright MCP”以及“需要登录态，就必须控制用户 Chrome”的推断。[当前 Spec](../../../../specs/graphic-design-platform.zh.md#内置网页调研与素材)仍定义产品范围；本轮不改运行时代码或 Spec 意图。

## 核验口径

- 核验日期为 2026-09-23；以下事实来自实际打开的一方文档，功能受产品版本和 rollout 影响。
- 区分产品体验、Agent 工具面、底层驱动及可复用代码；界面相似不建立技术栈相同。
- 已查阅本机提供的浏览工具使用文档以校准术语；依仓库公开证据边界，本记录只引公开来源，不录安装包内容、账号数据或会话记录。
- 未启动竞品、未读取 Cookie、未测试账号；本轮只读调研并记录结论。

## 已证实：Claude Cowork

**内置路线。** 官方明确浏览器位于桌面应用的任务侧栏，独立于用户浏览器。首次可逐站选择并导入 Cookie；macOS 支持 Chrome、Edge、Firefox，也可直接登录并跨 Cowork 会话保持。网站首次使用需要许可。该文档明确把内置浏览器与 Claude in Chrome 分开。[官方内置浏览器说明](https://support.claude.com/en/articles/16607400-use-the-built-in-browser-in-claude-cowork)

**外部路线。** Claude in Chrome 是控制用户 Chrome 已登录页面的扩展。其公开权限包括 `scripting`、`debugger`、`tabGroups`、`nativeMessaging` 等；这能证明扩展拥有页面读取、调试控制和本地产品通信能力，不能证明内置浏览器用了同一 transport 或 Playwright MCP。[官方 Chrome 说明与权限表](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)

**宿主职责。** 官方架构说明把云端 Agent 与本机资源分离：本机文件/浏览器请求经桌面应用抵达设备，并由应用检查本地调用权限。Molly 可借鉴宿主持有本地能力的分工；它的公开桌面是 local-only，不采用 Anthropic 的云端执行架构。[官方 Cowork 架构](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)

**未知。** 上述公开来源未给出内置浏览器的 Electron 类、Cookie 解密库、页面定位实现、Playwright MCP 依赖或可复用浏览宿主 SDK。因此不把 `rookie-cookies`、`WebContentsView`、CDP 代理等具体技术归因给 Claude。

## 已证实：Codex / OpenAI 桌面浏览器

**内置路线。** 当前官方浏览器文档位于 ChatGPT Learn，并明确 Codex 可操作桌面内置浏览器。内置 profile 与日常浏览器分离，支持直接登录，设置页管理设备上可用的 profile 导入功能；站点许可与敏感操作确认分开。开发者模式提供另行授权的受控 CDP 访问。这里没有承诺所有设备具备同样的导入能力。[官方 Browser 文档](https://learn.chatgpt.com/docs/browser?surface=app)

**外部路线。** 官方另列浏览器扩展，可在 Chrome、Edge 等浏览器的现有登录页面工作；安装权限包括调试页面、与本机应用通信，产品还叠加自身的站点确认。它与 `@Browser` 内置 profile 是不同入口。[官方 Browser extension 文档](https://learn.chatgpt.com/docs/chrome-extension)

**未知。** 上述来源未声明官方 Playwright MCP 是内置浏览器驱动，也未公开可供 Molly 直接链接的完整实现。CDP 开发者模式的存在，只能证明提供了受控调试能力，不能反推普通浏览动作全部采用 CDP、Playwright 或同一目标代理。

## 已证实：Lody 的复用范围

核验上游 `44ccd7ae7a16af96fe1eaa7f6914443aa8bd7dde`。其 public browser 是 Electron `WebContentsView`，由现有 IPC 提供界面操作；源码及维护文档明确没有脚本注入、页面抓取或 Agent 工具。2026-07-31 的官方变更记录也说明当时不支持 Agent 控制 Browser；当前源码核验补充了这一历史公告，不能只凭旧公告断言所有后续版本。[上游服务](https://github.com/LodyAI/Lody/blob/44ccd7ae7a16af96fe1eaa7f6914443aa8bd7dde/apps/electron/src/main/services/public-browser-service.ts#L55)、[上游浏览器说明](https://github.com/LodyAI/Lody/blob/44ccd7ae7a16af96fe1eaa7f6914443aa8bd7dde/.agents/docs/sessions-browser.md)、[官方变更记录](https://lody.ai/changelog/)

因此 Molly 应继续复用 Lody 的侧栏、页面生命周期、导航和 IPC；不能把这部分复用报告成“已经复用了成熟 Agent 浏览驱动”。上游 Preview 的人工批注、开发服务器预览也不等于登录网站的自动操作能力。

## 已证实：VS Code 提供最接近的开源接入参考

VS Code 官方内置浏览工具支持页面读取、交互、截图和 Playwright 操作；人工打开的页需要分享给 Agent，撤销后停止访问。它的工具直接内置，不要求外部 MCP server。这证明成熟驱动的复用与是否采用 MCP 协议是两个决定。[官方浏览工具](https://code.visualstudio.com/docs/agents/run/browser-tools)

核验源码 `3fecd4f931666fecd1fbd7c214ce544409ead6e8`，关键链路为：

`获准的 Electron 页面 → debugger/后代 target → BrowserViewGroup/CDPBrowserProxy → 消息 transport → playwright-core → Agent 工具`

- [BrowserViewDebugger](https://github.com/microsoft/vscode/blob/3fecd4f931666fecd1fbd7c214ce544409ead6e8/src/vs/platform/browserView/electron-main/browserViewDebugger.ts#L157)：调用 Electron debugger，明确过滤其他页面及 VS Code 内部 target；因此“Target 可能列出应用 renderer”是已有解决方式的适配问题。
- [BrowserViewGroup](https://github.com/microsoft/vscode/blob/3fecd4f931666fecd1fbd7c214ce544409ead6e8/src/vs/platform/browserView/electron-main/browserViewGroup.ts#L157)：校验 Agent 页面访问后注册页面及其子目标。
- [CDPBrowserProxy](https://github.com/microsoft/vscode/blob/3fecd4f931666fecd1fbd7c214ce544409ead6e8/src/vs/platform/browserView/common/cdp/proxy.ts)：提供 Browser/Target 路由语义，是可阅读、固定来源并适配的实现，不必重新设计同类状态机。
- [PlaywrightService](https://github.com/microsoft/vscode/blob/3fecd4f931666fecd1fbd7c214ce544409ead6e8/src/vs/platform/browserView/node/playwrightService.ts#L114)：传入 `ConnectOverCDPTransport` 对象，消息经 group 收发；这条路径不要求新开 loopback WS 端口。
- 源码采用 [MIT 许可](https://github.com/microsoft/vscode/blob/3fecd4f931666fecd1fbd7c214ce544409ead6e8/LICENSE.txt)。源码移植仍要保留来源/许可并适配其事件、生命周期与依赖；它不是一个可直接装入 Molly 的独立浏览器 SDK。

**对旧判断的实质更正：** 官方 Playwright **v1.61.1** 的公开类型已包含 `connectOverCDP(transport: ConnectOverCDPTransport, ...)` 及 `send/onmessage/close` 接口，不是只能使用 HTTP/WS URL。VS Code 当前仍锁定一个 alpha 版本，但不能据此断言 transport 能力只存在于 alpha；本次直接核验了稳定 tag 的公开类型。旧方案以“稳定 API 必须 WS”为由增加的监听成本不应继续计入必需成本。[稳定版类型](https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright-core/types/types.d.ts#L15392)、[transport 合同](https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright-core/types/types.d.ts#L16204)

官方 Playwright MCP 的 `createConnection(config, contextGetter)` 又允许接收现有 Playwright `BrowserContext`。因此候选可以组合为“复用 VS Code 必要适配 → Playwright → 官方 MCP → 既有 Pi MCP bridge”，无须因不能直接把 WebContentsView 传入 MCP 就重写 DOM 操作层。[MCP 公开接口](https://github.com/microsoft/playwright-mcp/blob/f1257a5a67aff872f947fae274759f7d54853862/index.d.ts)

这仍有明确未验证项：Molly 的 Electron 版本、固定 Playwright/MCP 版本组合、页面授权撤销与子目标生命周期、上游工具过滤。消息 transport 不会自动补齐 Browser/Target 语义，也不消除适配维护责任；本轮源码证据不构成 Molly 运行成功的证明。

## 推论：Molly 应复用什么

1. **产品方向可保留。** 内置浏览器拥有独立 profile，用户主动导入某站点登录或在内置页登录；Agent 仍只操作 Molly 页面。这已有直接产品先例，没必要仅为登录复用改成外部 Chrome 控制。
2. **登录和自动化是两条职责。** 宿主处理 profile、导入、持久化与用户接管；驱动处理页面观察和操作。改用成熟浏览驱动不会自动解决系统钥匙串、签名或网站迁移兼容性。
3. **工具面与通信协议分开。** 使用 MCP 不等于复用了成熟的定位、等待或快照实现。Molly 应沿用现有 Pi/MCP 接入，再优先评估可复用的浏览驱动及其宿主适配，而不是继续扩大自有 DOM 操作层。
4. **不复制整套竞品。** 两家产品同时提供内置和外部浏览器，不构成 Molly 也要交付两条路线的需求。当前目标只需内置浏览器搜索并保存选中的素材。
5. **复用决策需要源码级证据。** 竞品官方文档决定体验参考，开源实现决定哪些代码可以合法直接复用；未找到的私有实现记为未知，不以猜测填补。
6. **优先复用已有适配，再用成熟驱动。** 下一步只评估 VS Code 适配中所需部分与官方 Playwright MCP 的连接，不再先扩展自有快照、引用和等待。若 MCP 工具面适配确实比 VS Code/Playwright Core 的已有处理器更重，再按具体差量取舍；两条路线都应保留成熟定位/等待能力。

## 备选与取舍

| 路线 | 可复用部分 | 当前结论 |
| --- | --- | --- |
| 内置浏览器 + VS Code 必要适配 + 官方 Playwright MCP | 现有侧栏、profile、Pi/MCP；上游目标适配和浏览工具 | 优先候选；需适配源码依赖、工具范围和版本组合，尚未运行验证 |
| VS Code 必要适配 + Playwright Core/已有工具处理器 | 同样复用成熟驱动，工具面随产品适配 | 备选；只有官方 MCP 包装更重的具体证据出现时再比较，不先写另一套定位/等待 |
| 外部 Chrome 扩展 | 直接使用现有登录页，无需 Cookie 导入 | 成熟产品也提供，但改变 Agent 只能操作内置浏览器的要求，本轮不采用 |
| 延续自有页面驱动 | 保留已实现的 Electron 调用 | 不能因已写完而自动优先；需与成熟驱动的长期维护责任比较 |
| 直接复用 Claude/Codex 完整浏览实现 | 产品体验可参考 | 已核验文档未提供可直接嵌入 Molly 的实现，不能作为可交付依赖 |

## 验证限度

本轮只确认产品路线与公开边界，不声称 Pinterest 或 Amazon 在任意账号/系统上必然可用，也未证明 Playwright MCP 已能直接连接 Molly 的 `WebContentsView`。下一项技术决策只需回答“哪个公开实现能以最少 Molly 自有机制驱动现有页面”，不展开更多站点和真实模型测试矩阵。

## 补充：驱动收益与清理范围的证据边界

- Playwright 的自动等待针对具体操作的可见、稳定、可交互等条件，动态页面没有统一的“全部加载完”时刻。不能把 Molly 自有响应 peer 校验、URL 文档身份匹配、模型截图字节限额全部归为换驱动即可消失的问题；成熟驱动可以减少页面自动化责任，产品边界仍要适配。[自动等待](https://playwright.dev/docs/actionability)、[导航与动态加载](https://playwright.dev/docs/navigations#when-is-the-page-loaded)
- “有复用评估记录”“每个模块有调用者”“测试证据真实”分别证明过程、连接关系和执行事实，不证明路线成本最小或每轮验收都有必要。按已扩大的计划完成，也不能单独证明与最初核心目标没有偏离。
- 不直接删除 [Electron host](../../../../apps/electron/src/main/services/public-browser-agent-host-service.ts) 的 `busyPages`：daemon 的 [BrowserHost](../../../../apps/cli/src/browser/browser-host.ts) 在超时/取消后移除 entry，而 Electron 旧异步操作不保证已完成；新 run 可以重新入队，同页本地繁忙检查仍可能触发。`inFlight` 是否冗余应单独证明，不能与 `busyPages` 一概判为死代码。
- [message-handler](../../../../apps/cli/src/lib/message-handler.ts) 的 `browserTakeovers` 在 resume 与后续 run 进入时有删除；`browserScopes` 没有对应结束清理。应准确区分缺少会话销毁清理与“两张 Map 都只写不删”，不据此启动一揽子重构。
- Cookie 上下文丢失已在[所属方案](2026-09-22-embedded-browser-account-import.zh.md)步骤 A 修复为整次拒绝无法保真的导入。队列共用抽象、完整错误合同重构和 controller 全面补测均不作为驱动取舍的前置条件；最终保留的素材网络边界需要针对风险的有限验证。

## 后续最小接入证据（2026-09-23）

后续步骤 C 已按用户指令把该组合接入产品，删除自有快照、引用表与坐标交互。当前实现和分层验证见[步骤 C 执行记录](2026-09-22-embedded-browser-account-import.zh.md#步骤-c-执行记录2026-09-23)。随后[步骤 D](2026-09-22-embedded-browser-account-import.zh.md#步骤-d-执行记录2026-09-23)已通过一轮真实模型匿名 Pinterest 搜索、截图和素材保存；详情访问仍受登录弹窗限制。下段保留步骤 B 的证据范围。

[所属方案步骤 B](2026-09-22-embedded-browser-account-import.zh.md#b做一次成熟驱动最小接入验证)现已在隔离 Electron 样例中通过：原样编译固定 VS Code adapter、消息 transport 连接同一个 WebContentsView、官方 MCP 实际输入/点击/截图、其图片 ref 交给已有受控字节抓取，以及未授权 target 拒绝与撤销后不能再读取。该结果使“VS Code 必要适配＋官方 MCP”成为已验证的接入候选；不把它当作产品 Pi/权限/网络接线、真实账号或 Pinterest 验收。MCP 0.0.82 实际锁定 Playwright 1.64 alpha，且会产生宿主临时输出文件；确切组合、许可、依赖清单、删除范围与剩余适配均记录在步骤 B。
