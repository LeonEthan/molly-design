# 复用原生浏览器传输并移除目的地限制

Status: implemented
Translation: current

[English](2026-10-03-native-browser-transport.md)

## 摘要

用户的 TUN 代理返回 fake-IP DNS 结果或连接地址时，Molly 的 Agent 浏览器会拒绝正常网站，而原生浏览仍能使用。本次已实现的简化删除 Molly 的目的地与传输验证、站点范围、WebRTC 禁用、普通下载拒绝，以及浏览动作结果未知后冻结整个运行的机制。导航和选图获取复用现有 Chromium session 与用户网络，不增加 DNS 设置、地址例外或另一层代理。完整仓库检查、本地 OSS 构建与隔离原生探针已通过，包括 TUN 不变时成功浏览及保留的归属控制。改变保证的 Spec 保持 draft，浏览器不再承诺私网隔离。

## 决定与范围

删除浏览器清单中八项网络限制：

- 除原生 URL 解析外的协议、内嵌凭据和目的地类别过滤。
- Agent 导航仅限公网、代理必须为 `DIRECT`、Node DNS 预检与响应连接 IP 必须公网的验证。
- 强制禁用缓存、绕过 Service Worker，以及以网络证明建立文档可读状态的机制。原生加载／可操作性和有限超时保留。
- 独立 Node 图片下载器的公网地址固定。选定图片改用绑定所属 Chromium session 的 Electron 原生请求传输。

同时删除按站点范围、显式关闭 WebRTC、普通页面下载全拒，以及未知结果后冻结当前整个运行。浏览工具保留现有工具权限流程。单次操作仍拒绝迟到或已取消的输出，不自动重放未知结果动作；重新观察后可以继续同一任务。

手工地址输入保留现有仅 loopback 进入 Managed Preview 的路由。Agent 导航始终使用自己的原生页面，包括 loopback 地址，不切换引擎。Managed Preview 本身仍只接受 Agent 机器上的 loopback 目标，其页面发起的导航不能静默转向用户 LAN。

## 复用与职责

现有 `WebContentsView`、官方 Playwright MCP 驱动及固定版本 VS Code CDP 适配器已经提供页面和 Agent 操作生命周期，继续作为优先复用方案。选图字节首先检查更高层的 Electron `Session.fetch`；在固定 Electron 39.5.1 中，`redirect: 'manual'` 遇到 302 会报 `Redirect was cancelled`，而不返回重定向响应，因此无法提供保留的逐跳 Cookie 决策和五次重定向限额。下一层复用绑定现有 browser session 的 Electron `net.request`：通过原生重定向事件适配这些保留的限额，DNS、代理、TLS 与 socket 仍由 Chromium 处理。增加 DNS 解析器、指定代理集成、转发网关或另一浏览器后端会建立第二套网络策略，不符合已选择的产品合同。

浏览器服务拥有页面身份、人机互斥和生命周期。仅所有者可访问的控制 socket 将请求绑定到活跃运行、启动实例和页面；过期请求与迟到结果继续拒绝。设计服务继续拥有素材发布与 PNG/JPEG/GIF 完整解码。普通浏览器下载不发布作品素材。

lease 注册和撤销监听现在先于初始空白文档的等待。旧顺序在加载期间撤销时找不到尚未注册的 lease，初始化仍可能继续接入适配器。初始化在接入前重新检查同一 lease，失败清理只移除自身，保留后来替换的 lease。确定性回归在旧顺序下失败，修复后确认撤销的初始化被拒绝且替换 lease 仍有效。

现有图片 Cookie 策略保留去除 `www.` 后的初始站点上下文，原生主文档仍在该站点或其子域时不变；真正跨站的文档才重置上下文。图片的每个请求跳转仅在 HTTPS 且处于该上下文时携带 Cookie，具体 Cookie 由 Chromium 选择，其他目标使用 `omit`。仅带 origin 的 Referer 和已有 Cookie 大小限额保留。这个上下文决定凭据携带，不限制导航或网络可达性；保留它可避免页面进入子域后缩窄兄弟素材主机的兼容范围。

保留的边界包括原生沙箱与网页安全、拒绝网页权限请求、禁止密码框输入、现有弹窗策略、快照／截图／队列／超时限额、Cookie 值只留在 main、账号导入完整性，以及有限 MCP 动作联合。Agent 仍不能使用任意 JavaScript、原始 CDP、外部 Chrome 控制或下载管理 API。

## 证据与备选方案

变更前，[所检查版本的目的地策略](https://github.com/LeonEthan/molly-design/blob/1809a324b9448c9c3a6d36bff4a18bfc155c633c/apps/electron/src/main/services/public-browser-agent-policy.ts) 要求 Node DNS 结果全部公网、Chromium 代理解析为 `DIRECT`，以及响应连接 IP 公网。隔离的原生探针在同一网络中复现了人工 HTTPS 通过 fake-IP 成功加载，而 Agent 随后在预检中拒绝。该探针没有读取用户 profile 或账号。

只删除代理检查仍会被 TUN fake-IP 的 DNS 与响应连接 IP 检查拒绝。公网 DNS 覆盖可以使部分环境恢复，但引入额外解析器选择，不满足透明使用用户网络的方向。允许特定 fake-IP 地址段或代理厂商会形成环境专用例外。复用 Chromium 传输直接删除冲突机制，不维护兼容性例外。

最终范围删除协议／下载限制，并允许 Agent loopback 导航。代码检查也更正了早先“已实现逐站审批弹窗”的假设：导航直接替换当前范围，Spec 要求的扩大站点授权没有实现。此前[响应地址规范化](../../implemented/bug-fix/2026-09-28-browser-response-ipv6-normalization.md)和[原生响应停止崩溃](../../implemented/bug-fix/2026-09-28-browser-response-navigation-crash.md)证据保留为历史；其验证层已经退役，不将旧证据改写为当前行为。

所要求的只读 Codex CLI 第二意见使用 `gpt-6-astra` 和 high reasoning。其发现推动补齐就绪等待后的最终 lease 复查、同时删除 service／controller 对 Agent loopback 的限制，以及保留页面进入子域后的图片 Cookie 上下文。其更高层 `Session.fetch` 建议由上述固定版本原生重定向失败证据替代；传输选择以已执行证据为准。

## 保证与限制

Molly 不再保证 Agent 可读页面与图片不能访问本机或私网服务。可达性由 Chromium 原生平台行为和用户网络决定；原生 TLS、同源规则与沙箱不等同于删除的公网目的地证明。浏览工具授权仍不同于导入账号、发布、购买或改变账户状态的授权。

本次不扩大图片格式、不隔离每个任务的 Cookie、不自动重试登录，也不增加代理配置或 DNS 设置。现有账号导入仍仅支持 Pinterest 与签名 macOS 包。原生下载与设计素材路径保持独立，可下载不证明任意下载文件都会自动导入。

## 验证

确定性回归已通过：共享浏览 URL 29 项、Electron controller 七项与保留的策略辅助函数两项、图片获取 17 项（含超时）、CLI host／MCP 57 项。保留的策略文件只提供文档身份规范化与图片 Cookie 主机匹配，不再验证目的地。

`node apps/electron/scripts/browser-navigation-probe.mjs` 经生产页面服务通过 11 项原生检查：localhost 导航与观察、MCP 输入／点击、禁止密码输入、WebRTC、选定 IMG 字节、有界 JPEG 截图、页面链接跨站、file／data 导航、接管后恢复同一页面、关闭页面后同一运行拒绝重建，以及普通原生下载。`node apps/electron/scripts/browser-asset-transport-probe.mjs` 使用隔离 profile，通过 19 项合成原生传输检查。两种探针均未使用用户账号或模型。

`browser-mcp-probe.mjs` 的生产模式通过六项兼容检查，包括选图字节、视口 JPEG、输入门控、撤销及真实页面观察。TUN 保持开启，系统 Node DNS 仍返回 fake-IP，说明成功路径未依赖更改 DNS 或代理设置。这个真实网络兼容检查与确定性无网络回归分别记录。

首次公网页面断言因外部标题变化而失败，最终改为验证实际 URL 与页面语义内容。初始原生 fixture 启动还暴露了 bundle 缺少运行时别名和下载 fixture 初始化问题；这些探针问题在最终成功前已修正。`Session.fetch` manual 重定向失败继续作为选择 `net.request` 的依据，不改写为 fetch 检查通过。本记录不包含采集的网页原文、账号状态或用户会话。

`pnpm format`、重启的完整 `pnpm check`（含公开边界检查）与 `pnpm build` 已通过。构建重新编译并同步 CLI、验证 Bento 资源，完成本地 OSS Electron main、preload 和 renderer。首次完整检查停在三项图片获取／fixture lint 问题，修正后重跑成功。工作区套件保留六项原有跳过测试，Loro 与 CLI 各三项。初始化生命周期修复后，导航探针再次通过全部 11 项。[Spec](../../../../specs/graphic-design-platform.zh.md) 与[浏览器说明](../../../docs/sessions-browser.md)反映选定合同；Spec 两种语言均保持 draft。本轮未重复签名分发或真实模型 Pinterest 验收，这些检查不证明账号迁移或任意网站可用性。
