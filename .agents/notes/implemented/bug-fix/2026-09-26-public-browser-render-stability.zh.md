# 保持原生浏览器与网址输入稳定

Status: implemented
Translation: current

[English](2026-09-26-public-browser-render-stability.md)

## 摘要

打开已有网页时，原生浏览器持续闪屏，输入中的网址被覆盖，阻断了登录保持测试。
修复让组件跨渲染保留同一个 IPC 包装对象，并仅在实际页面 URL 改变时更新地址栏。
确定性回归测试先复现两项错误，修复后通过。本次修复组件生命周期与输入状态，
不改变浏览器权限、Cookie 存储或导航归属。

## 原因与决策

`getPublicBrowserBridge()` 每次调用都会新建包装对象。组件把这个对象作为 effect
依赖，状态更新因此触发布局清理、隐藏原生视图并重新挂接；创建和尺寸响应又更新
React 状态，形成循环。控制器还将每条浏览器通知的 URL 写入输入框，即使仅标题或
加载状态变化，也会抹掉用户草稿。

通过组件状态保留桥接对象，并在控制器记录最近的公网 URL。显式导航仍更新输入框，
真实重定向和历史导航也正常更新。隐藏面板和阻挡对话框继续沿用原有可见性处理。
全局 IPC 单例会扩大范围，主进程节流会掩盖渲染器错误，因此均不采用。

## 证据与限制

修复前的真实签名包中，输入新地址后立即被旧 URL 覆盖。原生 surface 测试使用真实
IPC 包装对象与可控尺寸响应检测非预期隐藏，不依赖计时器或网络；控制器测试验证同页
通知保留草稿、URL 改变正常更新。两项测试修复前失败，修复后十一项浏览器测试全部通过。

失败时，可见性测试报告 `expected [ true, false, true, false ] to not include false`；
地址栏测试期望 `https://example.com/new-draft`，实际为 `https://example.com/docs`。
修复后输出 `Test Files 2 passed (2)`、`Tests 11 passed (11)`。

`pnpm format`、`pnpm check` 和 `pnpm run docs check` 均通过，完整检查包含类型、组件、
Electron 测试和公共边界。按 **repro-before-fix**，修改运行时代码前先确认测试失败；
用户随后授权本地 Git 收尾，见关联工作流记录。按 **prove-on-the-real-surface**，已正常退出旧应用并打开更新后的 Apple Development 签名测试包。
`pnpm build`、打包冒烟检查及 `codesign --verify --deep --strict` 均通过。真实 UI 验证了
键盘输入及连续编辑、Esc 恢复地址、Pinterest 导航、画布与浏览器切换后保留页面。
重启后页面显示已登录账号和搜索结果，无需重新导入或登录；这些交互期间未再观察到
反复白屏。进程快照显示主进程 CPU 约 1.4%、应用 Renderer 约 0%，不再是此前报告的
持续超过 100%；该结果是快照，不是性能基准。用户列出的四个旧 PID 在正常退出后均已
不存在，无需强制终止。签名测试包保持打开，未验证公证分发或再次付费 Agent 运行。不收录 Cookie 值、私有截图或对话转录。相关验收背景见
[分层设计工作流](../../implemented/feature/2026-09-24-generative-layered-design-workflow.zh.md)。
