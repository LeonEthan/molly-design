# 选中即改：按元素类型分化的画布 pill 与属性直改通道

Status: implemented
Date: 2026-09-16
Translation: pending

## 摘要

上一轮 Lovart 化（[画布 UI 的 Lovart 化](2026-09-15-canvas-lovart-ui.zh.md)）留下的最大差距是：Lovart 的悬浮条内容随选中元素类型切换（图片=AI 动作组、图形=填充/描边/宽高、文本=颜色/字体/字号/对齐），而我们的 pill 对所有类型都是同一组 Agent 动作。用户拍板"仔细观察 Lovart 对选中不同元素的悬浮条内容差异，我们也要抄这一部分"，并在方案 A/B 中选择方案 A：pill 直接改属性，不经过 Agent。本次新增一条经过 zod 校验的属性直改通道（renderer pill → design IPC `applyCommand` → main 预检 → 画布 `window.molly.applyCommands` → 一个 kernel 批次 = 一步撤销），选区摘要反向从画布完整上报给 shell。文本/图形/线条/图片/图标五类单类型选中各有专属控件；混合、表格、图表或元素摘要缺失（>8 个）时回退到原有一组 Agent 动作。有意行为变化：文本/图形/线条/图标的单类型 bar 不再显示 4 个 AI 动作（引用到对话保留），属性直改是更快路径。

## 背景与问题

Lovart 截图显示三类悬浮条内容完全不同：图片是"快捷编辑/放大/去背景/橡皮/图层拆分/编辑文字/多角度/动态图片"AI 动作组；图形是填充色、描边、W/H 数值；文本是颜色、字体、字重、字号、对齐。用户明确要求按元素可编辑内容重新设计，而不是全部统一。

两个候选方案：A) pill 直接改属性（本次实现）；B) pill 只做类型分化的 Agent 动作（把"填充改红"也交给 Agent）。用户选择 A——属性编辑是高频低语义操作，走 Agent 又慢又贵。方案 B 的"类型化 prompt 预填"作为后续可选项记录，未实现。

## 实现地图

- 共享契约（新）：`packages/shared/src/design-selection-commands.ts`——`DesignSelectionSummarySchema`（count/kinds/elements≤8/fonts，elements 逐项携带该类型的当前值：文本 color/fontFamily/fontSize/bold/italic/alignH；图形·图标 fill（null=无填充，absent=非纯色）；图形·线条 borderColor/borderWidth；图片 fit；线条 arrowStart/arrowEnd）与 `DesignCanvasCommandSchema`（discriminatedUnion 六动词：text-style/fill/border/size/image-fit/line-arrow，全 .strict()）。子路径导出（同 design-element-reference 模式）。Electron push 通道 `design.selection` 载荷从 `{hostId, count}` 扩为 `{hostId} & DesignSelectionSummary`。
- 画布侧（`packages/design-bento`）：`patches/web-product-session.patch` 在 autosave 组装块内新增 `selectionSummary()`（按 kind 提取摘要；文本字段在元素级缺省时回退到首个 run 的值（`element.text.color ?? firstRun?.color` 等，fontFamily 兼容 string 与 {latin} 形态），否则样式只写在 runs 上的文本会在 pill 显示空值；`align` 只放行 left/center/right/justify，防 distributed 等值导致 main 端 zod 拒整包；fill 三态映射 undefined→null/solid→color/其他→undefined）与 `applyCommands(input)`（按 verb 对类型匹配的选中元素生成 `VisualCommandV4[]`，0 条匹配返回 `{ok:false}`，否则一次 `bridge.dispatch` = 一个撤销批次，自动保存/readonly 拒門全保留）。命令成功后会主动重推一次选区摘要（`pushSelection` 同时服务 `store.on('selection')` 与 dispatch 后）——样式命令不改变选中集合，不重推 pill 会停留旧值，且数字框"与当前值相同则不提交"的判重会吞掉下一次合法编辑。`product-session.ts` 的 `window.molly` 增 `applyCommands`（readonly 直接拒绝），`reportSelection` 改发完整摘要。`source-manifest.json` 哈希已更新；`corepack pnpm --dir packages/design-bento build` 绿。
- 主进程：`design-service.ts` 的 selection POST 校验从 `{count}` 改为完整 summary（上限 8192 字节）；新增 `applyDesignCommand`——zod parse → `queryCanvasState` → readonly 抛 'Canvas is read-only' → host record/可见性校验抛 'Current artwork is not visible' → `executeJavaScript` 调 `window.molly.applyCommands`（无该函数回 'Canvas does not support commands'）→ 返回值再过 zod。`design-ipc.ts` 新增 `@IpcMethod() applyCommand`，`owner()` 先行。Bento 保持元素无知（element-naive）：所有元素语义只在共享 zod 契约里，Electron 不解释元素类型。
- 渲染层：`design-selection-pill.tsx` 重构——props 改 `{busy, selection, onAction, onCommand}`；单类型且摘要含该元素时渲染类型区段：文本=颜色板（预设 12 色 + 原生取色器，关闭时提交）+ 字体下拉（`selection.fonts`）+ 字号数字框 + B/I 切换 + 四对齐；图形=填充板（含"无"）+ 描边板（含"无"）+ 宽/高数字框；线条=描边板 + 箭头预设（无/末端/两端）；图片=原 4 个 AI 动作 + 填充方式下拉；图标=填充板。当前值取 elements 里首个同类元素；多选同类型时命令应用到全部。混合/table/chart/摘要缺失回退原 5 按钮。数字框失焦/回车提交，非法值回退。`design-canvas.tsx` 存完整 summary，`onCommand` 走 `service.applyCommand`，`result.ok===false` 上浮错误。Storybook 五个故事更新为类型 fixtures。
- i18n：`locales/en.json`/`zh_CN.json` 新增 23 个 `design.*` 键（textColor/fontFamily/fontSize/bold/italic/align*/fillColor/strokeColor/colorNone/customColor/elementWidth/elementHeight/imageFit*/lineArrows/arrows\*）。
- 不变量更新：`apps/electron/src/main/services/AGENTS.md` 的 "Bento receives generic readonly and flush only" 改为"Bento 保持元素无知：收 generic readonly/flush + zod 校验的选区属性命令，上报 zod 校验的选区摘要"。

## 验证证据

- `packages/shared/tests/design-selection-commands.test.ts`（新）：summary/commands/result 三 schema 的接受、strict 拒绝、边界（elements>8、坏 hex、未知 verb/字段、越界值）——shared 全量 98 文件 1102 测试绿。
- `packages/components/tests/design-selection-pill.test.tsx`（新，9 测试）：混合回退、文本控件映射（bold/align/fontSize/color 预设）、图形 fill/stroke-None/size、线条控件存在性、图片 AI 动作+fit、busy 禁用——组件全量 451 文件绿。jsdom 中"第二个 popover 在第一个关闭后不再打开"是 jsdom 缺 pointer/focus 语义的已知假象，测试按挂载拆分规避，真实浏览器无此问题。
- Electron：`ipc-channel-list.test.mjs` 自动覆盖新 `design.applyCommand` 通道与 preload 政策；main 全量 146 测试绿。`applyDesignCommand` 的校验逻辑即共享 zod schema（已在 shared 测），Electron 侧胶水无独立 Node 可测核心，不为测试抽取抽象。
- `tsgo --noEmit`（components，含 main 类型）、`pnpm lint:i18n` 绿。
- 真实应用探测（2026-09-16，Playwright CDP 直连构建产物，验证画稿含文本/图形元素）：21/21 通过——文本 bar 显示 run 回退值（96/bold 按下/#EE964B 色块）；字号 96→80→96 往返、bold 开→关→开往返、文本色 #ef4444 均落到画布且 pill 随摘要回推即时刷新；自动保存状态可见；撤销按"一命令一步"完整还原（元素级覆盖键全部消失）；图形 bar 显示选中元素当前值（220×140/#F4D35E），宽改 180、填充 #22c55e 生效并可撤销；混合选中回退 5 个 Agent 动作且无类型控件；空选 pill 隐藏。浮层修复实测：Text color 弹板向上弹出时原生画布保持可见、命令照常生效（修复前弹板会触发 shell 的 dialog 守卫隐藏画布视图）。已知噪声：会话刚打开的几秒内 host 未注册完，首条命令会响亮报 'Current artwork is not visible'，重试自愈（09-15 Note 已记的 attach 竞态，命令路径不引入新风险）。image/line/icon 类型画稿未建，只有单测覆盖。
  - **更正（2026-09-16）**：上述"文本色 #ef4444 均落到画布"只验证了文档层（元素级 `text.color` 写入）与 pill 刷新，未验证**渲染外观**。对样式写在 runs 上的文本（如 headline 的 run 级 #EE964B），渲染器把 run 级样式作内联输出、元素级默认不生效，旧实现的属性命令对这类文本渲染无效（假成功）。同日晚间 review 发现并已修复：text-style 改走单条 `setText`（写元素级字段并删除每个 run 的同名键），探测复核渲染计算色随命令改变、撤销字节级还原。详见 [画布 review 六项修复](../bug-fix/2026-09-16-canvas-review-fixes.zh.md)。

## 限制与未验证项

- 方案 B（类型化 Agent 动作预填 prompt）未实现；文本/图形/线条/图标单类型 bar 因此暂无任何 AI 动作入口（引用除外），如需"对选中文本调风格"可后续加回。
- 多选同类型时控件只显示首个元素的当前值（各元素值可能不同），命令仍应用到全部——与 Lovart 一致，不做 indeterminate 态。
- 选中超过 8 个元素时摘要不带 elements（带宽上限），pill 回退通用动作组。
- 线条箭头预设只有 none/end/both 三档（映射 `[null,null]/[null,'arrow']/['arrow','arrow']`），不暴露箭头样式（stealth/diamond/oval）选择。
- `applyCommands` 的 verb→VisualCommandV4 映射在 patch 内，无单元测试设施（design-bento 包无测试目录）；靠共享 schema 测试 + 真实应用探测覆盖。
- 会话打开初期（host 注册完成前）首条命令可能报 'Current artwork is not visible'，为 09-15 已记的 attach 竞态；报错响亮且重试自愈，pill 不做自动重发（避免静默双写）。
- 数字框提交判重对比的是 pill 当前 prop 值；摘要回推前（几十毫秒）若用户以旧值为基准再次编辑，极端手速下可能吞掉一次提交——实测回推远快于人手间隔，未做额外防重。

## 后续

- 元素创建通道（第七动词 `add-element`、dock 文本/形状/图片插入接真）见 [画布 dock 插入按钮接真](2026-09-16-canvas-dock-insert.zh.md)。

## 2026-09-16 黄金 case 回归更正

本地单机最终源的真实 Kimi 黄金轮暴露了两个此前被隐藏旧控件遮蔽的问题：移除 `.c2a-surface` 后，图片裁剪没有可见入口；旧移动操作直接写上游元素的 `x/y`，而 Molly Design 的规范位置由 `bounds` 表达，重开后不能保证持久化。选区摘要现在上报规范 `x/y` 与图片 `crop`，共享命令新增 `position` 和可清空的 `image-crop`，类型化 pill 为图片提供可见的四边裁剪，为可定位元素提供 X/Y。画布侧分别映射到 `setBounds` 与 `setImageCrop`，仍以一个 kernel 批次完成并经过原有只读与 zod 边界。

真实模型轮 `local-only-merged-20260916-02` 已自然完成并得到稳定重开导出，但其旧编辑步骤因尝试隐藏控件而失败，原报告保持失败且不改写。修复后从该轮保留的 review profile 克隆出独立 continuation，在普通 Session 路由和当前构建中执行可见的文本、位置和裁剪编辑，验证自动保存、完全关闭/重开、YAML 读回、导出以及黄金版本恢复。`local-only-merged-20260916-02-editing-resume-20` 全部通过且没有再次调用模型；原始 PNG/JPEG 重开哈希保持一致。该 continuation 只证明编辑修复，不能替代针对最终提交重新生成的真实模型轮或本轮输出的人工视觉判断。

用户随后接受该输出的高视觉一致性，并授权最终提交的独立真实轮。`local-only-final-source-20260916-01` 针对 `2cf60736` 构建运行 Kimi `K3 · Thinking High`，技术、可见文本/位置/裁剪编辑、完整重启读回和人工视觉判断均通过；这消除了上述 continuation 的最终源码身份限制。
