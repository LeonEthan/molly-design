# 画布内联提问：在选区处问 Molly

Status: implemented
Translation: current

[English](2026-10-10-canvas-inline-ask.md)

## 摘要

画布选区工具栏的“问 Molly”现在在选区旁打开输入框。回车（或“发送”）立即以携带元素引用的普通会话回合发出；“加入对话”只把提示与引用放入输入框草稿，即此前的行为。此为画布点选编辑提案的第一阶段，所有者于 2026-10-10 批准。

## 问题与证据

选区上的所有 AI 动作此前只把模板提示插入输入框便停止（2026-09-11 于[设计上下文动作](2026-09-11-design-context-actions.zh.md)决定）。用户必须离开画布，在对话面板补完句子再点发送。Lovart（Mark / Quick Edit）、Higgsfield（Draw-to-Edit）与 Codex 应用（浏览器批注评论）都把请求留在目标处；竞品调研与五阶段提案已在同日的对话回复中给出。

## 决定

- **复用阶梯。** 复用工具栏现有弹层（“编辑文字”模式：输入框、回车提交、输入法保护、Esc）、绑定宿主的工具栏端点与选区 epoch、既有 `DesignElementReference` 提及以及输入框的 `onSendMessage` 路径。否决：直接调用图像工具的独立快速编辑执行器（绕过 Agent，新增第二条图像作业路径），以及新 IPC 通道（既有 `design.selectionAction` 事件新增 `ask` 变体）。
- **契约。** `DesignToolbarRequestSchema` 新增 `{ type: 'ask', selectionEpoch, prompt（去首尾空白，1–4000）, send }`。Electron 与其他动作一样捕获引用（不做图片类型检查），并转发 `{ action: 'ask', prompt, send }`。
- **发送路径。** `sendDesignSelection` 用与输入框相同的提及展开构造 `提示 + @选中元素`，以单个文本块调用 `onSendMessage`。它从不读取或清空输入框草稿、附件或镜像选区 chip。当输入框本会拒绝（配置未就绪、机器已移除、历史刷新中、回合上限、已有发送进行中），或发送被拒绝/抛错时，提示与引用经既有 `referenceDesignSelection` 回落到草稿，文字不会丢失。
- **按键。** 回车发送，Shift+回车换行（与输入框一致），Esc 关闭。提案中的“Shift+回车转入对话”改为显式“加入对话”按钮，以免与输入框换行习惯冲突。Tab 预设推迟到第五阶段（E）。
- **草稿安全。** 未发送的提示按同一选区 epoch 保留，请求失败后重新打开可恢复；新选区从空白开始。
- 只读、隐藏视图与过期选区检查不变：Agent 运行时工具栏隐藏，CLI 仍在派发前校验作品、修订与 ID。

## 验证

- 单元测试：schema 边界（`packages/shared/tests/design-selection-commands.test.ts`）、工具栏按键/输入法/加入对话/草稿保留（`packages/components/tests/design-selection-toolbar.test.ts`）、画布事件路由（`design-canvas-selection-ask.test.tsx`）、输入框发送与回落（`session-chat-input-submission.test.tsx`）。
- 真实 Electron 应用（克隆数据目录，2026-10-10）：弹层在浅色/深色主题下正常显示并支持输入法；“加入对话”把提示与选区 chip 放入输入框。在运行配置始终未就绪的分叉会话中，回车按设计回落到草稿。在新建设计（Kimi For Coding HighSpeed）上，对“Make this headline warmer: use a deep terracotta color”回车后发出携带 `@Selected elements (1)` 的普通回合；Agent 只给标题改色并保存作品。克隆数据目录中恢复旧会话会在 ACP 续接阶段失败（未发生模型调用），与本改动无关。
- 实测只覆盖了一个文本元素；其他元素类型依赖单元测试。人工视觉验收待定；Spec 修订保持 draft。
