# 选区悬浮属性栏与自由画布多画板技术调研

Status: proposed
Date: 2026-09-17
Translation: pending

## 摘要

当前画布已有按元素类型直接修改属性的控件，但控件位于固定顶部区域，文档仍只表达一个有限画布。要实现选区附近的悬浮栏，可以复用现有命令，把定位和控件呈现放到 Bento 所在的 WebContents 内；要实现自由摆放的多张设计，则需要统一视口和明确的画板文档语义。建议优先验证保留 Bento 渲染、元素模型和保存链路的增量路线，原生多画板采用同一作品内的 canonical 扩展，不同时引入另一套可编辑场景存储。初轮记录是源码与官方资料调研；第一任务随后获准实施，实施和验证结果见文末；多画板超出现行已批准单画布范围。

## 问题和范围

目标拆为两项：选中对象后在其附近显示可直接操作的属性栏；同一可平移、缩放的工作区摆放不同尺寸的设计画板，每个画板内仍可编辑元素。这里将“多组图”解释为多张有独立边界、背景和导出尺寸的设计，而非仅在一张海报上增加多个图片元素。

截图能说明需要的视觉结构，不能证明其产品使用了哪种引擎，也不能证明跨画板多选、关联尺寸自动重排或品牌主题同步已经存在。本次不把这些能力连同评论、链接、动画、品牌库一起纳入建议首期。

相关决策：现有[类型化属性栏](../../implemented/feature/2026-09-16-canvas-typed-selection-bar.zh.md)、[单文件画稿](../../implemented/architecture/2026-09-15-single-canvas-authoring-redesign.zh.md)、[范围审查](../simplification/2026-09-11-design-result-feedback.zh.md)。本提案在获批后才可能局部取代单画布范围，不覆盖已有保存、草稿、Agent 串行编辑和 Git 历史决定。[当前 Spec](../../../../specs/graphic-design-platform.zh.md) 明确排除多画板；后续第一任务实施同步更新 Spec 的选区工具栏要求，单画布范围保持不变。最新 `72bdded4` 已因命名合同修订将 Spec 改回 draft，见[命名记录](../../implemented/feature/2026-09-17-molly-namespace-convergence.zh.md)。

## 本地实现证据

初轮检查基线为 `66e58ce0` 加当时工作树。开始时已有其他任务修改 `design-canvas.tsx`、Electron 设计服务及视觉刷新笔记，均不覆盖；以下是源代码证据，不代表已安装版本实测。后续按 `72bdded4` 复核第一任务，结论及修订方案见下文「最新代码复核」。

| 能力       | 当前事实                                                                                                                                                                                                                   | 与目标的差量                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 属性直改   | [原类型化属性栏记录](../../implemented/feature/2026-09-16-canvas-typed-selection-bar.zh.md) 有文字、图形、线条、图片等类型控件；[共享命令](../../../../packages/shared/src/design-selection-commands.ts) 经校验进入 kernel | 可以复用语义；需要新的悬浮呈现和焦点处理                                              |
| 工具栏位置 | [design-canvas.tsx](../../../../packages/components/src/components/sessions/design-canvas.tsx) 在固定 `h-12` 区域渲染 pill                                                                                                 | 尚非跟随选区的屏幕坐标浮层                                                            |
| 编辑手势   | [Bento Canvas](../../../../packages/design-bento/bento/slides/src/editor/canvas.ts) 已用 Moveable、Selecto 实现选择、框选、拖动、缩放、旋转；空格/中键拖动和缩放也已有                                                     | 现有 `relayout` 围绕单个 stage 的 fit-scale、滚动和边缘 padding；不是通用二维无限视口 |
| 选区通信   | [product-session.ts](../../../../packages/design-bento/src/product-session.ts) 将属性摘要经 150 ms trailing 上报 shell；摘要无屏幕坐标包围盒                                                                               | 不适合复用为逐帧定位通道；同 WebContents 本地计算更直接                               |
| 文档结构   | [BentoDocV4](../../../../packages/design-bento/vendor/packages/contracts/src/bentodoc-v4.ts) 只有一个 `canvas`、一个 `background`、平铺 `elements`，`groupId` 是扁平分组                                                   | 没有 artboard 的身份、位置、独立尺寸/背景、元素归属；group 不等于画板                 |
| 视图投影   | [projectToBentoNative](../../../../packages/design-bento/vendor/packages/editor-bento/src/project.ts) 固定输出单个 `a1a2-s1` slide                                                                                         | 上游出现 slides 不代表 Molly 支持多画板；原生输出还使用文档级 size                    |
| YAML       | [canvas-format.ts](../../../../packages/design-authoring/src/canvas-format.ts) 接受 `size/elements` 并明确拒绝 `pages`                                                                                                     | 不能只在 UI 添加多个舞台后声称保存和 Agent 编辑已支持                                 |
| 导出与宿主 | [design-service.ts](../../../../apps/electron/src/main/services/design-service.ts) 创建沙盒 WebContentsView；导出选择单个 `.ed-stage-scale .bento-slide` 并核对画布尺寸                                                    | 需要按画板选择目标，保留同渲染路径、字体/素材就绪和保存确认                           |

文字属性命令目前是整元素修改：[web-product-session.patch](../../../../packages/design-bento/patches/web-product-session.patch) 的 `text-style` 会通过 `setText` 设置字段并清除 runs 上同字段的覆盖。若未来要求只改选中文字片段，需要保留 Range、映射富文本 runs 并定义提交边界，不能由“已有文字工具栏”推导为已支持。

## 选区悬浮栏：建议路线

悬浮栏放进 Bento 所在的同一个 WebContents，作为缩放内容层的兄弟 overlay，保持屏幕像素尺寸。选区变更、变换、视口平移/缩放、窗口 resize 时，从实际选中 DOM 或变换后的包围盒计算锚点。旋转与多选使用屏幕空间包围盒；边缘自动翻到下方并限制在可见区域。拖动时隐藏或低成本跟随，松手后恢复，具体交互需原型验证。

可用 [Floating UI virtual elements](https://floating-ui.com/docs/virtual-elements) 将自定义选区矩形作为锚点，使用 [flip](https://floating-ui.com/docs/flip) 与 [shift](https://floating-ui.com/docs/shift) 处理边缘。[autoUpdate](https://floating-ui.com/docs/autoupdate) 支持滚动、resize 及可选逐帧更新；虚拟矩形或 transform 改变时应主动触发，不能假设普通 DOM resize 观察能覆盖所有画布手势。仅在悬浮栏挂载期间监听并正确清理。

外层 React 与画布不在一个 DOM stacking context。[Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) 是原生 View，[View](https://www.electronjs.org/docs/latest/api/view) 有自己的父子层级和排序。结合本地 `owner.contentView.addChildView(view)` 与现有弹层隐藏画布的处理，可以判断外层 CSS `z-index` 不是跨原生 View 叠加的方案。这是根据 API 和本地代码得出的工程判断，本次未另做平台叠层实验。

可复用的是控件行为、样式规格和共享命令映射；当前 pill 依赖主 React 应用，不能假装可零成本搬入独立 Bento 构建。画布内实现薄控件，避免复制另一套属性语义；命令经下文所述宿主适配复用现有校验、readonly guard、kernel batch、undo 和 autosave。引用到对话/AI 动作继续经宿主转发。工具栏不持有 Agent 生命周期。

交互验收还需覆盖点击控件不清空选区、文字输入法 composition、键盘与 Escape、popover 焦点返回、不同缩放下字号不变、readonly 后所有入口拒绝修改，以及快速切换选区不会把尚未提交的颜色/字号写到另一对象。

### 最新代码复核：第一任务（2026-09-17，`72bdded4`）

结论：**保留画布内悬浮层的方向，更新实现拆分和命令接入；最新代码尚未实现跟随选区的工具栏。** `2b0944a7` 已提交重挂载、选区恢复与外部弹层修复，`72bdded4` 完成命名收敛。前者部分代码在初轮工作树中已经存在，不能把全部内容描述成初轮之后才新增。新增判断来自精确 diff、当前消费者和构建装配核对，未重跑他人任务的 UI 验收。

| 最新事实                                                                                                                                        | 方案调整                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-canvas.tsx` 使用 `hostId = sessionId`，隐藏视图在主进程保留；属性栏仍位于 `h-12` 区域                                                   | 工具栏跟随原生文档实例创建和保留，不能绑到 React 每次挂载；正式切换时移除旧 pill 的固定占位，保留宿主 resize/attach                                         |
| 主进程有 `lastSelectionSummaries` 与 `design.selectionSummary`，shell 重挂载时补选区                                                            | 缓存继续服务 composer 的选中引用恢复，不能随旧 pill 一起删除；画布内浮层使用实时选区，不用延迟缓存计算坐标                                                  |
| 外部 overlay 只有与 host 矩形相交才隐藏画布；旧 pill 弹层以 `data-design-canvas-overlay` 豁免                                                   | 保留外部弹层几何守卫；新浮层和颜色/字体弹层必须全部在画布内部，旧豁免标记不是跨 WebContents 叠层能力                                                        |
| 最新视觉笔记记录了外层 absolute pill 被原生画布盖住的实际尝试                                                                                   | 同 WebContents 路线获额外既有证据支持；本轮仍不冒称自己做过这项 UI 实测                                                                                     |
| pill 依赖 React、i18next、应用 UI 组件、Tailwind tokens；Bento 构建在临时 checkout 里装配纯 DOM 编辑器                                          | 推荐画布侧独立薄 DOM 工具栏，复用控件规格和命令；不要直接把整个 `@molly/components` 引入 Bento，也不恢复隐藏的旧属性面板                                    |
| `DesignCanvasCommandSchema.parse` 在 `applyDesignCommand` 主进程入口；`window.molly.applyCommands` 自身只有本地 readonly/commitPending/错误处理 | 修正初轮过于笼统的“直接复用”：画布新按钮若直接调本地函数，会绕过现有这层 Zod 校验及宿主状态查询。建议复用宿主命令入口，不能仅凭 TypeScript 类型声称边界等价 |
| 自有包已改为 `@molly/*`，YAML 新写 `molly-canvas/1` 并兼容旧名称                                                                                | 新代码/构建使用新包名；第一任务不修改文档格式，旧稿兼容性保持                                                                                               |

证据：[最新视觉及生命周期记录](../feature/2026-09-16-monochrome-chrome-visual-refresh.zh.md)、[画布 shell](../../../../packages/components/src/components/sessions/design-canvas.tsx)、[命令和选区主进程服务](../../../../apps/electron/src/main/services/design-service.ts)、[Bento 产品桥](../../../../packages/design-bento/src/product-session.ts)、[资源构建](../../../../packages/design-bento/scripts/build.mjs)。

修订后的最小实施方案：

1. **画布负责 UI 和位置。** 在 `packages/design-bento/src/` 增加独立工具栏模块，由 product-session 装配到缩放层外；保留当前类型化控件、混合选区回退、图片裁剪/位置入口及 AI 动作，不把改位置变成能力删减。控件样式沿用最新单色规格；语言和所需主题值由宿主提供最小呈现配置，不能假定主应用 CSS/i18n 会自动穿透隔离视图。Floating UI 仍是可选定位辅助，第一任务不需要 Infinite Viewer 或多画板依赖。
2. **几何与内容更新分开。** 现有 `selection(elements, summary)` 增加本地消费，继续原有 150 ms shell 上报。几何更新在画布内读取选中 DOM 的屏幕包围盒，选中、拖动/旋转/缩放、scroll、resize、重显示和视图重投影时合并到 animation frame；不要把 DOM 重建前的节点永久缓存，也不要因属性刷新重建正在输入的控件。移动几何不触发新的文档修改或 composer 引用捕获。
3. **属性命令继续走现有宿主检查。** 给当前隔离视图已有的同源协议增加窄的属性命令入口（路由名待实施确定），服务端用创建视图时闭包绑定的 Session/host 找到活实例，转调 `applyDesignCommand`；按既有策略限制载荷、校验命令并返回真实成功/错误。保留本地 readonly 和 kernel 拒写作为执行时检查；不开放 Node/preload、任意 IPC 或外部网络。只在用户提交属性时跨进程，逐帧定位不跨进程。另一条路线是把同一校验器打包到画布，但须额外核对宿主预检等价性，本轮不优先采用。
4. **引用和 AI 动作有单独的窄转发。** 当前 `emit()` 仅在 embedded parent 场景有效，普通 Electron 没有 parent，不能直接套用 `postMessage`。通过绑定 host 的同源动作入口和定型事件转给 shell，复用 `selectionAction/referenceSelection` 与 `getDesignSelection` 的 flush、保存版本和元素验证，再填入普通 composer。只转发受支持的动作；隐藏/旧实例或切换会话后的迟到请求丢弃或报错，不直接触发模型任务。属性输入草稿/异步动作绑定发起时的选区身份，目标改变即取消或报错；这是临时交互保护，不新增持久证明机制。
5. **生命周期和手势收尾。** 同一原生文档隐藏再显示时保留有效选区并重新定位；切到历史/预览或 readonly 时关闭可修改弹层并阻止提交；恢复历史/新稿重建时清理旧监听、pending 请求和弹层。为工具栏及其所有弹层建立统一的 UI 命中排除，接到画布选择、文本编辑和快捷键入口；现有 Canvas 的 document capture `mousedown` 处理意味着仅在按钮 bubble 阶段 `stopPropagation` 不足以保证文字/选区不受影响。继续允许输入框编辑和正常焦点操作。

主链路为：`画布内控件 → 同源宿主命令适配 → 现有 applyDesignCommand → window.molly.applyCommands → kernel → 自动保存`；位置更新全程在画布内。完成替换后退役外层 pill 呈现及其专属代码，保留选区上报、缓存、composer 镜像和宿主遮挡保护等仍有消费者的部分。

实施验收应复用已有属性行为用例，补充真正跨 WebContents 的集成验证：重挂载后选区/缩放/工具栏保留；缩放和边缘定位；外部侧栏 hover 不误隐藏；字体/颜色/裁剪弹层可点；文字及输入法编辑；旧选区的延迟提交不会改新对象；Agent 只读、预览/历史切换和异步错误；属性修改、一步撤销、保存重开/YAML 往返及导出不包含工具栏。现有 receipt/source-preview 测试只新增了 `selectionSummary` mock，不能视作悬浮定位或新动作链路已验收。

本次只更新研究笔记，未实施上述入口、控件、格式或测试；未重新调用外部 SDK 调研，也未运行原型/运行时测试。`pnpm run docs status` 的初轮翻译缺失错误已经由其他任务修复；本轮 `pnpm run docs check` 通过，0 errors、18 条既有体积 warnings、无已注册 SHA topic，单文件 Prettier 检查通过。

### 第一任务的截图与视觉验收（必需）

用户在方案讨论中明确要求：除常规测试外，必须有选中不同元素后的 UI 截图评估视觉效果。以下作为第一任务的必需验收范围，不能用 DOM 属性断言、Storybook 截图或构建成功替代。当前只明确测试方案，尚未实施或执行截图验收；这项要求不构成多画板或运行时实现的额外授权。

**常规测试与视觉验收分别报告。** 常规部分覆盖定位计算、命令参数和只读拒写、属性修改与一步撤销、保存重开和 YAML 往返、引用/AI prompt 转发、重挂载及选区变化时的迟到请求。视觉部分必须在实际构建的 Electron 应用中，用正常 Session 路由打开合成画稿，实际点击/框选元素并打开控件，再采集和阅读截图。测试素材使用离线合成图片和已打包字体，不依赖模型生成、远程资源或真实用户文档。

#### 最低元素截图矩阵

每种单元素类型都必须有亮色、暗色两张基础截图，完整展示选中对象、选区框和工具栏；表格与图表分别检查，不能只用一张混合选区截图代替。当前能力下，表格/图表显示通用动作组，不由此次视觉验收顺带增加类型专属编辑功能。

| 选中场景                   | 必须观察的 UI                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| 文本                       | 字体、字号、颜色、粗斜体、对齐及位置控件；长字体名、当前值和选中态可读                          |
| 图片                       | AI 动作、填充方式、裁剪、位置；较长工具栏的密度与可达性                                         |
| 图形                       | 填充、描边、宽高、位置；无填充与颜色的表达清楚                                                  |
| 线条                       | 描边、箭头、位置；横线/斜线选区附近的工具栏定位                                                 |
| 图标                       | 填充及位置；控件较少时仍有合理宽度和对齐                                                        |
| 表格                       | 通用动作回退正确，无残留的文本/图形专属控件                                                     |
| 图表                       | 通用动作回退正确，工具栏不与图表内容混淆                                                        |
| 同类型多选                 | 至少两段样式不同的文本；联合选区锚定、计数、当前值呈现符合现有语义，不冒称已有 mixed-value 支持 |
| 混合类型多选               | 文本 + 图片/图形；计数、通用动作和联合包围盒定位                                                |
| 成组元素                   | 通过现有分组选择得到的工具栏和包围盒；不把分组当画板                                            |
| 超过 8 个元素              | 当前摘要上限触发回退后的工具栏，无旧类型控件残留                                                |
| 无选区、只读/历史/源码预览 | 工具栏按设计隐藏或禁用；不保留可操作弹层或旧选区内容                                            |

后五类扩展场景至少各留一张实际截图；无选区、Agent 只读、历史、源码预览分别留证。无需做所有元素 × 所有状态的笛卡尔积，但以下边界必须用代表性元素覆盖，并说明选用的 fixture。

#### 弹层、位置和状态截图

- 颜色板、字体菜单、图片填充方式、图片裁剪、线条箭头菜单均需实际打开后截图；每种至少一个亮色和一个暗色实例。检查弹层与工具栏、选区和原生画布的层叠关系，不能出现弹层打开后画布消失。
- 上边缘、下边缘、左右角落，以及选区部分离开视口：验证翻转、侧向避让和边界处理。完全离开视口时不得显示与对象失去关联的旧浮层。
- 代表性文本/图片在 50%、100%、200% 显示缩放下截图：按钮的屏幕尺寸稳定，选区和工具栏距离合理；文档允许的界面缩放若无法精确设置，以实际值记录，不能伪造标签。
- 宽窗口和窄画布面板，至少覆盖一个中文、一个英文界面；特别检查最长工具栏和最长下拉选项，所有操作保持可达，不挤压成难以辨识的图标或文字。
- 悬停提示、键盘焦点、按下/选中态、busy/禁用态以及可见错误提示，用代表性控件截图。颜色或字号修改至少保留修改前、修改后及撤销后的截图，评估画布实际外观是否随值变化。
- 切换标签/面板后返回、打开不覆盖画布的侧栏 hover 卡、打开真正覆盖画布的外部菜单：分别留证，核对最新生命周期和遮挡行为没有回退。拖动/缩放过程的抖动另以实际交互观察或短录屏检查，静态截图不能证明运动平滑。

#### 截图采集和逐图评估

1. 每张截图关联源码/构建身份、fixture、元素 ID/类型、选区数量、窗口/画布尺寸、主题、语言、缩放和操作步骤。主证据使用包含 shell 与原生 WebContentsView 的最终合成应用窗口截图；确认采集方式确实包含原生子视图。单独画布截图和工具栏局部图可辅助查看，不以画稿导出图替代 UI 截图，也不拼贴不同时间的两个视图冒充实际窗口。
2. 等待真实的画布 ready、字体/图片就绪、选区和工具栏状态及定位完成信号；不使用固定 sleep 猜测稳定。fixture 和操作步骤固定，避免以机器时序碰运气。
3. Agent 必须实际打开并逐张查看截图，记录「通过 / 需修改 / 待人工判断」及对应图片和具体原因。至少评估：与选区关联是否清楚、是否遮挡文字/关键内容或操作手柄、间距和对齐、控件密度和可读性、当前值/交互状态辨识、明暗主题一致性、弹层裁切/溢出以及整体是否贴合参考图的交互意图。
4. 提供按元素类型和状态组织的截图索引或联系表，以及简短视觉评估清单。发现问题后修正并重拍相关场景，保留前后对照；不能只提交截图目录而不做评估，或自动更新截图基线来掩盖缺陷。原始截图不修饰，展示裁切图时保留原图链接。
5. 截图使用本地验收产物目录，遵循仓库既有产物约定，不提交真实用户内容或会话记录。像素差异检测可辅助发现回归，首次实现仍需真实看图；结构/点击测试通过不等于视觉通过。

**完成条件：** 必需截图场景齐全，Agent 已完成逐图评估并处理明确的遮挡、裁切、不可读和错误状态问题，向用户提供可直接查看的截图及剩余差异；视觉通过由人工判断确认。尚未确认时标为「功能验证通过，视觉待审核」，不把 Agent 的意见当作人类批准，也不以视觉通过替代常规行为验证。

## 多画板：三个真实选择

| 路线                               | 适用情形                                                     | 代价与判断                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 多个独立作品并排浏览，激活一个编辑 | 主要需求是对比多个现有作品，保留各自会话/历史                | 文档改动较少，但仍要实现工作区视口和激活逻辑；不提供同一作品的跨板操作和统一提交。应使用现有渲染生成临时视图，不恢复持久缩略图系统。只有用户接受这种语义时采用 |
| 同一作品内原生多画板，保留 Bento   | 同一组设计包含方图、4:5、9:16 等版式，并希望直接在各板内编辑 | 与目标更吻合，推荐作为正式产品方向；需要 canonical、YAML、命令/历史、导出和 Agent 定位的协调扩展                                                               |
| 更换完整编辑 SDK                   | 产品准备同时重做编辑器、文档和集成边界                       | 可获得成熟工作区能力，但失去现有无损往返和渲染验证的直接复用；不是本项目最小增量路线                                                                           |

把多个设计塞进一个超大单画布只能做视觉演示：没有独立导出、背景、裁切和画板身份，还混淆现有 4096 像素单板资源限制与工作区范围。不建议作为正式数据模型。

### 保留 Bento 的多画板结构草案

以下是待批准的职责草案，不是当前 API 或已选定字段格式：

```text
一个作品 / 一份版本化 canonical 文档
  画板 A：稳定 ID、名称、工作区位置、尺寸、背景、Bento 元素
  画板 B：稳定 ID、名称、工作区位置、尺寸、背景、Bento 元素
  文档所需字体和素材引用

一个 WebContents 中的统一视口
  世界内容层：各画板 DOM，复用 Bento 渲染
  屏幕 UI 层：选框/手柄、选区悬浮栏、画板标题与操作
```

1. **继续只有一个可编辑真相。** 正式支持时扩展/版本化 BentoDoc 的作品表达；画板内复用现有元素和单板校验，不引入可独立写入的 tldraw Store 或旁路 `boards.json`。旧稿作为一张画板迁移；如果用聚合容器承载现有单板 payload，该容器本身就是唯一 canonical，而非再保存一份内容副本。具体 schema 仍须审核。
2. **区分世界坐标与画板内坐标。** `screen = camera(worldPosition + boardLocalPosition)`；相机和选区属于临时视图状态，画板位置若需重开保留则属于文档。自由平移不意味着输出一个无限尺寸位图；单板导出尺寸限制可独立保留。现有只接受非负有限位置的控件合同不能直接用于世界坐标。
3. **单一交互所有者。** 同 WebContents 渲染多个 board root，共用相机、命中测试和选区路由；不要每张板开一套独立 WebContentsView 再拼统一框选。渲染函数可以复用，但当前单 stage 的 Canvas/Store/固定 DOM 标识需去除单实例假设，不能直接多次 new 后视作完成。
4. **元素和命令需明确归属。** 活动画板插入、`boardId + elementId` 定位或全局唯一 ID 方案必须一致；复用画板内 kernel 命令不自动获得跨板原子性。首个切片可以只开放板内选区，后续跨板移动需作为一个文档级批次同时更新归属/坐标、保留素材、一步撤销，不能用两个独立保存凑成一次移动。
5. **保留现有完成和保存边界。** 多画板作品仍作为一个当前稿执行版本检查、自动保存和 Git 历史；Agent 运行前 flush，执行及产物处理期间整件作品所有实例只读。Bento 仅接通用 readonly。YAML 继续单入口，但要升级格式并完整往返画板 ID、位置、尺寸、背景、元素、字体、素材，不在当前 `molly-canvas/1`（兼容读取 `geon-canvas/1`）偷加不兼容字段。外部预览/导入也必须捕获这一完整快照。
6. **逐板导出。** 保存确认后由同一渲染路径渲染目标画板，以其尺寸输出 PNG/JPEG；工作区缩放、画板世界位置、悬浮栏不进入产物。需要批量导出时再明确 UI/命名，不自动扩展到专业格式。

### 建议实施次序与验证门槛

按依赖拆为三个切片，不给未经原型测量的工期承诺：

1. 悬浮栏技术样例：一个已有作品，在真实 WebContents 内验证锚定、焦点、readonly、属性修改/撤销及导出不含 UI；这一项不依赖多画板格式。
2. 两到三块不同长宽比的自由工作区样例：复用渲染，验证平移/缩放、点选板内元素、画板标题、不同缩放精度及资源占用。该样例若没有保存往返，只能标为交互原型。
3. 经审核再实现原生多画板闭环：先 schema/迁移/YAML 往返，再接命令与历史、画板保存重开、逐板导出、Agent 修改指定画板、预览/导入、冲突与草稿保护。复制板需验证稳定身份与新 ID，删除板需可撤销，改一个板不能静默改变另一板。

性能验收必须用代表性图片与元素数量测量 frame time、输入响应和内存；优先按可见性减少渲染工作，并保护正在编辑的对象与文本焦点。没有测量前不承诺数百画板、无限素材或固定 60 fps，也不先引入 WebGL 重写。测试中的等待使用实际信号，不用真实 sleep。

## 外部技术选型

| 方案                    | 一手资料确认的能力                                                                                                                                                                                             | 对本项目的判断                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 现有 Moveable + Selecto | [Moveable](https://github.com/daybrush/moveable) 提供 DOM/SVG 变换、group、吸附；[Selecto](https://github.com/daybrush/selecto) 提供点击/框选/连选，两者 MIT                                                   | 保留。它们不负责文档和保存，恰好能继续使用 Bento 语义                      |
| Infinite Viewer         | [官方仓库](https://github.com/daybrush/infinite-viewer) 提供 DOM 无限滚动、缩放和多框架封装，MIT；[API](https://daybrush.com/infinite-viewer/release/latest/doc/InfiniteViewer.html) 有 scroll/zoom 控制       | 作为统一视口原型首个候选，与小型自有相机比较；不把库当作画板模型           |
| tldraw                  | [Camera](https://tldraw.dev/sdk-features/camera)、[Frame](https://tldraw.dev/sdk-features/frame-shape)、[Selection UI](https://tldraw.dev/examples/selection-ui) 覆盖平移缩放、带相对坐标/裁切的容器和选区浮层 | 技术上可行，但需要模型与编辑权归属适配；当前两项需求不足以抵消替换成本     |
| Polotno                 | [Tooltip](https://polotno.com/docs/tooltip) 提供邻近选区的属性 UI；[Workspace](https://polotno.com/docs/workspace) 提供 horizontal/vertical 多页布局                                                           | 排列式多页能力明确；任意二维位置和跨页统一选区未证实，且许可适配有实质疑问 |

Moveable 的 `zoom` 是控件缩放参数，不应当作完整相机；[API](https://daybrush.com/moveable/release/latest/doc/Moveable.html) 提供 `getRect/updateRect` 等接口，但要核对坐标基准。Selecto 官方指出默认包围盒对旋转目标不够精确，可通过 Moveable 的 `getElementInfo` 提供几何信息。多画板加入裁切后还需针对可见区域验证命中，不只检查元素原始矩形。

Infinite Viewer 的 [npm 元数据](https://registry.npmjs.org/infinite-viewer) 在调研日给出的 latest 为 `0.29.1`，发布于 2023-10-31；这仅是发布事实，不能据此推断无人维护。接入前验证负坐标、触控板手势、鼠标锚点缩放与 Moveable/Selecto 的事件竞争，再决定是否值得新增依赖。

tldraw 的 frame 应放在同一 page 才是同屏画板；多 page 切换不等于目标体验。[自定义 Shape](https://tldraw.dev/docs/shapes) 支持 `HTMLContainer`，但把整块 Bento 画板包成一个 shape 只解决外层操作，不自动让内部元素加入统一选区，且它有自己的 Store。官方[选区 UI 示例](https://tldraw.dev/examples/selection-ui) 在 `InFrontOfTheCanvas` 中用 `getSelectionRotatedScreenBounds()` 定位，是值得借鉴的结构；其[富文本](https://tldraw.dev/sdk-features/rich-text) 使用 TipTap/ProseMirror JSON，不能自动无损接替 Bento 文本。

许可也影响本地 OSS 产品的可采用性。当前 [tldraw 许可说明](https://tldraw.dev/community/license) 限制默认使用为开发用途，生产需要有效授权 key，且 OSS 下游也需各自授权；商业/hobby key 可离线验证，trial 存在向厂商发送 license hash 的行为。它不是可以无条件随 OSS 产品分发的 MIT SDK。当前 [Polotno SDK 协议 §2.3](https://polotno.com/legal/license) 限制竞争 editor/SDK/design platform 用途；对 Molly 不能假定购买普通订阅即足够，需要厂商明确适用授权后才值得进入落地比较。本次没有联系厂商或取得授权。

## 初轮验证与限制（`66e58ce0` 工作树）

- 本轮仅做本地源码及官方资料调研，新增此 proposed 笔记；没有改产品运行时、Spec、冻结 vendor/submodule、依赖或用户已有变更，也没有提交/发布。
- 未运行产品原型、UI 验收、构建或运行时测试；既有实现笔记中的测试结果不作为本方案验证。
- 开始时执行 `pnpm run docs status`：已有视觉刷新笔记将翻译标为 current、但缺少对应语言文件的错误，以及既有 AGENTS.md 体积警告；本次不改其他任务文件。
- 完成后 `pnpm run docs check` 仍只报告上述既有翻译错误，未报告本笔记错误；无已注册 SHA topic。本笔记已通过单文件 Prettier 格式检查。
- 英文翻译待补；外部文档核查日期为 2026-09-17，许可信息仅作依赖选型提示，不替代发布时对拟锁定版本与具体使用方式的核对。

## 第一任务实施授权与落地（2026-09-17）

用户在确认目标、边界和必需的 UI 截图验收后明确要求“开始实施”。授权仅覆盖选区悬浮栏；多画板仍为 proposed。代码将控制条和全部属性弹层迁入 Bento 的 `selection-toolbar.ts`，移除 shell pill 及占位行，保留全部既有控件和命令语义。shell 只传主题/翻译/动作可用性，并接收带已验证、已保存版本引用的窄动作事件；150 ms 摘要与主进程缓存继续服务 composer 重挂载。

同源 `/toolbar` 请求绑定创建它的隔离 session、host 和当前可见记录；输入经共享 schema 校验，进入既有 readonly 与 kernel 命令路径。临时选区 epoch 防止迟到操作命中新选区；几何不跨 IPC，不持久化。工具栏在 screen 坐标下避边，拖动/空选区/只读/完全离屏时隐藏，恢复后读取当前 DOM。输入焦点不因同一选区的属性回推重建；主题独立更新。

真实弹层测试暴露并修正了一个此前被 shell 工具栏位置掩盖的问题：自动同步选区引用会对干净画稿也进行冻结/flush，短暂 readonly 会关闭 native 弹层。现在全部同作品实例干净时复用已保存版本；自动镜像遇到 dirty/saving/composing 状态等待正常 autosave 后重新捕获，明确点击引用/AI 动作仍对所有实例执行原 flush。引用继续验证版本与元素。这不改变 Agent 执行串行编辑的屏障。

### 实施验证结果

第一任务功能验证通过，最终 61 张截图对应的悬浮栏实现已获人工视觉验收通过。Agent 已打开并逐图评估最终 61 张真实 Electron 合成窗口截图，未发现悬浮栏的明确错位、控件不可达或弹层被原生视图遮挡。窄栏采用横向滚动，实际 Tab 可使末尾控件滚入视口；贴上边界的颜色弹层会临时遮住部分文字。沿用底部 dock 与保存状态，在极贴底选区仍可能覆盖画稿角落，不属于新增悬浮栏。

- 完整桌面 `pnpm --dir apps/electron run build:app` 通过；包含最终原生 Bento 与 shell 构建。
- components 全套 389 文件、2892 用例通过；随后增加 autosave 上报用例，最终相关 4 文件、30 用例重新通过。共享命令 10 用例、Electron 139 用例通过。
- 最终受影响源码 type-aware lint、i18n、跨模块导入、platform/public boundary 检查通过。`pnpm run docs check` 通过，0 errors、18 条既有体积 warnings；`git diff --check` 通过。
- 全仓 `pnpm check` 的类型和 lint 阶段通过，随后受现有 `apps/cli/src/agent/acp-authentication.test.ts` 两个 Claude 凭据探测用例失败阻断；独立重跑同样失败，该代码和测试本次未修改。未将全仓检查表述为通过。
- 原生验收探针通过保存/冲突、撤销与重开、多实例、执行期 readonly、有效源码预览隔离及导出检查，记录在 `e2e/artifacts/selection-toolbar/native-probe/`。
- 真实窗口截图脚本 `pnpm --filter @molly/e2e exec tsx scripts/verify-selection-toolbar.mjs` 通过。最终目录为 `e2e/artifacts/selection-toolbar/1789625697971/`：`review.html` 提供原图入口及逐图评估，`visual-review.json` 保留每图结论，`report.json` 记录构建 hash、源码 HEAD、合成 fixture、运行时版本、选区、视口、实际缩放与坐标。原图未修饰；`*-detail.png` 和联系表仅为辅助裁切。
- 截图覆盖七类元素 × 明暗主题，五类弹层 × 明暗主题，长字体名、多选/成组/超过 8 个、busy/错误/焦点、粗体与字号修改/撤销、行内输入后打开弹层、50/100/200% 缩放、四角/部分及完全离屏、窄栏与中文标签、拖动隐藏恢复、重挂载/侧栏/外部菜单、历史/预览/空选区/只读及保存重开。相同文档有选区和无选区的导出 PNG 字节一致，YAML 往返元素一致。

限制如实保留：截图中的源码预览是 fixture 缺少 workspace design.yaml 的等待状态，有效预览由独立 native probe 验证；readonly 截图使用通用只读 API，实际执行期屏障由该 probe 验证。中文场景仅切换原生工具栏翻译，shell 保留英文。行内输入经真实 WebContents 输入验证，composition 生命周期由确定性用例覆盖，未进行真实中文输入法操作或连续帧率测量。AI 动作只验证现有引用/提示词入口，不调用模型。没有多画板实现、提交或发布；此次人工批准仅覆盖第一任务交付的悬浮栏视觉验收；多画板仍为 proposed，整体 Spec 仍为 draft。
