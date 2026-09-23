# 全套 SVG 操作图标重绘

Status: implemented
Date: 2026-09-23
Translation: pending

## 摘要

此前的细线样式只统一了线宽，React、原生画布和第三方控件仍来自不同图形集合。用户本次明确要求“用 svg 重新设计一遍所有的 icon，要求要体现设计感”，授权重绘并实施。此次绘制 227 枚操作与状态 SVG，以克制几何、圆端点、开放轮廓和同类结构建立统一视觉；可编辑 SVG 作为唯一图形源，外层界面与画布使用其生成几何。实现已接入并通过真实桌面检查；品牌、用户 emoji、文件类型标识和作品图形保留各自语义，视觉质量仍待用户判断。

## 依据与范围

- 本轮明确授权替代[前序细线方案](2026-09-22-seede-ui-style-direction.zh.md)中“全套重绘单独评估”的待定事项；已通过的布局与行为保持原有归属。
- [产品 Spec](../../../../specs/graphic-design-platform.zh.md)和[范围复核](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)中的编辑、执行与持久化约束不变。图标不增加产品动作。
- AST 盘点得到 217 个源文件中的 203 种 Lucide canonical glyph；加上第三方编辑器、原生画布及自定义状态图标后，重绘目录共有 227 枚。兼容导出包含别名，不以导出数量冒充独立设计数量。
- 用户未回复可选风格偏好，因此延续此前认可的细线方向：24×24 设计坐标、1.5 描边、圆端点和圆连接，在 16/20/24px 查看辨识度。

## 实现与取舍

`packages/shared/src/ui-icons/svg` 存放可编辑原稿。受限静态 SVG 生成器提取几何，输出可 tree-shake 的具名节点；React facade 与原生 `renderUiIconSvg` 共同消费。运行时不读取文件、不解析任意 SVG，也不引入新的 icon 服务、包或网络资源。共享测试入口先执行 `icons:check`，阻止修改 SVG 后遗漏生成输出。

复用现有 `rendererBundleAliases`，将精确的 `lucide-react` 请求指向 facade；保留旧名字、React ref/SVG 属性和类型兼容，避免 217 个文件逐项迁移，并覆盖 Meowdown 的内部图标。测试与 TypeScript 使用同一别名。GitHub 品牌另行保留来源许可，不列入自绘图形。

现有自定义 wrapper 保留 API，统一接入优先级、离线、工作树、进度、筛选图形。Streamdown 和 Sonner 使用公开 icon slots。PhotoSlider 没有 close/prev/next 图标替换 prop，通过公开 toolbar slot 与现有翻页容器的 CSS mask 更换画法；Pierre diff 通过公开 `unsafeCSS` 替换 shadow DOM 内的展开箭头。两者仍由原库管理原有事件和交互。

原生 dock、形状菜单、选区工具栏和 zoom 使用共享节点；原来的 T、⌄、± 字符操作符改为 SVG，保留缩放按钮和监听器。百分比、字体名、属性标签、色样、选区手柄属于数据或内容；系统文件/颜色选择器由平台提供。上游被隐藏的菜单、未暴露的旧快捷键浮层和作品内 SVG 不是本轮自有控件。

相较直接在每个组件复制 path，此方案保留一份可编辑几何。相较运行时通用 SVG 渲染器，静态生成增加一次维护命令，但避免运行时解析和额外状态。新目录规则记录在就近 AGENTS；旧 Lucide import 只是兼容入口，新图形应加入 canonical 目录并显式导出。

## 验证与限制

- 227 枚 SVG 根属性、静态 shape/attribute 白名单、生成同步检查通过。
- 独立总览显示全部图标在 16/20/24px 及浅深主题；已目视检查创作、文件、方向状态与设置四组。
- 真实桌面前 126 张、后 127 张，其中 126 对同场景配对：原生画布/七类元素/菜单前 36 张、后 37 张（新增一张配置菜单补充原图，无旧版配对）、主工作台 12 张、设置 42 张、对话状态 36 张。最终四组 after 报告均通过且 buildHash 同为 `3dc62d502938483724a55103b054a58100e18ba1e54426a3411e876397553f72`。覆盖浅深色、宽窄窗口、只读/运行/权限/错误状态与键盘焦点；视觉仍由用户作最终判断。
- `pnpm check` 通过，含全工作区类型、lint、测试、i18n 与 public/platform boundary 检查；CLI 和 RPC 套件原有合计 6 个 skipped tests 没有启用。初次新增 React icon 测试在 jsdom 中用 URL 解析磁盘路径失败，已改为包内文件路径并在完整重跑通过。
- `pnpm --dir apps/electron build:app` 通过。`pnpm install` 通过，未改变依赖版本，因此 lockfile 无差异。新增 glyph/facade/adapter 源的格式与生成同步检查通过。
- 原生 dock/selection scoped 共 25 测试通过；生成 renderer 2 测试、React/ref/alias/catalog 4 测试已纳入正常测试入口。既有 Markdown、permission、image preview 和 diff 测试通过。
- 独立 headless Chromium 使用真实 PhotoSlider 与 Pierre FileDiff 验证关闭、鼠标/键盘翻页、SVG mask 绘制、展开按钮及方向；发现并修正了 diff 原有 scaleY 翻转所需的基准箭头朝向。该局部库验证与真实 Electron 截图分开记录，不将静态 probe 当成产品回合证据。
- 已检查原生七类选区栏的两种主题、窄窗口形状菜单、设置导航和工作台按钮；没有观察到缺失图标或原生选区栏裁切。独立 SVG 总览提供每枚源文件下载，前后对比页使用 126 对原始 PNG，另外单列无旧版配对的配置菜单截图。
- 本地截图与 synthetic fixture 位于忽略的 `e2e/artifacts/seede-icons` 等目录；不提交用户对话、真实作品或用户配置。
- 没有 PR、提交或发布。本轮完成不表示用户已认可全套视觉。
