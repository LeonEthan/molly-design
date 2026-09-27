# 画布 Lovart 化 review 六项修复（含一处 spec 意图修订待批准）

Status: implemented
Date: 2026-09-16
Translation: pending

## 摘要

2026-09-16 对两轮未提交的画布工作（[Lovart 化](../feature/2026-09-15-canvas-lovart-ui.zh.md)、[typed pill](../feature/2026-09-16-canvas-typed-selection-bar.zh.md)、[dock 插入](../feature/2026-09-16-canvas-dock-insert.zh.md)）的 review 报告了 1 项 P0 与 5 项 P1，逐条核实全部属实后完整修复。P0 是调研素材中一张 Lovart 截图含真实用户 prompt 与 agent 回复，违反仓库"不提交 captured transcript"边界，已裁剪。P1 中四项是代码缺陷（选区镜像按数量键控、镜像收养显式引用、浮层守卫漏 role=menu、run 级文本样式下属性命令假成功），均修复并有端到端证据；一项是 spec 意图冲突——spec 要求的手工画布尺寸入口已随 Lovart 化退役——按用户判断走 spec 修订路线，双语 spec 修订后退回 draft 并已于 **2026-09-16 获用户批准**（见文末批准记录），未恢复手工入口。主要代价：text-style 修复改用整条 `setText` 命令（inverse 为完整旧内容，单步撤销仍字节级还原），命令载荷比元素级 setStyle 大。

## 背景

review（codex）的六项发现，核实结论全部为真。修复范围经用户授权"按你的判断完整修复"；P1-3 的方向（改 spec 而非恢复入口）也由用户交予判断，依据是 Lovart 化是已拍板方向且 [Lovart 化记录](../feature/2026-09-15-canvas-lovart-ui.zh.md) 已明确"面板的原有手工能力（画布尺寸/背景、图层排序等）不再有人工入口，由 Agent 编辑与画布直接操作覆盖"。

## 发现与修复

1. **P0 调研截图含真实对话（仓库边界）**：`.agents/notes/proposed/feature/assets/2026-09-15-aigc-image-product-ui-research/lovart-workspace-chatcanvas.png` 为用户提供的工作区截图，右侧 chat 面板含真实 prompt 与 Lovart agent 回复。修复：从 x=0 裁至宽 1994（chat 面板分界线约 x=2007），ReadMediaFile 复核右侧无 chat 内容；[调研笔记](../../proposed/feature/2026-09-15-aigc-image-product-ui-research.zh.md) 图注注明裁剪事实，面板内细节（模型 chip、内嵌结果、👍👎、输入区引用 chip）改以文字记录。同目录其余 15 张素材此前已抽查干净。

2. **P1-1 选区镜像同步只按数量键控**：`design-canvas.tsx` 的捕获 effect 依赖 `selectionCount`，同数量从元素 A 切到 B（或属性编辑使 revision 前进）时不重捕获，镜像 chip 携带陈旧元素 ID/陈旧 revisionId，校验通过后 Agent 会静默拿到错误目标。修复：effect 改依赖 `selection` 状态对象（每个 `design.selection` IPC 事件都是新引用）；`readonlyView || selectionCount===0` 时显式 `sync(null,'')`（进入历史/预览/只读视图或空选即退役镜像），否则 300ms 防抖重捕获。

3. **P1-2 显式引用被镜像收养后删除**：`combined-mention-textarea.tsx` 的 `syncDesignElementMention` 曾把载荷相等的既有 chip 收养为镜像（记录 `lastSyncedDesignValue`），之后取消选中会把用户显式附加或草稿恢复的 chip 一并删除。修复：删除收养分支，载荷相等时直接 no-op——相等 chip 要么是镜像自己的（无事可做），要么是用户所有的（永不收养、永不被被动同步退役）。镜像生命周期不变：仅在无相等 chip 时插入并记录 `lastSyncedDesignValue`，`sync(null)` 只删该值指向的 chip；`commitDesignElementRequest` 本就负责"先撤下旧镜像再拼接新 chip"。

4. **P1-3 spec 第 48 段手工画布控件已被移除（意图冲突）**：spec 要求手工调整画布尺寸且保持元素/溢出拒绝；Lovart 化隐藏了 `.c2a-surface`（含 Page Setup 宽高、背景、图层排序面板），无替代手工入口。证据：kernel `setCanvasSize` 已实现 spec 的拒绝语义（"would leave an element outside the canvas"），被拒的只是入口存续。处理（按用户判断）：修订 `specs/graphic-design-platform.zh.md` 与英文镜像——保留"任何尺寸调整实现都必须保持元素位置和大小、溢出拒绝并说明阻塞元素"的语义，记录手工入口（页面设置面板）随 Lovart 化退役、尺寸经 Agent 创作路径调整；同步修订首页段"后续可在编辑器调整"为"经 Agent 创作路径调整"。Status 由 approved 退回 draft 走重新批准流程，两次历史批准降级为 Previous approval 保留；**本修订已于 2026-09-16 获用户批准**（见文末批准记录）。

5. **P1-4 新版 DropdownMenu 被原生画布遮挡**：HEAD 用 Radix Select（role=listbox 命中 `hasCanvasBlockingOverlay` 守卫），本轮 History/Export/More 换成 DropdownMenu（role=menu 不命中），菜单延伸到原生 `WebContentsView` 上方会被裁剪/不可点。修复：守卫选择器加 `[role="menu"]:not([data-design-canvas-overlay])`（一行）。

6. **P1-5 run 级文本样式下属性直改假成功**：kernel setStyle 只写元素级字段，渲染器（`renderers/text.ts`）把 run 级样式作内联输出，内联赢——对样式写在 runs 上的文本，pill 改色/字号/字体后文档层变化但渲染不变。修复（对齐上游 D2 诚实路线 `ui/text-style.ts`）：补丁的 text-style 分支改为 `structuredClone(element.text)` → 设元素级字段并**删除每个 run 的同名键** → 单条 `setText` 命令（inverse 为完整旧内容，单步撤销字节级还原）；align 本就只写元素级，保持 setStyle。顺带修显示侧：`fontFamily` 摘要回退链补 run 级 `{latin}` 形态。补丁经 worktree 流程再生成，`source-manifest.json` 哈希更新（`a69bd72e…`），design-bento 构建与 app 构建绿。

## 验证证据

- **P1-5 真实探测**（Playwright CDP 直连构建产物，6/6）：headline（run 级 96/bold/#EE964B）渲染计算色起始 rgb(238,150,75) → pill 改 #ef4444 后渲染变 rgb(239,68,68)，runs 的 color 键被清、元素级写入 → 撤销后 run #EE964B 与渲染同时还原（字节级 inverse）。
- **P1-1 真实探测**（5/5）：选中 badge 出现镜像 chip；chip 后键入标记文本；同数量切换 badge→headline 触发重捕获（chip 被替换并拼接到文本末尾——`@…(1) abc` 变为 `abc @…(1)`，无重捕获则位置不变）；取消选中退役 chip、用户文本保留。说明：preload 的 `window.ipc` 对象冻结，探针无法插桩 invoke 计数，改用上述可观察行为断言；badge 重点击（选区无变化）不下发新事件，属预期。
- **P1-4 真实探测**（2/2）：版本历史 DropdownMenu（role=menu）在原生画布上方打开，"存为版本"可点击并出现"Saved as V"toast。
- **P1-2 jsdom 回归**（新，`packages/components/tests/combined-mention-textarea-design-sync.test.tsx`，6/6）：镜像插入/退役、同数量身份切换替换、显式 chip 不被 `sync(null)` 退役、载荷相等显式 chip 不被收养（核心回归：旧收养逻辑下此用例失败）、镜像自身相等 chip no-op 且仍可退役、用户手删镜像后 stale lastSynced 恢复干净。
- **既有"readonly 竞态"归因确认**：探针手动 `setReadonly(true)` 后 200ms 内 shell 访问闸门按真实执行状态重断言可写（readonly 归属 shell，手动覆盖必被冲掉），与 [dock 插入记录](../feature/2026-09-16-canvas-dock-insert.zh.md) 已记结论一致，非产品缺陷。
- **画稿还原**：探测用验证画稿磁盘复核 6 个原元素、headline run 96/bold/#EE964B、badge 220×140，撤销字节级还原；revisionId 漂移仅来自探测中有意保存的两个版本（测试会话 git 历史，可接受）。
- `pnpm check` 全绿（typecheck / lint / test:ci / lint:i18n / 三项边界守卫），`pnpm format` 无漂移，`pnpm run docs check` 通过（仅既有 AGENTS.md 体积警告）。

## 限制与未验证项

- P1-3 spec 修订已获用户 2026-09-16 批准。vendor `ui/canvas.ts` 的尺寸 clamp 为 1..16000 与 spec 的 1–4096 存在既有分歧，不在本次范围。
- 镜像 provenance 依赖载荷相等判断：用户显式引用与当前选区载荷完全一致时，该显式 chip 之后也不会被被动退役（视为用户所有）——这是修复有意选择的语义，代价是极端情形下不再去重。
- text-style 的 `setText` 命令载荷大于元素级 setStyle（整段文本内容进 inverse），长文本元素的单步撤销数据量相应变大；未测超长文本性能。
- 真实探测覆盖文本/图形两类画稿元素与 dock 插入回归（19/20，唯一失败即上述已归因的探针竞态）；image/line/icon 类型的属性通道仍只有单测覆盖。

## Spec 批准记录（2026-09-16）

用户在 2026-09-16 会话中审阅本笔记记载的六项修复后，明确回复"批准，确认"：批准 `specs/graphic-design-platform.zh.md` 第 48 段（及英文镜像对应段）的意图修订——手工画布尺寸入口（页面设置面板）随画布 UI Lovart 化退役、画布尺寸经 Agent 创作路径调整、任何尺寸调整实现仍须保持元素位置和大小并对溢出拒绝；同时确认包含本次修复在内的全部未提交改动可以提交。spec 据此由 draft 回到 approved，本节的 2026-09-16 日期即为批准日期。
