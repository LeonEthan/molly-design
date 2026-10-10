# 内置浏览器的 agent-browser 与 WebMCP 接入

Status: draft
Translation: pending

## 使用场景

用户让 Agent 在 Molly 可见的内置页面中调研信息、阅读网页和操作表单。网站提供 WebMCP 工具时，Agent 可以发现其用途、读取参数并调用；未提供工具时，Agent 使用页面快照、元素引用和普通交互完成任务。人工接管和登录仍在同一个页面进行。

采用 agent-browser + WebMCP 的技术方向已确定。本文描述待实现目标；代码已替换 Playwright 驱动；选型与实施指令不代表本文全部细节已获批准或运行兼容性已经验证。实施拆分见[实现方案](../.agents/notes/implemented/architecture/2026-10-10-agent-browser-webmcp-implementation.zh.md)。

## 职责与范围

Electron 持有页面、网站 profile、用户网络配置和人工交互。agent-browser 承担快照、元素引用、定位与操作，以及 WebMCP 发现和调用。Molly 持有任务权限、页面租约、取消、结果归属和设计素材发布；现有产品 Agent 自主选择工具和后续步骤。

本次将浏览器能力从特定站点工作流扩展为通用单页操作。首版保持一个 Session 的一个获准页面及其 frame，浏览能力仍由现有本地活动运行入口提供。增加常用表单、键盘、阅读、条件等待和 frame 操作，不引入新 Agent 循环。跨页面管理、外部浏览器接管、文件上传下载管理和任意页面代码执行不随驱动替换一并开放；它们需要独立的范围与权限设计。

账号登录、导入、代理/TUN、现有浏览侧栏与隐藏页面承载继续复用当前实现。浏览器仍采用 Electron Chromium；升级 Electron 运行时以支持原生 WebMCP，不额外分发 Chrome。

## 工具与页面身份

Agent 继续使用内置 `molly_browser` 命名空间。页面工具不成为永久的 workspace MCP 配置，也不把站点提供的描述写入系统指令。宿主提供固定的发现、调用、结果读取和取消入口；工具名称、输入 schema 和结果均保留网站来源，并作为不可信内容处理。

普通动作回复仅附加新发现或变化的工具摘要；完整 schema 按需读取。没有工具的页面可正常浏览；运行时不支持 WebMCP 与页面没有注册工具是不同状态。目录变化、导航、frame 销毁、租约撤销后，相关旧工具和元素引用不可继续使用。

所有动作绑定当前 Session、活动 run 和页面租约；调用者不能用参数选择其他浏览器、CDP 地址、配置文件或宿主输出目录。元素引用和 WebMCP 调用身份只在所属页面生命周期内有效。通用浏览能力不开放 Cookie 导出或其他 Session 的实时观察。

## 执行、取消与人工接管

浏览动作复用现有工具权限流程。站点的只读标记或授权声明不能代替用户意图；发布、购买、发送和账户修改仍需要对应任务授权。WebMCP 调用默认视为可能产生副作用。

完成、取消、页面关闭、人工接管和宿主失联会撤销该租约的新命令及结果发布。撤销先切断控制，再清理驱动进程；仅终止一次 CLI 调用不构成撤销。已经在页面中运行的 JavaScript 或已经发出的请求可能继续产生效果，不能承诺取消会回滚网站变化。

长 WebMCP 调用以任务内的调用句柄返回，结果读取保持有界。调用中的浏览页面仍归该 run，人工可以接管。结果未知时先观察或读取结果，不能自动切换为点击来重复提交。恢复重新建立租约并观察当前页面，不重放旧调用。

登录、密码和 MFA 由人工处理；进入登录或接管状态后，Agent 停止读取和操作。现有画布只读、编辑 flush 和产物处理语义不随浏览驱动迁移改变。

## 资源与交付

选定图片继续由 Electron 的同一网站 session 获取，沿现有有界读取、图片解码和设计资产发布路径处理。图片必须对应当前主文档内真实加载的 IMG；不得把 `src` 字符串当作 `currentSrc` 或加载成功证据。普通页面下载和设计素材发布保持独立。

正式分发继续以 macOS arm64 为范围，随包携带固定版本的 agent-browser 原生程序。运行时不自行下载第二个浏览器，也不自动升级驱动。移除桌面生产闭包中的 Playwright 后，Electron Framework、网站 profile 和账号导入依赖仍有消费者。

此方案以通用浏览能力和上游复用为目的。DMG 大幅缩小、内存下降、任务成功率和 token 节省均不作为已验证收益。

## 证据与尚未验证的部分

- 当前合同与实现：[设计平台浏览器章节](graphic-design-platform.zh.md#内置网页调研与素材)、[浏览器实现说明](../.agents/docs/sessions-browser.md)、[现有控制器](../apps/electron/src/main/services/public-browser-agent-controller.ts)。
- 固定上游：agent-browser 0.39.0，commit `44af39842650f0bb9c1afb7354df9a82921d4f09`；[源码与 WebMCP 说明](https://github.com/vercel-labs/agent-browser/blob/44af39842650f0bb9c1afb7354df9a82921d4f09/docs/content/docs/webmcp.mdx)。
- 运行时基线：[Electron 44.7.0 / Chromium 152.0.7977.130](https://releases.electronjs.org/release/v44.7.0)；该 Chromium 的 [WebMCP 协议](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/public/devtools_protocol/domains/WebMCP.pdl)包含所需命令和事件。这是源码依据，不是 Electron 集成通过的结论。
- 当前代码固定 Electron 44.7.0，接入原生驱动与资源构建。按用户要求未执行测试、浏览器探针或生成安装包。原生加载、frame 行为、人工接管、签名分发和真实网站覆盖率均未新增运行证据。
