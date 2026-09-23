# Pinterest 内置浏览器首期收尾

Status: implemented
Date: 2026-09-23
Translation: pending

## 摘要

用户明确要求“处理授权超时体验并完成代码收尾，把 Pinterest 作为首期交付”。本次保留已接入的官方 Playwright MCP、VS Code 页面适配、Pi 与现有素材路径，只修复首次钥匙串授权等待并收窄账号导入范围。Pinterest 的本机开发签名真实账号证据沿用已完成验收，Amazon 移出首期；无需重复模型搜图或新增浏览驱动。代码交付与公开分发分开，Developer ID、公证及升级不由本地 Apple Development 验收证明。

## 范围和决策

- 首期：设置中选择 Chrome profile → 导入 Pinterest → 内置 Agent 搜索/观察/详情/保存支持的图片；同包重启保留登录态、清理及控制权归还。共享 IPC 站点合同只接受 `pinterest.com`，主进程站点列表由该合同派生，设置不再提供 Amazon 导入。
- Amazon 搜索/PDP/问答及账号迁移转为后续范围，不限制通用内置浏览器访问获准的公共网站，也不宣称这些站点已验收。WebP/AVIF、CHIPS 迁移、多来源浏览器和其他系统账号导入保持原有限制。
- [原方案及 A–E 记录](../../proposed/architecture/2026-09-22-embedded-browser-account-import.zh.md)保留历史取舍和失败证据；其中更宽的首期门槛由本次明确指令收窄。设计 Spec 中英文已同步范围，仍为 draft；本次授权不等于整份 Spec 或公开发布获批。

## 授权等待修复

真实记录 `browser-signed-pinterest-20260923-03` 表明，`rookie-cookies` 的报告读取把人工处理 Chrome Safe Storage 系统弹框计入原来的 60 秒期限。此前首次启动的 60 秒失败是验收 harness 的启动时限，两者不是同一个问题；本次未修改启动、安全存储或签名门禁。

原生报告读取的期限改为 5 分钟，覆盖正常人工授权等待。设置显示“正在导入”和系统弹框提示，操作期间禁用重复提交、清除旧成功提示；失败后恢复按钮并说明先处理系统弹框、再手动重试。原生报告返回 `timed_out` 或拒绝带 `stopReason: timed_out` 均转为固定安全文案，不泄露本机路径或 Cookie。失败发生在写入之前，既有 Molly Cookie 保持不变。

没有采用界面先超时、后台继续读取的 `Promise.race`，因为原生调用不可取消，提前解锁会制造迟到写入或重复导入。也未增加自动重试、独立读取进程或自研解密。固定版本的第二次详细读取没有 timeout 参数，5 分钟只约束初始报告，不承诺整次导入严格限时。系统弹框仍需用户处理，延长期限不代替 macOS 授权。

## 验证和交付限制

- 确定性回归先在旧期限下失败，再验证模拟两分钟授权可以导入、读取期间目标不变，以及两类原生超时都保留旧 Cookie。账号读取/写入测试 12 项通过，均使用虚拟时间或合成数据。
- 设置页回归验证等待提示、禁用/恢复按钮、失败提示、手动重试后成功与 Pinterest 单站点合同；补充 Storybook 的准备、等待授权、失败状态。未再次读取真实 Chrome 或请求模型。
- 已有真实账号证据：忽略目录 `e2e/artifacts/acceptance/browser-signed-pinterest-20260923-04/` 记录导入 5 条、登录后搜索/详情、保存 736×920 JPEG、同包重启和清理。该轮结束判据有误，原始 `not-passed` 保留；`browser-signed-pinterest-closure-20260923-01/` 独立确认最终回复、控制权归还和清理。Cookie 原值与用户/模型原始会话不入库。
- `pnpm check`（全仓类型、lint、单元测试、i18n 和模块边界）、`pnpm e2e:check`、`pnpm run docs check` 全部通过；执行了 `pnpm format` 及受影响界面/文档的格式化。集中检查发现的手写站点类型已统一到共享合同，并处理了浏览器改动中的变量遮蔽及 Promise lint 问题，保留异步清理语义和原生错误脱敏。此次未重跑真实网站和模型验收。
- 本次等待变化由合成回归覆盖；既有签名验收包早于该修复。更新包的构建和签名结果单独记录，不冒充新的真实账号验收。

此项完成条件是 Pinterest 核心能力与授权等待修复的代码收尾；公开发布、Developer ID 公证分发、升级演练和 Amazon 验收是后续任务。

## 本地交付结果

代码分为三个本地提交：`bcf49330` 独立保存版本修复、`e2bdc48a` 浏览器及 Pinterest 账号功能、`26a57302` 既有桌面 harness 的浏览授权旅程。未推送或发布。

`pnpm build` 通过；随后使用之前已授权的同一 Apple Development 身份，通过仓库打包入口生成 `apps/electron/dist/pinterest-first-release-20260923/mac-arm64/Molly.app`，源码标记为 `26a57302`。CookieEncryption、原生 Chrome 读取绑定、官方 MCP/transport、Bento、Pi 和内置 CLI 启动探针均通过，`codesign --verify --deep --strict` 通过，并确认签名 Team 与此前验收包一致、非 ad-hoc。此包包含等待提示与 Pinterest 单站点修复；未启动它读取真实账号，也未重新运行模型验收。包只用于本机开发验证，未公证、未启用发布。
