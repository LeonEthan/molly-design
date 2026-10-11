# 画布编号批注：一个回合发出多条定点修改

Status: implemented
Translation: current

[English](2026-10-11-canvas-numbered-notes.md)

## 摘要

此前在画布上问 Molly 每次只针对一个目标，几处小修改就要发好几个回合、留下好几个还原点。现在在元素上 Cmd/Ctrl 点击（或在“问 Molly”弹框中点“添加为批注”）即可放下一个带编号、各自附说明的图钉，“发送给 Molly”把所有批注作为一个普通回合发出，每条批注对应一个元素引用。图钉只是画布上的屏幕状态；主进程像读取选区一样读取并校验其目标，并统一绑定到同一个已保存修订。这是[画布点选编辑提案](../../proposed/feature/2026-10-10-canvas-click-to-edit.zh.md)的阶段 B。画布页面重新加载后图钉不会保留，且未实际执行付费的发送。

## 问题与依据

[问 Molly](2026-10-10-canvas-inline-ask.zh.md) 让请求留在目标处，但每次请求只覆盖一个选区。审阅作品时通常会产生一串修改（“标题再深一点”“裁一下照片”“挪一下日期”）。参考模式是 Codex 应用中可在对话中统一处理的编号批注，以及 Lovart 单条提示最多 10 个标记。

## 决定

- **复用阶梯。** 检查了 Bento 自带的评审评论（`editor/comments.ts`）：它写入文档的 `Slide.comments` 并使用 `window.prompt`，复用会给文档增加 YAML 投影不承载的字段，且每条批注都会修改作品。检查了 Lody 预览的视觉批注：它按 DOM 选择器/xpath 锚定 HTML 预览，并持久化在 Loro 评论文档中。两者均未采用，只借用编号标记的模式。复用了工具栏端点、选区捕获（现为选区与批注共用的 `captureDesignReferences`）、`design.selectionAction`、`DesignElementReference` 提及以及阶段 A 的输入框发送路径。单条提示中的多个 `<molly-elements>` 标记原本就会被解析、校验和描边（阶段 D）。
- **画布。** `packages/design-bento/src/note-pins.ts` 管理图钉：元素 ID 与文字、每次变化递增的 epoch、按屏幕像素放在目标右上角的标记、编辑弹框，以及停靠栏上方的托盘（数量、清除、发送）。不拖动的 Cmd/Ctrl 点击若落在当前选区内则钉住整个选区，否则钉住命中的最外层元素；Cmd 拖动复制不受影响。编辑框关闭时空批注会被丢弃；同一目标上的第二条批注追加到已有图钉；最多 10 个（`DESIGN_NOTES_MAX`）。从文档中删除的目标会从图钉中移除，没有目标的图钉随之删除。画布只读时隐藏图钉。
- **契约。** 工具栏请求为 `{ type: 'notes', notesEpoch }`，不携带元素 ID。主进程执行 `window.molly.notes(epoch)`，解析 `DesignNotesSchema`，像其他显式引用操作一样先保存，再按已保存修订为每条批注生成引用、统一校验，并在转发 `{ action: 'notes', notes, notesEpoch }` 前再次核对 epoch。
- **发送与清除。** `sendDesignNotes` 生成 `1. 说明 @批注 1` 形式的多行文字，每条批注一个提及，作为一个文本块发出，不改动草稿。从发出请求起图钉保持锁定，直到外壳通过新增的 `design.settleNotes(artwork, host, epoch, sent)` 回复；外壳在任何结果下（包括忽略该事件时）都会回复，从而避免再次点击把同一批注发送两次。只有回合被接受才会清除图钉，若图钉此后又被修改则保留。发送被拒时保留图钉并提示；与“问 Molly”不同，批注不会退回输入框草稿，因为草稿只容纳一个选区标签。

## 验证

- 单元测试：模式边界与只带 epoch 的请求（`packages/shared/tests/design-selection-commands.test.ts`）；图钉手势、合并、上限、清理、待回复锁定、epoch/清除与托盘失败（`packages/components/tests/design-note-pins.test.ts`）；“添加为批注”（`design-selection-toolbar.test.ts`）；画布事件路由与清除（`design-canvas-selection-ask.test.tsx`）；带编号的输入框发送（`session-chat-input-submission.test.tsx`）。
- 真实 Electron 应用（2026-10-11，深色主题）：Cmd 点击钉住了标题和叶子的叶脉线，回车保存各条批注，标记编号为 1 和 2，托盘显示“Notes · 2”，重新打开标记可恢复文字，`window.molly.notes()` 返回两个目标及其说明。
- 未执行：实际发送（付费模型回合）、浅色主题，以及文字和线条以外的元素类型。人工视觉验收待完成；Spec 修订保持草稿。
