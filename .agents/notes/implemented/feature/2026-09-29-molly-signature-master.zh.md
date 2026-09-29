# Molly Design 签名字标与 M 图标

Status: implemented
Translation: pending

## 摘要

Molly Design 的主品牌由旧 M 与 Inter 组合改为完整手写签名字标，并从同源字形派生纸白底 M 应用图标。母版为独立 SVG 路径，组件、浅深色导出和桌面图标使用已纳入源码的资源。人工检查后加粗 Dock 图标、缩小侧栏字标并移除导航负边距，用户接受最终视觉结果。变更不涉及产品身份、数据迁移、更新源或签名配置，已安装分发包和 Windows 的实际效果仍需各自验收。

## 复用与职责

复用现有 `MollyWordmark` 入口、侧栏容器、Electron 图标路径及 iconset 尺寸槽位，没有新增品牌组件协议。旧 M 与新签名字形不一致，因此从选定字标提取同源 M，保留其倾斜与笔势。历史旧品牌仍见[原品牌落地记录](../../proposed/feature/2026-09-15-molly-design-rename.zh.md)。

`packages/components/src/assets/molly-wordmark-source.svg` 与 `molly-mark.svg` 是轮廓母版。既有 `generate-molly-wordmark-svg.py` 改为派生 TypeScript 常量与浅深色 SVG，不再用 Inter 字形拼接品牌字标；独立审阅页仍保留 Molly Review 名称和普通 Inter 文字，但 M 使用同源轮廓。派生 TypeScript 生成后按仓库规则格式化。

React 字标使用 currentColor 和完整路径；读屏名称为 Molly Design。侧栏字标为约 97×32px，名牌高度 32px；无工作区切换器时导航上边距为正 4px，保持与按钮的间隔。工作区切换器、折叠按钮和系统交通灯的位置规则保持原有语义。

## 图标与资源

图标沿用 1024 画布、48 外边距、928 容器尺寸和 208 圆角半径，移除旧背景横线，以纸白和墨色突出 M。Dock 采用加粗简化轮廓，大／小／微型档描边分别为源图 16／19／23px；完整字标保留较轻笔画。三份图标 SVG、运行时 PNG 以及 ICNS/ICO 均纳入既有资产路径，运行时不引用被忽略的 output 目录。

现有 `pad-mac-icon.py` 从单一大图缩小会丢失尺寸专用笔重，并重复增加留白，因此 ICNS/ICO 使用各档独立渲染的 PNG 打包。`icon-mac.padded.png` 保留消费路径，但内容使用已含 48px 外边距的母版。共享 PNG 副本保持一致；ICNS 含十个槽位，ICO 含七种尺寸。

## 验证与限制

- components、code-review-helper、Electron 类型检查及 build:app 构建通过；侧栏 workspace-identity 六项测试通过。
- 图标检查覆盖 PNG 透明边界、ICO 七个尺寸与对应输入逐像素一致，以及 ICNS 解包后的十个槽位。
- 真实 ElectronHarness 以隔离资料和随机 CLI 端口启动主进程、preload、renderer 与 bundled CLI，检查引导、浅深色侧栏、900×680 窗口及 macOS Dock，正常清理所属进程与测试资料。
- 初版字标放大后过度占用标题高度，人工反馈揭示仅检查字标父容器不足以证明与导航无重叠。最终恢复 32px 高度、移除负边距，并在正常本地窗口确认留白；最终版由用户人工接受。
- 本地视觉样张和日志保留于忽略的 output 目录，不提交屏幕内容、会话或用户资料。
- 完整 Storybook 构建曾因 Node 堆内存耗尽失败；真实桌面构建与窗口检查不等同该构建通过。
- 正常用户资料仍出现后台 Connecting，这是本次品牌变更之外的既有启动问题；未声称对话功能通过。本次没有发布、签名安装或替换 Applications 中的应用，也没有新增付费生图调用。

## 提交前检查

`pnpm format` 通过。`pnpm check` 完成全仓类型检查与 lint 后，在 shared 的三项未修改 Git 远端识别测试停止（其余 1,318 项通过）。本地合成仓库证明该环境将 fixture 中的 GitHub 远端改写为 `lody-github::loro-dev/lody.git`，既有解析器返回 null；不为品牌任务扩改 Git 契约。独立完成 i18n、code-collab imports、平台边界、公共边界和文档检查。完整 components 测试 3,198 项、审阅渲染器 34 项与 Electron 208 项测试通过。
