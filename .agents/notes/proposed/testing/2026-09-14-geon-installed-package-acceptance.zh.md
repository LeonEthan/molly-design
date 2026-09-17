# Molly Design 安装包人工验收清单（Issue #32）

Status: proposed
Translation: pending

## 摘要

已使用发布打包脚本构建 Molly Design 0.1.0 macOS arm64 发布 DMG，用于 [Issue #32](https://github.com/LeonEthan/molly-design/issues/32) 所需的最终安装包验收。#32 关闭后，本清单及剩余发布工作迁移至 [Issue #34](https://github.com/LeonEthan/molly-design/issues/34)。本笔记记录制品身份与校验和、验收清单以及自动化验证的边界。视觉身份判定与引导演出音视频行为检查必须由人工审阅完成；自动化断言无法替代这些项目的人工判断。

## 制品

在通过应用内更新验收的 `codex/independent-release` 分支同源代码上构建。

| 文件 | 路径 | SHA-256 |
|------|------|---------|
| DMG | `apps/electron/dist/MollyDesign-0.1.0-arm64.dmg` | `dbf8ed7ddb443c8b14cd2d015c3962fe98e1f320c44ecc97259a737aa70b6732` |
| ZIP | `apps/electron/dist/MollyDesign-0.1.0-arm64.zip` | `0dfc581e5479f7f67eb9d966521fa7bd6725f7d4f55eea385f396d010b5f856e` |

打包应用身份：

- `CFBundleIdentifier`: `dev.molly-design.app`
- `CFBundleShortVersionString`: `0.1.0`
- `SUFeedURL`: `https://github.com/LeonEthan/molly-design/releases/latest/download/appcast.xml`
- `SUPublicEDKey`: `eo5wdjstR0vesa7qYOKvxMXd977lOVLkd44OGzG/XiI=`

公钥为本地一次性验收密钥，因为当前环境没有 Apple Developer 或发布 Sparkle 签名凭据。DMG 使用 ad-hoc 签名且未公证，首次启动需要用户右键选择“打开”，不能直接双击启动。

## 人工验收清单

审阅者：请在干净的 macOS 账户下执行，或先删除任何已有的
`~/Library/Preferences/dev.molly-design.app.plist`、`~/Library/Application Support/Molly Design`
和 `~/.molly` 状态。

### 视觉身份

- [ ] 挂载 `MollyDesign-0.1.0-arm64.dmg`；卷名、背景图和 `.VolumeIcon.icns`
  应显示 **Molly Design** 品牌，而不是 Lody/Folio 水母或旧水下/极光素材。
- [ ] 将 `Molly Design.app` 拖入 `/Applications`；Finder 和 Launchpad 中的应用图标应为新的 Molly Design 身份。
- [ ] 启动安装后的应用；Dock 图标和菜单栏菜单应标记为 **Molly Design**，而非 Lody/Folio。
- [ ] 打开 **Molly Design → 关于 Molly Design**；关于面板应显示 **Molly Design** 产品名、版本 `0.1.0` 和 Molly Design 仓库链接。
- [ ] 首次启动后检查 `~/Library/Preferences/dev.molly-design.app.plist`；bundle identifier 应为 `dev.molly-design.app`，且无 Lody/Folio 默认值泄漏。

### 引导演出

- [ ] 首次启动时显示引导窗口，且不会未经用户操作自动进入产品。
- [ ] 如有开场动画/视频，应按设计自动播放；若系统阻止自动播放，应用应提供明确的入口（例如播放按钮或“开始”控件），而不是停留在空白或破碎画面。
- [ ] 如引导演出包含音频，应能找到静音/取消静音或音量控制。
- [ ] 应能找到跳过控件，并能干净地退出引导进入产品。
- [ ] 不跳过引导完成时，应进入本地引导/产品入口。

### 自动播放被阻止的入口

- [ ] 在禁用系统自动播放（或模拟被阻止的媒体上下文）时，引导媒体不会静默失败；应检测到被阻止状态并显示回退入口（点击播放、带按钮的静态帧或替代第一步）。

## 已完成的自动化验证

- DMG 可正常挂载，包含 `Molly Design.app` 和 `Applications` 快捷方式。
- `Molly Design.app/Contents/Info.plist` 的 bundle id、版本、feed URL 和 Sparkle 公钥占位符正确。
- 打包应用可在隔离环境下通过现有 Playwright harness 启动并到达引导/产品界面（参见
  [应用内更新验收](../../implemented/testing/2026-09-14-geon-in-app-update-acceptance.md)）。

## 结果

本笔记为**待审阅**清单，等待人工勾选。审阅者确认无 Lody/Folio 身份泄漏后，Issue #32 的安装包验收项即可视为完成。

## 相关决策

- [Molly Design 应用内更新验收](../../implemented/testing/2026-09-14-geon-in-app-update-acceptance.md)
- [独立品牌发布提案](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)
