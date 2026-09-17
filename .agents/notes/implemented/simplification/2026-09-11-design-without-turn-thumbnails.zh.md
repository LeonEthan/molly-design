# 删除逐轮缩略图，保留渲染和读图（T08）

Status: implemented
Translation: pending

## 摘要

逐轮结果卡退役后，回合结束仍生成缩略图、写引用并保留专用读回接口，已无产品消费者。本次删除该完整链路及只为它服务的缩放参数，提交回执、普通图片和 Agent 的 PNG 渲染预览继续复用既有能力。旧 outcome 的可选缩略图字段只在读取视图中忽略，原历史和用户文件不做迁移或清理。确定性验证覆盖回执、旧记录及文件保留；真实 Codex 在本机桌面中请求渲染、实际读图后继续修改并提交，原生 PNG/JPEG 导出也通过。该证据限于 macOS 开发构建和一个已配置模型，不表示五种 Agent 或安装包矩阵全部通过。

## 决定和消费者核对

落实 [#10](https://github.com/LeonEthan/Folio/issues/10)，承接 [T07](2026-09-11-design-files-without-result-cards.zh.md) 和[范围复核](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)。实施基线为 `fb7914d`；T07 原始来源提交为 `bf8367be03d96cdc112adefffe681984cfa1f54a`。历史缩略图实现的来源为 `baed947b6f16263cb6a2f8f37e10f1695d146fe0`，旧说明保留该提交的链接。

- 删除 `thumbnail.ts`、`thumbnail-read.ts` 和专属测试；采集不再捕获图片、补写 outcome 或等待渲染。SessionExecution 不再注入缩略图使用的宿主依赖，MessageHandler 的共享宿主及真实 MCP 路由保持。
- 删除设计 worker 的 `thumbnail` 操作、Electron `design.thumbnail` 与专用读回服务。旧候选 JSON 和草稿仍由 T07 的普通文件入口可达；不改 canonical 存储、素材、回执和原子保存。
- 全仓消费者检索确认 `maxEdge`、`scaleToLongestEdge`、8 秒缩略图预算与队列的调用方自定义 timeout 仅服务该链路。删除这些参数及孤立分支；共享宿主保留 60 秒预览预算、队列上限、轮询、错误反馈和报告重传。
- shared 不再暴露 `DesignTurnOutcomeThumbnail` 或其专用 sanitizer。`schema.Any` 仍保存旧字段；`sanitizeDesignTurnOutcome` 只生成当前可用的只读视图，不拒绝旧记录、不回写清理。结果卡 UI 已由 T07 删除，本次没有新的卡片、侧栏缩略图或替代存储。
- 通用附件的 `session-image` thumbnail 路由、图片气泡、普通文件资源、预览、复制/另存并不属于逐轮设计缩略图。它们仍有消费者，保持原样。`folio_render_preview`、PNG 校验、共享 Bento 渲染宿主及 PNG/JPEG 固定导出保持；新预览按画布实际尺寸输出。

## 验证和限制

定向 shared 测试 31 项、CLI 测试 64 项、Electron 渲染宿主 8 项通过。覆盖旧 outcome 带有效或损坏缩略图字段仍读到同一回执，Loro 快照重开保留原字段，正常采集及幂等重开不生产缩略图且旧 PNG 字节不变；预览工具注册/调用、PNG 读回与宿主生命周期继续通过。

`corepack pnpm check`、`corepack pnpm format` 与 `corepack pnpm e2e:build` 通过。格式化后排除无关的既有差异；检查子进程过滤继承的 `ANTHROPIC_*` / `CLAUDE_CODE_USE_*`，未改用户环境。检查通过的 CLI 测试为 2822 项，另有 4 项既有跳过；Electron 为 119 项。没有修改总 Spec、Root AGENTS、历史会话文件或产品 Agent 配置；未发布 PR 或远程提交。

## 真实桌面、模型和导出证据

使用现有 `e2e/src/support/electron-harness.ts`、onboarding/settings/session Page Object，启动本票构建的真实 Electron 主进程、preload、renderer、IPC 和 bundled CLI。每次使用独立 Electron user-data、Folio data 和宿主端口，按应用目录启动；只在独立临时 Codex 配置复用已有登录，结束删除认证副本。没有模拟 provider 输出、替换渲染器、全局设置写入或产品重试机制。

实际组合为 macOS arm64、Electron 39.5.1 / Chromium 142.0.7444.265、公开 `acp-extension-codex` 1.10.0、`codex-cli` 0.153.4、界面显示 GPT-6-Astra / Medium。模型在全新合成设计会话创建 320×200 绿色背景、粉色方块、蓝色圆形与 BEFORE 页脚。它通过实际 `folio_render_preview` MCP 请求渲染，测试人员操作路径仅对该合成工作区的渲染权限点击 Allow；产出 PNG 为 6627 字节，SHA-256 为 `9abd005fc3a9820490a975a6ed1d29b10a3fe1600276d25c93edd6b3418fb64e`。

运行事件确认渲染完成之后，原生 Codex `View Image` 对工具返回的同一绝对 PNG 路径完成实际读取；之后模型才通过工具将页脚改成 AFTER。比较最初写入页面与最终文件，差异仅为该字符串；canonical 的 320×200 文档包含 AFTER，并产生 committed 回执。该回执无 thumbnail 字段，整个会话未创建 `design-thumbnail/`。PNG 实际查看也对应 BEFORE 版本的图形；并未把模型最终文字声明单独当成读图证据。此次读图来自 Agent 自身能力，无需结果卡或专用图片读回接口。

首次验证驱动误将权限等待时 Stop 按钮隐藏当成完成，随后调用错误的清理方法；那次回合停在渲染许可之前，没有 PNG 或读图成功证据。修正驱动后，经实施协调确认进行一次受限新合成回合，使用真实权限 UI 并等待持久提交回执，完整链路通过。没有遇到 provider 失败后自动重试，也没有把首次中断计为通过。原始事件和截图仅保存在忽略目录 `e2e/artifacts/t08/` 及临时证据目录，不提交用户或 Agent 转录；机器可读摘要为该目录的 `evidence-summary.json`。

另外运行已有 `--folio-p1-verify` 原生探针，使用另一组独立目录和宿主端口。PNG/JPEG 都为 913×617，PNG 透明及 JPEG 白底通过；保存、重开、隐藏后 undo/redo、提交后重载、冲突和退出保稿、无效文档及缺字体素材保护均通过。此处复用生产 `renderSavedDesign` 固定 Bento 路径，未新增导出实现或安装包。

边界：没有验证其他四种 Agent、Windows/Linux 或安装包运行；没有做人类视觉质量验收。提交回执可见后立即取的桌面截图未等待最终画布重绘，因此不把该截图当成 AFTER 画布显示完成证据；AFTER 的证据是实际提交文件，画布重载另由既有 P1 探针验证。
