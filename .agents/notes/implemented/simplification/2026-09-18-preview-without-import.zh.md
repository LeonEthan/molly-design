# 退役预览手动刷新与导入为当前稿

Status: implemented
Translation: current

[English](2026-09-18-preview-without-import.md)

## 摘要

用户确认预览面板不再需要“导入为当前稿”按钮、“刷新预览”按钮和来源路径说明横幅，要求清除 UI 及其所属功能。本次删除整条预览导入链（渲染层按钮与状态、`DesignIpc.importPreview`、`importSourcePreview`、`importDesignSnapshot` 及预览视图缓存的导入快照）和手动刷新入口，保留自动预览对账（打开、文件监听、聚焦、重连和回合结束触发）。预览与监听失败仍以预览作用域的错误条如实报告，不再合入当前稿错误，也不再用横幅展示路径与状态。Spec、会话 README 与根规则已同步，Spec 保持 draft。

## 删除范围

- `packages/components/src/components/sessions/design-canvas.tsx`：两个按钮、`importPreview`、`previewSource`/`previewIdentity`/`previewStatus` 状态与说明横幅；预览错误和监听错误仅在 Preview 激活时以 `role="alert"` 显示，监听失败文案改为中性的“自动预览更新不可用”。
- `apps/electron/src/main/ipc/services/design-ipc.ts`：`importPreview` IPC 方法。
- `apps/electron/src/main/services/design-source-preview.ts`：`importSourcePreview` 与预览视图的 `snapshot` 缓存字段；`sourceIdentity` 保留用于渲染去重与代次检查。
- `apps/electron/src/main/services/design-service.ts`：`importDesignSnapshot`；`designCanvasAccess.replaceAfterFlush` 仍被版本恢复使用，保留。
- `apps/electron/src/main/services/design-source-preview-verification.ts` 与 `design-verification.ts`：`verifySourceImport` 及其调用。
- locale（en/zh_CN）七个死键；Spec 与 zh Spec 删除导入两条及“运行期间不导入覆盖当前稿”句，明确预览只读、自动更新、无手动刷新或导入入口；根 AGENTS.md 删除“External import validates and saves the viewed snapshot directly”。

## 保留的行为

自动预览对账不依赖已删除的按钮：打开预览、文件监听推送、窗口聚焦、loro 重连和回合定稿仍触发 `refreshPreview`。预览失败保留上一份有效预览并报错；执行期间画布只读等门禁不变。原生预览右下角的“未提交预览 · 只读”标记在 Bento 视图内，不受影响。

## 验证与限制

- `packages/components` 的 `design-source-preview`（7 项）与 `design-canvas-receipt`（5 项）测试共 12 项通过：导入测试替换为两个按钮与横幅不存在的断言；自动预览测试改用 refresh/attachPreview 调用计数与 `previewVisible` 状态；新增预览错误在切回 Artwork 时隐藏、成功对账后清除的回归断言。
- `@molly/components` 与 `@molly/electron` typecheck 通过（退出码 0）；`design-canvas-sync-core.test.mjs` 19 项通过；`docs check`、`check:public-boundary`、`check:code-collab-imports`、`check:platform-boundaries` 通过。完整 `pnpm check` 未运行；`lint:i18n` 有两个与本次无关的既有缺失键（`design.sizeMode`、`design.autoSize`，来自 8538ae6b）。
- 原生 Electron 预览探针 `verifySourcePreview` 保留但本次未运行；导入探针随功能删除，其覆盖的导入竞争语义随功能一并退役。删除限于预览导入与横幅，不改变提交、导出与版本恢复路径。
