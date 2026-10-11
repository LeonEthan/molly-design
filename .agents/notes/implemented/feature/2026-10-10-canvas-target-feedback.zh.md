# 画布目标处反馈：标出 Molly 正在改和改过的内容

Status: implemented
Translation: current

[English](2026-10-10-canvas-target-feedback.md)

## 摘要

Agent 回合结束后，画布不显示 Molly 动过哪些元素，也看不出选区外的元素是否被改。现在，回合运行时被引用的元素带有轮廓；已提交回合重新载入打开的画布后，新增或修改的元素短暂显示轮廓；引用范围外的修改另以轮廓标出，并在可关闭的提示中计数。比较结果由被替换的画布与已保存修订重新计算，从不存储，也从不阻断或修复任何内容。按住对比“Molly 修改前”推迟实现，因为目前还没有不改动当前稿的历史条目渲染方式。

## 问题与证据

[画布点选编辑提案](../../proposed/feature/2026-10-10-canvas-click-to-edit.zh.md)的第四阶段（D），所有者于 2026-10-10 批准。Lovart 与 Higgsfield 把编辑呈现为点击目标处的局部修改；Molly 的 Agent 编辑整份文档，用户只能靠肉眼对比找出变化。

## 决定

- **复用阶梯。** 复用回合后的画布重载（`syncDesignCanvasFromStore`）、用户回合中冻结的元素引用、会话视图的按范围水合，以及工具栏的 executeJavaScript 呈现路径。否决：把每回合变更列表持久化到回合结果中（为派生视图新增持久状态）、在 CLI 中依据冻结清单计算差异（Electron 不得读取 CLI 工作区路径）、React 覆盖层（几何信息位于原生画布内）。
- **差异。** `diffDesignElements`（`@molly/shared/design-selection-commands`）按 id 以不受键顺序影响的 JSON 比较元素：新增或修改的 id 记为 `changed`，消失的 id 记为 `removed`，仅层级顺序变化不算修改。Electron 在重载前（既有干净状态检查之后）对被替换画布做快照，并与已保存文档比较；`syncFromStore` 返回结果，未发生重载时返回 `null`。
- **归属。** 渲染进程读取已提交回合的元素引用（从助手 id 回溯到其用户回合），把修改分为范围内与范围外。没有引用的回合拥有全部修改，因此不显示提示。范围外被删除的元素计入提示，但无法画轮廓。
- **轮廓。** 画布中的 `window.molly.highlight(groups)` 绘制三种色调：`working`（虚线，常驻）、`changed`（实线，2.4 秒后淡出）、`outside`（琥珀色虚线，6 秒后淡出）。一次调用只替换其列出的色调；空列表清除全部，因此清除工作中轮廓不会抹掉回合后的轮廓。主进程用 `DesignHighlightSchema` 校验；画布页面本身不依赖 zod。
- **运行中回合。** `canvasState.turnId` 存在期间，被引用元素在规范视图及每个新预览帧上显示 `working` 轮廓（每帧都是新页面；预览服务在显示前重新应用已存的工作中轮廓）。

## 验证

- 单元测试：差异与 schema 边界（`packages/shared/tests/design-selection-commands.test.ts`）、引用提取、回合回溯与归属（`packages/components/tests/design-turn-elements.test.ts`）、轮廓几何、淡出与色调替换（`design-element-highlight.test.ts`），以及画布对修改、范围外与工作中轮廓的接线（`design-canvas-receipt.test.tsx`）。
- 真实 Electron 应用（克隆数据目录，2026-10-10，Kimi For Coding HighSpeed）：仅选中标题，提示“Make this headline deep forest green, and change the subline color to match it”；运行期间画布只读，标题显示工作中轮廓；提交后提示“Molly also changed 1 element outside your selection”，“查看”标出了副标题。自动的提交后轮廓未能在其 2.4 秒窗口内截到；它与产生提示的调用相同。
- 组装后的 Bento 构建按显式列表复制 `src/` 模块；新模块需要加入该列表，单元测试与 `pnpm check` 均不覆盖这一点。

## 限制

- 只有提交时画布处于打开状态才会显示反馈；之后打开画布直接读取存储，不显示轮廓。
- 按住对比“Molly 修改前”尚未实现。
