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

## 规格 §5 组件走查落地（polish，2026-09-18）

token 层落地后按规格 §5 逐件走查并改齐（token 驱动 + 少量组件类名）：

- **Token（`tailwind/index.css`）**：半径阶梯改冻结值——`--radius-md` 6→5px、`--radius-lg` 8→9px、新增 `--radius-xl` 13px（菜单/popover/composer 的 `rounded-xl` 自动吃到）；全局 `:focus-visible` 从 1px 半透明 primary 内环改为 **2px 实线 `hsl(var(--ring))` 内环**（menuitem 雕刻豁免保留，`*:focus` 禁 Tailwind ring 的行为不动）；新增冻结 `--tip-bg`/`--tip-fg`（亮 `#2c2c2c`、暗 `#1e1e1e`，白字）——只进 CSS 回退块、不进主题 JSON，任何主题下 tooltip 恒为单色深泡。
- **Tooltip**：去边框/popover 底，改 `--tip-bg` 深底白字 11px/500、padding 6×9、radius 5。
- **Button**：默认 36→32px、padding 16→12px、13px 字；sm 32→26px；lg 40→38px；icon 36→32px；disabled 50%→40%。
- **Badge**：radius 5→4、11.5px/500；**Switch**：36→34px 宽、thumb 改 `--primary-foreground`（开=主色底+反转 thumb，规格 §5）；**Input**：36→32px、13px；**菜单项**：min-h 32→30px、radius 8→5、13px（菜单容器 `rounded-xl` 已由 token 变 13px）。
- **用户聊天气泡**：灰底毛边（`bg-foreground/5` + 1.15rem）改为**前景反转实心泡**（`bg-primary` + `text-primary-foreground`、radius 13、padding 8×13）；mention chip 靠 `--primary`/`--muted-foreground` 混色，泡内局部重绑定这两个变量到反转墨色，两种主题下 chip 都是泡上文字的柔 tint（`--foreground` 不重绑——chip 的 82/18 混色对比正是信号）。
- **Composer（会话）**：边框 hairline→`--input-border`（border-strong），聚焦时 border 转 `--primary` + 1px 外环同色系（Figma 式，容器 `focus-within` 拥有焦点信号；textarea 补 `focus-visible:shadow-none` 灭掉全局内环避免双信号）；底部内联 pill 28→24px。
- **发送/停止钮**：28→30px，hover 改为**上浮 1px**（原 active 下沉删除）。
- **分段控件（Queue/Steer）**：去胶囊化——容器去边框、`rounded-full`→`rounded-md`  muted 底 padding 2，内钮 26px radius 3，选中=popover 底+shadow（规格 §5 明确"不是 pill"）。

### Apple 设计系统对照审查（2026-09-18，refero Apple style）

对照 https://styles.refero.design 的 Apple 规范复核后的修正——规范核心教条"扁平是刻意的：层级靠表面切换 + 1px 发丝线，不给卡片/导航/按钮加阴影；阴影只属于浮层"，与用户批准的冻结 demo 完全一致（demo 的 `.btn`/`.demo-input`/switch 轨道均无阴影）：

- **chrome 去阴影**：Button 全部变体（原 shadow-sm/xs）、Input、Select 触发器、Switch 轨道、Badge 四变体、Checkbox、Radio、Toggle outline、Menubar 条、Card 去 shadow-xs/sm——恢复与冻结 demo 一致的纯扁平 chrome。
- **浮层保留阴影**：Dialog/AlertDialog/Sheet（shadow-lg）、Popover/SelectContent/MenubarContent/Mention/Calendar（shadow-md/xs）、Tooltip（shadow-md）——浮层 elevation 是冻结 demo 认可的（`--shadow-pop`）。
- **Switch thumb** shadow-lg → shadow-xs（demo 仅给 thumb 一级淡影 `--shadow-1`）。
- **Select 触发器** h-9→h-8、13px，与 Input 对齐（Apple 统一控件尺寸；冻结规格默认控件 32px）。
- **未采纳项及理由**：Apple web 营销系统的 17px 正文/980px 胶囊按钮/三级蓝分工不适用于专业桌面工具（违背已冻结的密度与单色方向，色彩方向用户两轮否决后冻结）；负字距跟踪对 CJK 正文有害；tabs 选中态保留 shadow-sm（= demo 分段选中 `--shadow-1` 的浮起语义）。

## 验证期缺陷修复（画布生命周期）

UI 截图审核中发现三个画布生命周期缺陷，与视觉层无关但阻塞刷新验收，一并修复：

- **hostId 稳定化**（`design-canvas.tsx`）：`hostId = sessionId`（每 artwork 一个），取代每次挂载的 `crypto.randomUUID()`。主进程按 hostId 持有隐藏的 canvas WebContentsView 且 `hideDesign` 只隐藏不销毁；每次挂载换新 id 会 spawning 第二个原生视图、重新加载文档（选区环/缩放/胶囊全部重置）并泄漏旧视图。预览面在主进程单独命名空间，复用同 key 不冲突。
- **选中状态重播种**：主进程新增 `lastSelectionSummaries`（按 hostId 索引；`POST /ws/<id>/selection` 在 count>0 时写入、为 0 时删除；`attachDesign` 新建记录与 `destroyDesignInstance` 时清除），新 IPC `design.selectionSummary` 暴露；渲染进程在订阅 `design.selection` 后重挂载时调用重播种。修复"缩放后消失了"：胶囊是渲染进程状态，重挂载即丢，而原生视图里的选区仍在，两者失配。元素引用仍只来自验证过的选区上报，重播种只是显示层补数。
- **遮罩几何判定**：`hasCanvasBlockingOverlay` 从"存在任何 overlay"改为要求与画布 host 真实矩形相交且跳过零矩形 overlay。修复左侧栏会话悬浮卡（Radix HoverCard portal 到 body）在画布加载期间把画布判成被遮挡而留白。

## 设置界面对齐走查与残留清扫（2026-09-18，回应"设置是否也对齐"）

设置弹窗（`DesktopSettingsModal`，Personal/Workspace/Other 三组）本身走共享基件，跟随刷新自动对齐：开关（34px 反转 thumb）、按钮（32px/无阴影/radius 5）、菜单（13px/30px 行）、对话框圆角（token 驱动）、Queue/Steer 分段控件（去胶囊化）实测均符合冻结规格（亮暗双主题 CDP 实测）。但走查发现一批设置域**本地克隆/覆盖**的控件样式停留在刷新前值，属第一轮遗漏：

- `settings/preview-select.tsx`：Appearance 的 Theme/Language/界面字体下拉触发器是本地克隆串（h-9 36px + shadow-xs + 14px），已改为与共享 SelectTrigger 一致（h-8 32px、去阴影、13px），弹层条目改 13px/radius 5/min-h 30。
- `settings/mcp-connection-form.tsx` TransportToggle：仍是旧式胶囊分段（rounded-full + border + bg-muted/60），已按 Queue/Steer 规格去胶囊化（容器 h-[30px] rounded-md bg-muted p-[2px] 无边框，内钮 26px radius 3，选中 popover 底 + shadow-sm）。
- 共享 `shared/option-selector.tsx` 尺寸表 `md` 档（默认档，agent/模型/字体选择器共用）：h-9 text-sm → h-8 text-[13px]，与 Select/Input 统一；`sm`/`lg` 档不动。
- 一批 `h-9` 输入/触发器高度覆盖统一回 h-8：agent-role-form、agent-config-dialog（名称/命令/env 输入、SelectTrigger、内嵌行）、image-connection-setting、mcp-connection-form、acp-authentication-panel（原生 select 克隆同步 border-input-border/bg-input-field/13px）。
- `settings/compact-layout.tsx` 行内图标按钮去 shadow-xs（chrome 去阴影）。

真机验证（CDP 计算值）：Appearance Theme 触发器 32px/13px/无阴影/radius 5；字体选择器 32px/13px；MCP Transport 分段容器 30px/radius 5/无边框/暗 muted 底，选中钮 popover 底 + 阴影；MCP 表单输入 32px。设置其余表面（badge、tooltip、开关、Terminate 红=信号红、Running 绿点=信号绿）与冻结规格一致。

## 缺陷修复：画布选中悬浮栏字体下拉（2026-09-18）

用户报告选中悬浮栏字体下拉"似乎有 bug"（触发器显示回退文案 "Font ⌄"，点击只弹出一个无选项的空白小片）。根因是数据层而非交互层：

- Agent 创建的文本元素在语义文档里完全不带 `fontFamily`（投影默认值生效中），且 `doc.fonts` 为 null。选择摘要提取因此给不出 `c.fontFamily`，下拉候选列表也为空——`choices()` 用空 items 开弹层，渲染成一条不可用的空白细条。
- 修复一（`patches/web-product-session.patch`，sha256 已更新）：文本分支的 `fontFamily` 提取增加回退链（element → 首 run → `STATIC_V1_TEXT_DEFAULTS.fontFamily`），让工具栏永远显示生效字体；摘要 `fonts` 列表固定并入产品默认 Inter（kernel 契约里默认 face 本就免注册）。
- 修复二（`design-bento/src/selection-toolbar.ts`）：`choices()` 对空 items 直接不开弹层并禁用触发器，空候选不再产生死交互。
- 连带发现的跨构建不一致（不修则"选了 Inter 反而保存失败"）：供应商契约的文本默认值 `MiSans`→`Inter` 改写原本只发生在 design-bento 画布构建；CLI 侧保存校验（`apps/cli/src/design/store.ts` 的 `staticV1UnregisteredFontFamilies`）与素材 skill 打包仍看 MiSans 默认值，显式写入 `fontFamily:"Inter"` 会触发 `PPTD-E012: unregistered font family "Inter"` 导致自动保存失败。已在 `apps/cli/vite.config.ts`（molly-vendor-text-default transform）与 `packages/design-authoring/scripts/build.mjs`（skill helper 打包后改写，同样带 pinned-source 断言）补上同一改写；design-bento README 记录"三处改写必须同改"的不变量。CLI dist 已重建并 sync 进 resources/cli。
- 回归测试：`packages/components/tests/design-toolbar-font-repro.test.ts`（jsdom：触发器显示 Inter、点击开弹层、选中后 POST `text-style` 命令）。

## 代码评审缺陷修复与组件对齐（2026-09-18，第二轮）

对 chrome 刷新与字体下拉修复做代码评审后，修复确认缺陷（A 组）与组件对齐（B 组剩余两项）：

- **tooltip 无效背景类**：`ui/tooltip.tsx` 的 `bg-(--tip-bg)` 缩写发出裸 `var()` 代入，在计算值时被丢弃（token 是 HSL 通道三元组）。改为 `bg-[hsl(var(--tip-bg))] text-[hsl(var(--tip-fg))]`。
- **`--muted-foreground` 非法重绑定**：`ai-gui/view.tsx` 曾把完整 `color-mix()` 颜色重绑进通道三元组变量，消费者包 `hsl(var()/alpha)` 后整条声明失效。用户气泡改为显式类 + 唯一合法的重绑定（`--primary: var(--primary-foreground)`）；中性 mention 芯片的 68% 墨色 tint 由 `@layer utilities` 里挂在气泡属性选择器下的直接 color 规则绘制（层级序胜过跨层 specificity；不做 `--foreground` 重绑定——那会把彩色芯片的 82/18 混色变平）。
- **反转气泡内搜索高亮不可读**：`session-search-context.tsx` 的 mark 从透明底翻转反色改为显式琥珀（amber-200/75 底 + amber-950 字，dark 下 amber-400/85；active 档 amber-300 + ring），两种气泡极性都可读。
- **气泡"Show more"对比度**：显式 `text-primary-foreground/60 hover:text-primary-foreground`。
- **开发构建缺 MiSans→Inter 改写**：`apps/cli/scripts/dev-build.mjs` 增加 esbuild onLoad 插件（与 vite 生产插件同规则、同 pinned-source 断言），dev/prod 构建的保存校验行为一致；AGENTS.md 不变量点名四处改写站点。
- **补丁回退链补全**：`patches/web-product-session.patch` 的 `fontFamily` 回退之外，`color`/`fontSize` 同样补 `|| firstRun` / `?? firstRun` 与 `STATIC_V1_TEXT_DEFAULTS` 兜底（含空字符串守卫）；sha256 已更新。`selection-toolbar.ts` 空候选只禁用触发器、不再尝试开空弹层。回归测试并入 `design-selection-toolbar.test.ts`（触发器显示生效字体并下发 text-style 命令；无字体候选时禁用且不开弹层），删除一次性 repro 文件。
- **Select 对齐冻结菜单配方（B 组）**：`SelectItem` 13px/leading-5/min-h-30/rounded-md/pl-2 pr-8，`SelectContent` rounded-xl；`selectTriggerClassName` 导出并由 preview-select 与 acp-authentication-panel（原生 select）复用，消灭三份克隆。
- **SegmentedControl 共享组件（B 组）**：`components/shared/segmented-control.tsx`（md/sm 两档，30px 高、rounded-md 槽、选中 popover 底 + 阴影）替换 mcp-connection-form 的 TransportToggle 与 queued-message-behavior-control 的本地实现；设计画布 Artwork/Preview 切换几何/语义不同，刻意不并入。
- **冗余清理**：`Input`/`SelectTrigger` 等重复 `h-8` 与 `focus-visible:outline-hidden` 覆盖删除（compositor 的 `focus-visible:shadow-none` 是承重的，保留）。

真机 CDP 走查发现一处规格未达：宿主 CSS 压缩把 Tailwind 默认主题压成**未分层** `:root,:host` 块，未分层声明胜过一切 `@layer`，冻结的 base 层 `--radius-xl: 0.8125rem` 被 12px 默认值压过（`--radius-sm/md/lg` 因默认主题不发同名变量而不受影响）。修复：index.css 末尾加未分层 `:root` 尾部重绑定守卫；AGENTS.md 记录"改梯子需两处同步、在宿主验证计算值"的不变量。修复后实测：`--radius-xl` .8125rem，SelectContent 13px、菜单/气泡等全部 rounded-xl 表面回到冻结值。

真机验证（CDP 计算值，重建重启后）：tooltip 探针 rgb(44,44,44) 深底白字（修复前透明）；语言 SelectContent radius 13px、项 13px/min-h 30px/leading-5；Preferences 分段控件 30px/radius 5/子项 12px；RADIUS_XL .8125rem。全量 `pnpm check` 仅剩 clone 环境性失败（本 clone 仅 4 个提交，live-fingerprints 断言最近 30 条提交含 PPTD|Folio，不可由代码修复）；`pnpm format`、`pnpm run docs check` 通过。

## 缺陷修复：会话菜单 Copy 子菜单触发画布隐藏（2026-09-18，用户报告）

**现象**：悬停会话头部"More actions"菜单的 Copy 项时，右侧设计画布整片变白；移开后恢复。用户两次截图中一次画布空白、一次正常，疑似偶发。

**诊断（非崩溃、非渲染 bug）**：这是 `design-canvas.tsx` 的 `hasCanvasBlockingOverlay` 闸门的**故意行为**——设计画布是原生 WebContentsView，永远渲染在 HTML 之上；任何 `[role=dialog|listbox|menu]` 与画布宿主矩形相交时，闸门主动 `service.hide()` 藏起原生画布，避免菜单被画布盖住。实测 Copy 子菜单固定在父菜单右侧打开（Radix 子菜单的 `side` 不可配置），落在 x=1123、宽 200 → 右缘 1323，而画布宿主从 x=1167 起，持续相交约 156px，于是整片画布被藏。用户第二张截图（子菜单开着、画布正常）是子菜单尚未完成碰撞翻转/指针恰在边缘的瞬时态，非两种稳定状态。整片隐藏虽"正确"但体验差：为一条 156px 的相交缝把整块画布变白。

**修复**：`session-chat-interface.tsx` 的 `SessionHeaderMenu` 在菜单打开时取 `[data-panel-id="chat"]` 面板元素，作为 Copy 子菜单 `DropdownMenuSubContent` 的 `collisionBoundary`。Radix 的碰撞检测在子菜单右缘触到面板边界前先把它翻到父菜单左侧，不再伸进画布宿主；面板极窄容不下时回退到视口行为（此时画布隐藏闸门仍是正确兜底，因为菜单真的盖到了画布上）。子菜单 `side` 想直接给 `left` 会 TS2322（Radix 类型省略 `side`/`align`），故走 collisionBoundary 一路。

**验证（CDP 实测）**：修复前子菜单 x=1123/宽 200，与画布宿主（x=1167）持续相交；修复后同一会话同一操作，子菜单翻到 x=705/宽 200（右缘 905），父菜单 x=911/宽 206（右缘 1117），两个菜单与画布宿主均不相交（intersects:false），菜单开着时画布区域与关闭时逐像素一致（该验证会话画布本就无内容，白色为画布底色，非被隐藏）。`pnpm check` 同前仅环境性失败；`pnpm format` 通过。

## 缺陷修复：选中行反转白字（2026-09-18，用户报告）

**现象**：侧栏选中行（如"Chats"列表的当前会话）背景是 10% 浅灰 tint，标题却是白色反转字，对比度极低看不清；用户明确"背景色可以，字体颜色没必要反转，因为背景色不是很浓"。

**根因**：`--sidebar-selection-foreground`（亮色主题 = 白）是为**实心底** `--sidebar-selection`（近黑）设计的配对；而四个侧栏列表的选中行背景实际是 `bg-sidebar-foreground/10`（10% tint），标题却沿用了反转 token。暗色主题同样中招：该主题下 selection-foreground 是 17.3% 近黑，落在白 10% tint 上一样看不清。泛化审计全部反转字配对后确认仅此一类错误：

- 错误（白字/黑字浅底，已修）：`session-list.tsx`、`sidebar-updated-session-list.tsx`、`sidebar-updated-task-list.tsx` 的选中行标题，`loro-app-sidebar.tsx` 的会话行——统一改回 `text-sidebar-foreground`（与容器一致）。
- 正确（反转字只配实心底，保留）：New chat 按钮等 `bg-primary` 实心近黑 + 白字（冻结规格的前景反转 prominent 钮）；`bg-sidebar-selection` 实心底的分组头/项目行/sidebar 菜单 active 态；日历/toggle/tree-view 的 `bg-selection` 实心底。菜单高亮项 `bg-hover`（92.2% 浅灰）配 `--hover-foreground=--foreground`（近黑字），本来就是正确范式。所有 `bg-primary/*` tint 底也都配深字，无违规。

**不变量**（已记入会话壳文档）：反转文字只允许出现在深色实心底（`bg-primary`、`bg-sidebar-selection`、`bg-selection`）上；任何 `*-foreground/10` 级别的浅 tint 选中底必须用常规前景色。

**验证（CDP 计算值，重建重启后）**：亮主题选中行标题 rgb(30,30,30) 近黑 / 行底 10% tint；暗主题标题 rgb(255,255,255) 白 / 行底白 10% tint——两主题均可读。`pnpm check` 同前仅环境性失败；`pnpm format` 通过。

## 方向修正：侧栏取消实心底选中，统一浅灰 tint 语言（2026-09-18，用户裁定）

用户看过选中行修复后明确"这里也要改"——侧栏的 New chat 导航钮等 active 态仍是实心底 `--sidebar-selection`（近黑）+ 白字，与选中行的浅灰 tint 语言并存，观感厚重且两套选中语义并存。裁定：**侧栏 chrome 不再使用实心底选中**，所有 active/selected 态统一为选中行同款语言（`bg-sidebar-foreground/10` tint + `text-sidebar-foreground`，有边框槽的顺带把 `border-sidebar-ring/30` 换成 `border-sidebar-foreground/10`）。

改动 8 处 6 文件：`loro-sidebar.tsx`（NavButton=New chat/Tasks、底部工具图标、updated 分区项）、`ui/sidebar.tsx`（MenuButton/MenuSubButton active、MenuAction/MenuBadge 的 peer-active 白字覆盖删除——回退到基类深字）、`session-list.tsx` 与 `task-list.tsx`（分组头 active）、`loro-app-sidebar.tsx`（项目行 active）、`task-list.tsx` 任务行标题（同一 tint 底配白字残留，本轮一并修掉）。`--sidebar-selection`/`--sidebar-selection-foreground` token 保留在契约里（主题 JSON 与契约测试不动），只是 chrome 不再消费。

实心底的反转字保留范围收窄为：`bg-primary` prominent 钮（对话框主按钮等）与 `bg-selection`（日历/toggle/tree）——`bg-primary` 实心底的反转按冻结规格仍成立（New chat 钮本身已改 tint，其余按钮用户未点名，保留待裁）。

**验证（CDP，重建重启后）**：落地页 active 态 New chat 钮 = tint 底 + rgb(30,30,30) 深字；会话页选中行同语言。`pnpm check` 同前仅环境性失败；`pnpm format` 通过。

## 验证

- `packages/components/src/lib/vscode-theme/bundled/molly-themes.test.ts`：两个主题各 71 个 chrome 变量精确断言 + 画布/面板层级 + 选中/环=前景反转 + 语法变量存在性 + 默认选择=molly。7/7 绿。
- 画布生命周期修复人工截图回归：选中→胶囊/选区环出现；切到 Conversation Diff 标签再切回（重挂载）→ 胶囊/环/缩放全部保留（重播种生效）；放大 59%→74%、缩小回 59% → 胶囊不丢；左侧栏悬浮卡悬停期间画布正常加载。全量页面重载后胶囊亦由重播种恢复。
- 组件包 `pnpm typecheck`（tsgo）通过；全量 `pnpm check`/`pnpm format`/`pnpm run docs check` 在提交前跑。

## 遗留

- 验证期画布顶部出现过一次 `TypeError: Cannot read properties of undefined (reading 'getBoundingClientRect')` 红色横幅。对渲染进程全部 7 个 `setError` 点位埋点（含调用栈日志）后，完整人工回归零复现，埋点已移除；静态审计排除全部 renderer 守卫路径、主进程（仅预览注入脚本有一处 null 接收者）与 CLI。疑似 vite HMR 全量重载过渡期的陈旧闭包执行，未定论；若再出现，先看 dev log 的 renderer console 转发。
- e2e golden（若有视觉基线绑定旧蓝色）可能失败，需要在提交时核对。
- 组件走查（规格 §5 其余条目：按钮/菜单/composer 细节）已于 2026-09-18 落地，见上节；剩余缺口：设计对话框/alert-dialog 仍 `rounded-lg`（9px，规格未定对话框档，当前与卡片同档属可接受）；landing composer 的 hairline 边框与阴影维持原样（会话壳为优先级最高表面）。
- 规格 §6 画布选中"双环"无法在注入 CSS 实现：选区环由 Bento 编辑器内部绘制，`product-session.ts` 只能上报选区、没有 CSS 钩子；要改需动 Bento 内核，超出本次视觉层范围。
- 规格 §6 底部状态条在真实应用里不存在对应组件（那是 demo 提案）；曾按 `bg-card border-b` 落地选中带，UI 审核时用户裁定改为悬浮态（无实体背景），已改为透明带 + 居中悬浮胶囊。注意画布是 `service.attach()` 原生窗口，HTML 永远盖不住它。
- lody-light/vesper 仍 SELECTABLE 但在固定选择下不应用；是否物理删除留待后续简化。
