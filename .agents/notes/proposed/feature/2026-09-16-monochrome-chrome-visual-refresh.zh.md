# 黑白双色 chrome 视觉统一（Molly monochrome chrome）

Status: proposed
Translation: pending

## 摘要

把 Molly Design 的应用 chrome 从 Lody 冷白+蓝切换到 Figma 语言的黑白双色：灰阶 surface + 四级文字、反转色即主色（亮=黑 on 白，暗=白 on 深灰）、红绿仅作语义信号、画布深于面板。色彩方向已经过两轮用户否决后定稿冻结（HIG+slate+蓝"太丑"；Figma 蓝"蓝色更难看"→改黑白），冻结规格在 `output/visual-refresh-demo/visual-refresh-spec.zh.md`，可交互 demo 同目录。本次落地只改视觉层：新增 molly-light/molly-dark 两个 VS Code 主题 JSON 并设为默认、index.css 回退块改冻结值、design-canvas 硬编码带与分段控件对齐、Bento iframe 内注入 CSS 的几何/阴影/信号点对齐。不换 shadcn/ui 底盘（调研结论与重启条件见规格 §9）。配套冻结契约测试 `molly-themes.test.ts`：resolver 输出的全部 71 个 chrome 变量精确等于冻结 HSL 通道。

## 问题与方向

- 现状：默认主题 lody-light（冷白 + 蓝 `--primary 220 82% 65%`）/ vesper（暗色），chrome 有彩色（蓝主钮、蓝 ring、蓝滚动条），与"设计工具"定位不符；design-canvas 有硬编码色带 `#f5f7fa`/`#1b1f26`。
- 方向（冻结四原则，规格 §1）：画布深于面板；实色无材质；反转色即主色 2px 实线；Inter+120ms。用户的作品是屏幕上唯一的色彩。
- 历史约束：色彩方向两轮试错后由用户拍板，任何"再加点蓝/品牌色"的建议都不要再提；`--primary` 是独立 token 槽位，未来品牌色一行替换。

## 方案与备选

| 备选 | 结论 |
| --- | --- |
| 只改 index.css 静态值 | 不够：运行时由 VS Code 主题 JSON 经 `LODY_ALIAS_RULES` 驱动（`vscode-theme-css.ts`），必须新增主题 |
| 新增 molly 主题设为默认（选中） | 值=冻结 token，随现有注册机制接入；lody/vesper 保留在包内但不应用 |
| 改 resolver 规则顺序 | 不动：molly JSON 通过 `sideBar.foreground` 等键自然落到目标变量，零 resolver 改动 |
| shadcn/ui 底盘刷新到 upstream 2026 | 不做（用户拍板）：组件落后约一代半 + 3 个深 fork + upstream 已切 Base UI；token 与底盘解耦。重启条件见规格 §9 |

## Token 映射（冻结值 → 生产变量 → 主题键）

亮/暗共用规则（规格 §2 语义映射）：`--primary`/`--ring`/`--selection` = 前景反转；`--destructive`=`#f24822`、`--status-success`=`#14ae5c` 两模式同值；`editor.background`=画布底板（亮 `#f5f5f5` 浅于面板，暗 `#1e1e1e` 深于面板）；`sideBar.background`/`panel.background`=面板（亮 `#ffffff` 暗 `#2c2c2c`）→ `--card`。完整 71 变量冻结通道见 `molly-themes.test.ts`，关键映射：

| 冻结 token | 亮 | 暗 | 生产变量 / 主题键 |
| --- | --- | --- | --- |
| 画布底板 | `#f5f5f5` | `#1e1e1e` | `--background` ← `editor.background` |
| 面板 | `#ffffff` | `#2c2c2c` | `--card`/`--popover` ← `sideBar.background`/`panel.background` |
| 一级文字 | `#1e1e1e` | `#ffffff` | `--foreground`；`--card-foreground`/`--sidebar-foreground` ← `sideBar.foreground` |
| 二级文字 | `#6f6f6f` | `#b8b8b8` | `--muted-foreground` ← `descriptionForeground` |
| 主色/选中/焦点环 | 实黑/白字 | 实白/`#2c2c2c` 字 | `--primary`、`--selection`、`--ring` ← `button.background`/`list.activeSelectionBackground`/`focusBorder` |
| 边框 | `#e5e5e5`/`#d9d9d9` | `#383838`/`#4d4d4d` | `--border`、`--input-border` ← `sideBar.border`/`input.border` |
| 信号红/绿 | `#f24822`/`#14ae5c` | 同左 | `--destructive`、`--status-success` ← `editorError`/`gitDecoration.*`/`terminal.ansi*` |
| warning 琥珀 | `#9a6700` | `#bda437` | `--status-warning`（保留：语义信号非装饰） |

例外（有意保留的彩色）：`--status-merged` 跟随主题（亮=品红、暗=Vesper 黄），属 git/语法域非 chrome；语法高亮 tokenColors 原样继承 fork 源（Vitesse/Vesper），内容域不受 chrome 无色规则约束。

## 实施与代价

- `themes/molly/molly-light.json`（fork lody-light，199 色）与 `molly-dark.json`（fork Vesper + 补键，177 色）；NOTICE.md 加 Molly 归属节（MIT， lineage 指向 vitesse/vesper 的 LICENSE）。
- 注册：`bundled-vscode-themes.ts` 新增 `molly.theme-molly` 扩展条目，两个 id 加入 SELECTABLE；`theme-selection-storage.ts` 默认改为 molly 对。
- `index.css` `:root`/`.dark` 回退块改为冻结单色值（chart-*/github-*/syntax-*/terminal ANSI 回退不动；`--code-added`/`--code-removed`/`--modified-file` 改指 status/destructive/warning）；暗色 pro shadows 收敛为中性贴地。
- `design-canvas.tsx`：选中带实体背景/边框移除（用户 UI 审核裁定：选中态顶栏应类似底部悬浮栏、无实体背景）——带保留 `h-12` 布局高度（native 画布窗口按 `host.getBoundingClientRect()` 贴装，HTML 无法盖住它），去 `bg-card border-b`，胶囊 `justify-center` 悬浮。曾尝试把胶囊改成画布上方 `absolute z-20` 悬浮层，但画布是 `service.attach()` 贴装的原生窗口（`design-service.ts`），永远压在 renderer HTML 之上，悬浮层完全不可见——这是硬约束，真·盖在画布上只能注入文档内部（同底部 dock 路线）。选中胶囊本体按规格 §5 冻结值：`rounded-[9px] border bg-muted` 容器 + 计数块 `h-5 rounded bg-primary text-primary-foreground` 20px 实色反转。
- `product-session.ts`（Bento 文档内注入，无法跨 frame 用 app token，保留 `Canvas`/`CanvasText` 系统色架构）：dock/autosave 999→9px、popup 12→13、条目 8→5、阴影统一为冻结 `--shadow-pop`（`0 4px 14px rgb(0 0 0 / .16), 0 0 0 1px rgb(0 0 0 / .04)`）、saved `#4ade80`→`#14ae5c`、error/conflict `#f87171`→`#f24822`、pending/saving/loading 点改 `#888`（规格 §2/§6 只允许红绿信号色，琥珀移除）、dock 按钮 50%→5px。
- 坑记录：亮色 `--hover` 有 `ensureVisibleAgainst editor.background` 最小距离 10，`#ebebeb` 对 `#f5f5f5` 距离 17.3 才过；vesper 缺 `descriptionForeground` 会落到 foreground，molly-dark 显式补 `#b8b8b8`；`--ring` 在旧 lody-light 因 `focusBorder` 透明而解析不到，molly 主题显式实色；`--card-foreground`/`--sidebar-foreground` 的 alias 链都以 `sideBar.foreground` 为首选，一个键同时定两个变量。
- 意图核对：读 `specs/graphic-design-platform.zh.md` 后确认平台规格不锁定任何 chrome 颜色（只定能力/流程），本次视觉冻结无需把它退回 draft。
- 代码评审（双轴：standards/spec）后的修正全部吸收：SELECTABLE 注释与行为对齐、Preview 激活态 `bg-background`→`bg-popover` 不对称修复、分段内钮 4px→3px、Bento 阴影对齐冻结 `--shadow-pop` 精确值、amber pending 点移除（只许红绿）、选中胶囊/计数块按 §5 精确实现、molly 契约测试 helper 合并、`vscode-theme.test.ts` 侧边栏偏移方向改为按主题显式方向表断言（lody-light darker / 其余 brighter），对比度下限 1.2→1.15（冻结 #383838-on-#2c2c2c hairline ≈1.19，偏移由画布/面板地面差承担）。

## 验证期缺陷修复（画布生命周期）

UI 截图审核中发现三个画布生命周期缺陷，与视觉层无关但阻塞刷新验收，一并修复：

- **hostId 稳定化**（`design-canvas.tsx`）：`hostId = sessionId`（每 artwork 一个），取代每次挂载的 `crypto.randomUUID()`。主进程按 hostId 持有隐藏的 canvas WebContentsView 且 `hideDesign` 只隐藏不销毁；每次挂载换新 id 会 spawning 第二个原生视图、重新加载文档（选区环/缩放/胶囊全部重置）并泄漏旧视图。预览面在主进程单独命名空间，复用同 key 不冲突。
- **选中状态重播种**：主进程新增 `lastSelectionSummaries`（按 hostId 索引；`POST /ws/<id>/selection` 在 count>0 时写入、为 0 时删除；`attachDesign` 新建记录与 `destroyDesignInstance` 时清除），新 IPC `design.selectionSummary` 暴露；渲染进程在订阅 `design.selection` 后重挂载时调用重播种。修复"缩放后消失了"：胶囊是渲染进程状态，重挂载即丢，而原生视图里的选区仍在，两者失配。元素引用仍只来自验证过的选区上报，重播种只是显示层补数。
- **遮罩几何判定**：`hasCanvasBlockingOverlay` 从"存在任何 overlay"改为要求与画布 host 真实矩形相交且跳过零矩形 overlay。修复左侧栏会话悬浮卡（Radix HoverCard portal 到 body）在画布加载期间把画布判成被遮挡而留白。

## 验证

- `packages/components/src/lib/vscode-theme/bundled/molly-themes.test.ts`：两个主题各 71 个 chrome 变量精确断言 + 画布/面板层级 + 选中/环=前景反转 + 语法变量存在性 + 默认选择=molly。7/7 绿。
- 画布生命周期修复人工截图回归：选中→胶囊/选区环出现；切到 Conversation Diff 标签再切回（重挂载）→ 胶囊/环/缩放全部保留（重播种生效）；放大 59%→74%、缩小回 59% → 胶囊不丢；左侧栏悬浮卡悬停期间画布正常加载。全量页面重载后胶囊亦由重播种恢复。
- 组件包 `pnpm typecheck`（tsgo）通过；全量 `pnpm check`/`pnpm format`/`pnpm run docs check` 在提交前跑。

## 遗留

- 验证期画布顶部出现过一次 `TypeError: Cannot read properties of undefined (reading 'getBoundingClientRect')` 红色横幅。对渲染进程全部 7 个 `setError` 点位埋点（含调用栈日志）后，完整人工回归零复现，埋点已移除；静态审计排除全部 renderer 守卫路径、主进程（仅预览注入脚本有一处 null 接收者）与 CLI。疑似 vite HMR 全量重载过渡期的陈旧闭包执行，未定论；若再出现，先看 dev log 的 renderer console 转发。
- e2e golden（若有视觉基线绑定旧蓝色）可能失败，需要在提交时核对。
- 组件走查（规格 §5 其余条目：按钮/菜单/composer 细节）未逐件改动——现有 shadcn 件吃新 token 后大部分自动单色化，走查留作后续 polish。
- 规格 §6 画布选中"双环"无法在注入 CSS 实现：选区环由 Bento 编辑器内部绘制，`product-session.ts` 只能上报选区、没有 CSS 钩子；要改需动 Bento 内核，超出本次视觉层范围。
- 规格 §6 底部状态条在真实应用里不存在对应组件（那是 demo 提案）；曾按 `bg-card border-b` 落地选中带，UI 审核时用户裁定改为悬浮态（无实体背景），已改为透明带 + 居中悬浮胶囊。注意画布是 `service.attach()` 原生窗口，HTML 永远盖不住它。
- lody-light/vesper 仍 SELECTABLE 但在固定选择下不应用；是否物理删除留待后续简化。
