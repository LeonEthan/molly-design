# Bento 编辑语义的 PPTD 往返

Status: implemented
Translation: pending

## 摘要

PPTD v2 可导入，但无法表达 Bento 已开放的分组、多层阴影、精确结构化文本及独立图表调色板；只补一个 serializer 会在下一轮读取时失真。Folio 增加明确的 v3 投影语法，保留 manifest/page/media 多文件结构，直接复用已有 v4 编辑字段、内核重放与资产字节校验。v2 导入继续原样提供主题、富文本标记和默认值解析；v3 不保存第二份 canonical，也不扩大编辑器能力。本文记录字段审计和确定性数据往返；不将这些检查视为视觉质量、真实 Agent hook 或 UI 验收。

## 决定与边界

关联 [范围复核](../../proposed/simplification/2026-09-11-design-result-feedback.zh.md)、[Spec](../../../../specs/graphic-design-platform.zh.md) 和 GitHub [#5](https://github.com/LeonEthan/Folio/issues/5)。

采用 version: v3，而不把新增语义偷偷放入 v2 白名单。manifest 保留 size/pages/customFonts，页面包含 background/elements/diagnostics。元素仍用 elementId/elementType；其他字段直接使用 Bento v4 的已建模结构。投影仅在内存生成，调用方负责写入；单一可编辑事实仍是已保存 BentoDoc。

未采用逐字段反向拼 HTML 再正向解析：该方法会合并相邻同样式 run、重排空段/空 run、混淆默认值与显式值，并需要再次实现列表和转义语法。未采用携带 canonical blob 的 sidecar：这会产生两份互相冲突的作者字段。v3 的结构化 text/table/chart 是页面本身的唯一字段，素材仅按已知 schema 位置改写，不解释普通文本、超链接或图表单元格中的 asset:/media/ 字符串。

## 全部开放编辑面的差异审计

依据 vendored contracts/bentodoc-v4.ts、commands-v4.ts、kernel.ts 与 editor-bento/src/ui 和 ui/dom 全部模块。冻结能力矩阵 116 行，其中 active 108 行；排除的多页、音视频、动画、转场等没有新增入口。分组是 flat groupId，不存在嵌套 group 节点，不能误称树状 group 已支持。

| 字段/动作面 | v2 差异 | v3 表达与往返检查 |
| --- | --- | --- |
| canvas.width/height/background；背景纯色、线性/径向渐变、图片 | size 映射；图片 fit 缺省不同 | manifest.size；完整 background，保留省略与显式值 |
| id/kind/bounds；创建/删除、移动/尺寸、层顺序 | id/type 可表达，但 zIndex 强制数组重编号 | elementId/elementType；bounds、数组序与 zIndex 同时保留 |
| rotation/flip/opacity/groupId/shadow/border | groupId 不可表达；shadow 仅单层且 text 嵌套；table/chart rotation/flip 已禁止 | base 原字段；单层/数组/空数组阴影，flat groupId、边框保留；原宿主约束复用 |
| text.paragraphs/runs 及空段、空 run、换行、字面 HTML/LaTeX 字符 | HTML 解析不能逆向保留准确 run/paragraph 边界 | 原结构与字符原样保存，无 HTML 重新解析 |
| run color/fontSize/fontFamily/backgroundColor/bold/italic/underline/strikethrough/baselineShift/href/latex | 部分可由 HTML 表达，但重新解析有归一化 | 结构化 run 全字段保存 |
| paragraph align/lineHeight/margin；list ordered/marker/indent/style | HTML 默认值、列表分组及固定 px 字符串难以精确保留 | 段/列表全字段，数值及 px 字符串类型保留 |
| text 元素 color/fontSize/fontFamily/bold/italic/backgroundColor/lineHeight/lineHeightPx/letterSpacing/marginTop/textDirection/wrap/align/gradient | 主题/默认值解析后的 literal 无反投影；两类行距互斥 | text 字段原样；互斥规则沿用内核 |
| fonts family/src/weight/style；family 字符串或 latin/ea 与 fallback | v2 可登记，本地 media 转 asset，无反向映射 | customFonts 顺序与描述符；精确 hash 字节映射 |
| shapeName/adjustments/viewBox/path/fill；iconName | 正向有预设几何与 alias 归一化 | 几何/路径/图标字符串原样，不重新生成或栅格化 |
| line viewBox/points/curve/arrow/border | 正向可表达，但 points 字符串拼写不可强制规范化 | 全字段原样，包括 null 箭头 |
| image src/fit/crop/cropShape/border；替换/裁切 | fit 对象 vs 字符串；crop 对象 vs 四边数组；缺省 cover/contain 不同 | 字符串 fit、四边数组 crop（含负 outset）；遮罩完整保留 |
| table columnWidths/rowHeights/rows/style/fill/border；扩容/合并/拆分 | 表格 cell 富文本丢失精确分段；继承来源被解析 | 完整 table：省略的覆盖格、合并跨度、权重、cell text 和样式 |
| table cell/style color/fontSize/fontFamily/bold/italic/backgroundColor/lineHeight/lineHeightPx/letterSpacing/marginTop/fill/border/align | border null/2侧/4侧、空字段和样式优先级必须保留 | 每个 slot、bodyStyles 数组及 rowOverColumn 原样 |
| chart data/series/encode；13 类型及混排、轴、标题、图例、标签、间距、外框、字体 | palette 只从 theme.colors 产生；布尔 total 被转字符串；seriesDefaults 入库前展开 | 每图独立 palette；所有 chart 字段原样；已展开 defaults 不再重复保存 |
| fill solid/linear/radial/image，所有宿主；shadow 数组与 border | 有限正向支持，无完整反向转换 | 复用 v4 词表；仅语义 src 字段映射 asset↔media |
| theme/style 引用、seriesDefaults | 属作者语法而非可编辑 canonical，导入后不再存在 | v2 原解析继续；v3 写解析后的 literal；不尝试恢复 YAML 排版、注释、别名和主题键 |
| undo/redo、选区、运行时状态 | 不属于文档字段 | 对 undo/redo 后 snapshot 往返，不保存编辑器历史/临时选区 |

## 逐能力行索引

下表列出冻结矩阵全部 active 行的 canonical 落点。对应可执行验证统一位于 packages/design-authoring/tests/roundtrip.test.ts；测试逐类覆盖字段并深度比较文档，能力清单还检查冻结 active 行覆盖，往返结果深度全等，不以“serializer 已输出”作为成功信号。测量与图片 pipeline 行仅验证模型/字节保留，不声称重测浏览器渲染。

| 能力 | 当前 canonical 字段 |
| --- | --- |
| canvas.size | canvas.{width,height} |
| canvas.background | background（Fill 联合：solid/gradient linear·radial/image） |
| common.elementId | elements[].id |
| common.elementType | elements[].kind（v4 词表 7 型：text/shape/line/image/icon/table/chart） |
| common.bounds | elements[].bounds |
| common.zOrder | elements[].zIndex（数组序显式化，沿用 v3） |
| common.rotation | elements[].rotation（v4 ElementBase 新增；度/顺时针与 PPTD 同向零换算） |
| common.opacity | elements[].opacity（v4 提升为 ElementBase 字段，含 text） |
| common.flip | elements[].flip（v4 ElementBase 新增 [水平,垂直] 布尔对） |
| common.group | elements[].groupId（v4 ElementBase 新增；仅扁平 group，嵌套具名拒绝） |
| common.createDelete | elements[] 数组成员增删（kernel create/delete 命令；无独立持久化字段） |
| common.color | 各宿主 Color 字段字面值（HEX6/HEX8；宿主见 pptdPath） |
| common.theme | derived:import 期 $ref 解析为宿主字面值（canonical 不落 theme 块，运行期不联动） |
| common.styleInheritance | derived:import 期按 PPTD §1 优先级链解析为宿主字面值（lineHeightPx 语义随 C1） |
| common.border | elements[].border（宿主：shape/line/image/icon；table/chart 外框 border） |
| common.shadow | elements[].shadow（v4 提升为 ElementBase 字段，含 text） |
| text.plain | elements[].text.paragraphs[].runs[].text（v4 text 内容结构化为 paragraphs[]/runs[] 模型） |
| text.paragraphs | elements[].text.paragraphs[] |
| text.lineBreak | elements[].text.paragraphs[].runs[].text 内段内换行 |
| text.runs.color | elements[].text.paragraphs[].runs[].color |
| text.runs.fontSize | elements[].text.paragraphs[].runs[].fontSize |
| text.runs.fontFamily | elements[].text.paragraphs[].runs[].fontFamily |
| text.runs.backgroundColor | elements[].text.paragraphs[].runs[].backgroundColor |
| text.bold | elements[].text.bold（元素级缺省）+ elements[].text.paragraphs[].runs[].bold |
| text.italic | elements[].text.italic（元素级缺省）+ elements[].text.paragraphs[].runs[].italic |
| text.underline | elements[].text.paragraphs[].runs[].underline |
| text.strikethrough | elements[].text.paragraphs[].runs[].strikethrough |
| text.superscript | elements[].text.paragraphs[].runs[].baselineShift="sup" |
| text.subscript | elements[].text.paragraphs[].runs[].baselineShift="sub" |
| text.hyperlink | elements[].text.paragraphs[].runs[].href（https/http/mailto） |
| text.lists | elements[].text.paragraphs[].list（ordered/marker/indent 结构保真） |
| text.listItemStyles | elements[].text.paragraphs[].list item 级样式覆盖（与 text.lists 同落点、共享 renderer） |
| text.latex | elements[].text.paragraphs[].runs[].latex（import 期 \(...\) 分隔符映射为 latex run） |
| text.color | elements[].text.color |
| text.fontSize | elements[].text.fontSize（1px=1pt） |
| text.backgroundColor | elements[].text.backgroundColor |
| text.lineHeight | elements[].text.lineHeight（倍数；与 lineHeightPx 互斥） |
| text.lineHeightPx | elements[].text.lineHeightPx（固定 px，优先于 lineHeight；adapter 设像素行距，measure 同路径） |
| text.letterSpacing | elements[].text.letterSpacing |
| text.marginTop | elements[].text.marginTop |
| text.align | elements[].text.align（[水平,垂直]；justify/distributed 由 adapter 显式设置） |
| text.paragraphAlign | elements[].text.paragraphs[].align |
| text.paragraphLineHeight | elements[].text.paragraphs[].lineHeight（倍数或 px） |
| text.paragraphMargin | elements[].text.paragraphs[].margin |
| text.textDirection | elements[].text.textDirection（horizontal/vertical） |
| text.wrap | elements[].text.wrap |
| text.gradient | elements[].text.gradient（linear 原生；radial 随 fill.gradientRadial svg 载具） |
| text.shadow | elements[].shadow（text 宿主，随字形 alpha；与 common.shadow 同字段） |
| font.familyUniform | 宿主 fontFamily 字面值（elements[].text.fontFamily / table cell / chart TextStyle；栈含 fallback 列表） |
| font.familyLatinEa | 宿主 fontFamily {latin,ea} 对象（v4 FontFamily 联合；投影拼栈 + 两 face 登记时 unicode-range 切片） |
| font.registration | fonts[]（v4 文档级新增：family+src asset 登记） |
| font.fallback | derived:fontFamily 栈序渲染期逐字形回退（无独立持久化字段） |
| font.measurement | derived：渲染/measure 运行期确定性（同运行+跨运行可重现；不持久化） |
| shape.preset | elements[].shapeName（v1 支持集=OOXML 几何表已建模子集；其余具名拒绝） |
| shape.adjustments | elements[].adjustments（投影期几何编译参数，并入 preset 表） |
| shape.customPath | elements[].shapeName="custom" + elements[].viewBox/path（import 规范化：近重合整圆 A 弧确定性重写为半圆弧对） |
| line.points | elements[].viewBox + elements[].points |
| line.curve | elements[].curve（sharp/round/smooth） |
| line.arrow | elements[].arrow（[start,end]；arrow/stealth/diamond/oval/null） |
| image.src | elements[].src（import 期固化为 asset:） |
| image.fit | elements[].fit（fill/contain/cover） |
| image.crop | elements[].crop（v4 四边比例 [l,t,r,b]，负值 outset；取代 v2 归一化矩形与 D101 丢弃） |
| image.cropShape | elements[].cropShape（v4 新增 ShapeDef；svg clip-path/mask 承载） |
| image.pipeline | derived:crop→fit→cropShape 固定渲染次序（次序约定，不持久化） |
| icon.name | elements[].iconName（adapter FA 货架解析 + svg 元素承载） |
| table.grid | elements[].table.columnWidths/rowHeights + rows[][]（v4 新增 table 元素类型） |
| table.cellText | elements[].table.rows[][].text（结构化富文本，同 text 元素 paragraphs/runs 模型） |
| table.cellTextStyleRef | derived:import 期 $ref 解析为 cell 文本字面值 |
| table.cellTextProps | elements[].table.rows[][].{color,fontSize,fontFamily,bold,italic,backgroundColor,lineHeight,lineHeightPx,letterSpacing,marginTop} |
| table.cellFill | elements[].table.rows[][].fill |
| table.cellBorder | elements[].table.rows[][].border（BorderSpec 单边/两边/四边/null 清除） |
| table.cellAlign | elements[].table.rows[][].align |
| table.merge | elements[].table.rows[][].rowSpan/colSpan（adapter 格网模型 + 真合并渲染） |
| table.styleRef | elements[].table.style（import 期 $ref 已解析为内联字面值） |
| table.styleSlots | elements[].table.style.{cellStyle,firstRowStyle,lastRowStyle,firstColumnStyle,lastColumnStyle} |
| table.bodyStylesCycle | elements[].table.style.bodyStyles |
| table.rowOverColumn | elements[].table.style.rowOverColumn |
| chart.data | elements[].chart.data（cols/rows 表模型 + 五类完整性校验；v4 新增 chart 元素类型） |
| chart.encode | elements[].chart.series[].encode |
| chart.seriesDefaults（derived：v2 导入后已展开，不持久化） | elements[].chart.seriesDefaults（import 期一层深合并物化） |
| chart.typeMixing | elements[].chart.series[].type（§5.4 混排词表约束；adapter renderer 全集混排） |
| chart.axisBasic | elements[].chart.{xAxis,yAxis} |
| chart.axisLabel | elements[].chart.{xAxis,yAxis}[].label |
| chart.axisLineGrid | elements[].chart.{xAxis,yAxis}[].{axisLine,gridLine} |
| chart.axisSecondary | elements[].chart.{xAxis,yAxis} 数组形式 + series[].{xAxisIndex,yAxisIndex}（v1 仅副 y 轴） |
| chart.spokeAxis | elements[].chart.spokeAxis（随 chart.radar renderer 自绘） |
| chart.barLayout | elements[].chart.{barWidth,barGap,categoryGap} |
| chart.title | elements[].chart.title（投影为 frame 上方原生 text 元素） |
| chart.legend | elements[].chart.legend |
| chart.dataLabels | elements[].chart.dataLabels + series[].dataLabels |
| chart.bar | elements[].chart.series[]（type=bar：stack/symbol/fill/border） |
| chart.line | elements[].chart.series[]（type=line：smooth/lineStyle/marker/nullHandling/lineColor） |
| chart.area | elements[].chart.series[]（type=area：stack/areaColor 派生物化） |
| chart.scatter | elements[].chart.series[]（type=scatter：marker/dataFilter；混排约束随 chart.typeMixing） |
| chart.bubble | elements[].chart.series[]（type=bubble：size 通道/sizeScale/sizeRange） |
| chart.candlestick | elements[].chart.series[]（type=candlestick：OHLC encode/upBars/downBars/wickStyle） |
| chart.pie | elements[].chart.series[]（type=pie：innerRadius/startAngle/fill 数组；startAngle=90° native，≠90° adapter renderer） |
| chart.radar | elements[].chart.series[]（type=radar：多 series 共享 spoke） |
| chart.waterfall | elements[].chart.series[]（type=waterfall：isTotal 列/三色映射） |
| chart.heatmap | elements[].chart.series[]（type=heatmap：colorScheme/colorScale/colorbar） |
| chart.treemap | elements[].chart.series[]（type=treemap：parent 层级/levels；fill 逐层派生物化） |
| chart.sunburst | elements[].chart.series[]（type=sunburst：parent 层级/levels） |
| chart.sankey | elements[].chart.series[]（type=sankey：source/target/flow DAG/nodeAlign） |
| chart.palette | elements[].chart.palette（v4 新增：import 期物化的颜色循环字面值数组） |
| fill.solid | 宿主 fill 字段 SolidFill（background/elements[].fill/table cell/chart 外框） |
| fill.gradientLinear | 宿主 fill GradientFill linear（import 期 (pptd+90)%360 角度换算） |
| fill.gradientRadial | 宿主 fill GradientFill radial（v4 BentoFill 扩展；svg 载具渲染） |
| fill.image | 宿主 fill ImageFill（v4 BentoFill 扩展；全宿主 background+shape/table/cell/chart；background 可 CSS 串、shape 等 frame 内 adapter DOM，路线 GD-4b 投影设计定） |

## 验证和限制

确定性 fixtures 使用仓库已有合成 PNG、已登记许可的 Space Mono 字体字节及人工构造数据，不含用户文件或 Agent 对话。`roundtrip.test.ts` 的 72 项用例实际执行 exportPptd → YAML 字节快照 → 既有 intakeAuthoring → BentoDoc；逐字段深度全等，重新导出的字节也相等，素材按 hash 与原字节比较。参数化案例包含全部 13 图表类型；字段覆盖还与 BENTO_DOC_V4_FIELDS 对照，遗留 chart 顶层 fill 虽无 UI writer 也保留并校验。21 类未知嵌套字段、非法路径/素材、重复 ID、无效 crop/table/chart 均被明确拒绝。

旧 PPTD v2 的主题、HTML 富文本和 seriesDefaults 先由原导入器解析；随后用实际 kernel 设置分组、多阴影、图表 palette 和层顺序，再分别验证编辑后、undo 后及 redo 后的往返。旧 Bento schema 1/2/3 则经原 migration 后往返，历史 diagnostic 保留，输入旧文档不改写。共享样式对象先按原 src 映射，再禁用输出 YAML 别名，避免重复改写或 128 格表格触发 YAML alias 扩展上限。非 JSON 数据明确拒绝，不由序列化静默省略。

`corepack pnpm --filter @folio/design-authoring test`：3 文件、91 测试通过（本票新增 72）。`typecheck` 和定向 type-aware lint 通过；authoring build 重新生成矩阵嵌入及 skill bundle，Bento source-manifest 所有源 SHA 校验通过。`corepack pnpm format` 已运行并撤回一处无关 Electron 格式改动。`corepack pnpm run docs check` 通过，21 条既有大小警告，无 SHA-protected topic。

全仓 `corepack pnpm check` 通过（exit 0）：包括 typecheck、type-aware lint、test:ci、i18n、code-collab imports、platform/public boundary；其中 components 446 文件通过、CLI 274 文件通过/1 文件跳过。最终局部增补后又运行 authoring typecheck、91 项测试及定向 lint，均通过。仅在检查子进程环境中过滤 ANTHROPIC_* / CLAUDE_CODE_USE_*；没有修改用户全局配置。独立 worktree 使用自己的 node_modules；为全仓检查初始化公开 ACP 子模块，Kimi 仅初始化源码以解析既有文档链接，未安装或并入根 workspace。

没有启动 Electron renderer、真实 Agent 或 hook；本票没有改渲染器，数据深度全等保证同一渲染输入，不等同于像素或视觉质量验收。仅提供按需内存投影，不在本票连接 workspace 写入、只读生命周期或文件 hook。这些集成由后续独立任务负责。
