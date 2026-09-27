# Geon 应用内更新验收（Issue #32）

Status: implemented
Translation: pending

## 摘要

完成了 Geon macOS arm64 独立应用内更新路径的真实验收轮次。使用发布打包脚本从同一源码构建了两个可区分的 Geon 版本（0.1.0 和 0.1.1），通过仅回环的 Sparkle feed 分发，并用现有 Playwright Electron  harness 驱动真实的安装-重开流程。正向泳道验证：引导页、脚本化 Agent 配置、设计画布编辑、粘贴附件、主题切换、更新下载、阻止运行中 Agent 的安装门槛、安装前最后一刻编辑、Sparkle 真实替换安装包，以及重开后所有用户数据保留。三条负向泳道验证：拒绝流氓签名 appcast、下载失败可恢复、篡改 Info.plist 指向外部 feed 时禁用更新器。复用了现有 Lody/Geon 的更新器 UI 和服务，未做改动；工作量主要在于修复陈旧的双版本验证装置和构建隔离、可收集证据的驱动。

## 范围与归属

本次验收覆盖 [Issue #32](https://github.com/LeonEthan/Geon/issues/32) 的 **应用内更新的真实验收** 项，以及 [独立品牌发布提案](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)。
[Issue #32](https://github.com/LeonEthan/Geon/issues/32) 已关闭；剩余发布工作（安装包人工验收、GitHub App 注册、规范审批、提案迁移、公开 DMG/appcast 发布）迁移至 [Issue #34](https://github.com/LeonEthan/Geon/issues/34)。

## 驱动与证据

- 驱动：`e2e/scripts/update-acceptance.mts`
- 装置构建器：`apps/electron/scripts/verify-sparkle-update.mjs`
- 证据（git-ignored）：`e2e/artifacts/acceptance/update-<lane>-<timestamp>/`

各泳道单独运行；每次运行都是不可变的验收轮次。驱动会：

- 为每个泳道创建隔离的 `LODY_DATA_DIR`、Electron user-data 目录和 CLI host 端口。
- 将 rig 的原始 `old` 应用复制到每个泳道独立的 scratch 位置，避免 Sparkle 原地替换污染共享 rig。
- 在每个泳道前后重置 Sparkle 持久化的 `NSUserDefaults` 状态（`dev.geon.app` 域）；macOS 通过真实 home 目录解析该域，不受 `$HOME` 或 `--user-data-dir` 影响。
- feed 响应携带 `Cache-Control: no-store`，防止缓存的 appcast 或 zip 掩盖后续负向泳道。
- 在 `app-<lane>.log` 中捕获原生桥接的 NSLog 输出（Sparkle 检查结果、安装错误）。

## 正向泳道检查点（20/20 通过）

1. `bootstrap-onboarding` — 本地-only 引导完成。
2. `scripted-agent-configured` — 自定义脚本化 ACP provider 创建并就绪。
3. `old-version-is-0.1.0` — 更新器状态报告当前版本 0.1.0。
4. `design-session-created` — 通过脚本回复创建设计会话。
5. `canvas-edits-visible` — Bento 快照中存在文本和形状元素。
6. `attachment-sent` — 粘贴的 PNG 保存在隔离数据目录下。
7. `theme-dark-applied` — `html.dark` 类存在。
8. `update-downloaded` — 阶段到达 `downloaded`，版本 0.1.1。
9. `install-gate-blocks-running-agent` — Agent turn 被 hold 时点击“更新并重启”被拒绝，错误为 `Wait for Agent execution and design processing to finish before updating`。
10. `last-minute-edit-present` — 安装前最后一刻的画布编辑可见。
11. `old-app-quit-for-install` — 安装点击后旧应用进程退出。
12. `bundle-replaced-from-zip` — scratch 应用的 plist 变为 0.1.1，且更新验证标记（仅新 zip 中有）被找到。
13. `stray-relaunch-contained` — 检测到 Sparkle 自动重启动并终止，确保下一次启动仍使用隔离环境。
14. `installed-bundle-signature-valid` — ad-hoc codesign 验证通过。
15. `artwork-survives-update` — 重开前后元素 id 一致。
16. `attachment-survives-update` — 重开后附件名称仍可见。
17. `theme-survives-update` — 重开后深色主题保留。
18. `new-version-is-0.1.1` — 更新器状态报告当前版本 0.1.1。
19. `export-png-after-update` — 通过真实保存对话框 stub 导出 PNG，尺寸正确。
20. `attachment-bytes-unchanged` — 更新前后存储附件的 SHA-256 一致。

## 负向泳道检查点

- `bad-signature`（3/3）：Sparkle 拒绝流氓签名 appcast，提示 `The update is improperly signed…`；应用保持 0.1.0 且仍可正常使用。
- `download-failure`（2/2）：缺失 enclosure 报告下载错误；恢复 zip 后重试成功到达 0.1.1 的 `downloaded`。
- `tampered-plist`（2/2）：`SUFeedURL` 指向外部 feed 的安装包更新器阶段为 `disabled`，原因为 `geon_update_configuration_unavailable`，更新按钮隐藏，应用仍可正常使用。

## 验证装置的关键修复

仓库中的 `verify-sparkle-update.mjs` 在品牌重制引入 `requireSparkle` 校验后已无法工作：

- 运行时未传入 `SPARKLE_APPCAST_URL`，导致本地 feed 安装包将更新器禁用为配置不匹配。
- 使用改名前的应用路径，且仅用一份打包应用复制成“两个版本”，即使 plist 被改为 0.1.1，应用内版本仍是 0.1.0，Sparkle 报告 `You're up to date!` 并拒绝下载。

修复后的 rig 现在执行两次完整的 `package-electron.mjs`（每个版本一次），校验 bundle 短版本号，并正确用运行时 feed 覆盖启动旧应用。

## 限制与已知既有失败

- 本验收仅使用 ad-hoc 签名；未验证 Gatekeeper/公证 DMG 行为。
- `pnpm check` 中 `apps/cli/src/agent/acp-authentication.test.ts` 的 `probeBuiltinAuthentication` 有两项既有失败。它们因测试期望当前环境不存在已配置的 Claude 凭证存储而失败，与更新工作无关。
- 本次 macOS Sparkle 验收未覆盖 Windows/Linux 的 electron-updater 路径。
- 实际发布 DMG 和 appcast 超出范围，且未获授权。

## 相关决策

- [品牌重制与发布页工作](2026-09-11-complete-design-acceptance.md)
- [独立品牌发布提案](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)
