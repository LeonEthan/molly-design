# 源预览重复关闭与原生销毁

Status: implemented
Translation: pending
PR: [#112](https://github.com/LeonEthan/molly-design/pull/112)

## 摘要

Issue [#111](https://github.com/LeonEthan/molly-design/issues/111) 报告源预览关闭时主进程访问空的 `webContents.isDestroyed`，弹出未捕获异常。加载中的预览被取消后，原生视图可以继续存在，但其 `webContents` 已被 Electron 清空；窗口导航、渲染进程退出或关闭再次清理该预览时触发崩溃。修复复用已有 surface lease 释放逻辑，删除重复关闭操作，并保护加载中视图的取消入口。确定性回归和原生销毁行为已核验；完整构建、资源及签名安装包验证的结果见下文，不据此宣称发布或公证完成。

## 原因与复用

沿用[原生视图交接](2026-09-19-live-canvas-handoff.zh.md)的 staging、consumer 和 source observation，不改变单画布、只读、保存或 Agent 执行合同。

- Electron 39.5.1 的 [`WebContentsView::WebContentsDestroyed`](https://github.com/electron/electron/blob/v39.5.1/shell/browser/api/electron_api_web_contents_view.cc) 清空内部 WebContents 引用。原生探针确认：`destroyed` 回调中的 Promise 恢复时仍可能取得已销毁对象；完成该原生回调、进入下一任务后 getter 返回 `undefined`。`isDestroyed()` 本身不能保护不存在的引用。
- 旧实现取消 staging 视图后，在加载 Promise 完成清理前仍保留其记录。随后导航触发 `closeSourcePreview → hideSourcePreview`，重复读取已经清空的 getter，得到 issue 相同的异常和栈。已发布预览的关闭和异步错误分支也有重复访问，可能中断 lease 释放。
- 优先检查现有 `surface().dispose` / `DesignSessionLease.dispose`：它已经持有创建时的 contents 引用，按幂等方式退役协议回调、关闭原生内容并等待回收。直接复用满足关闭、替换和加载失败清理，无需增加关闭协议或状态管理器。只在 staging 取消入口保留即时原生关闭，先捕获并检查当前 contents。
- 隐藏但不取消仍保留预览和观察器；关闭一个消费者不会释放仍由兄弟消费者使用的源监听；晚到的加载结果不能发布。

## 验证与限制

- `node --experimental-strip-types --test apps/electron/src/main/services/design-source-preview.test.mjs`：修复前 4 项失败，其中导航路径复现 `Cannot read properties of undefined (reading 'isDestroyed')` 及原始调用链；修复后扩展为 9 项并全部通过。测试使用显式加载/解析信号，覆盖尚未创建、已销毁、重复关闭、导航、渲染进程退出、窗口关闭、迟到结果、临时隐藏和兄弟消费者。
- 复用已有 P1 原生探针：在真实预览加载被取消后，等待原生销毁回调返回，同时用显式 Promise 暂停加载清理，再重复 hide/close。检查空 getter、无异常、取消结果及 canonical 视图保留；报告新增 `repeatedCloseAfterNativeDestruction`。
- `pnpm check`、`pnpm build`、更新探针后的 `pnpm --dir apps/electron build:app`、`pnpm format`、`pnpm run docs check` 均通过。Electron 两组测试共 295 项通过；文档检查仅保留原有 AGENTS 文件大小警告，无 SHA 保护主题变化。测试脚本加入常规 Electron 测试入口，重新解析 lockfile 未产生依赖变化。
- PR 基于更新后的 main，测试列表冲突保留上游浏览器隐私设置测试并追加本次预览测试；变基后的 `pnpm check`、`pnpm format` 和文档检查再次通过。上述构建及原生证据采集于变基前，未据无关浏览器改动扩大原生验收范围。
- 开发版原生 P1 退出 0，`result.json`、`source-preview-result.json`、`version-result.json` 均 passed，新增重复关闭断言为 true。首次手工启动误传了 main 文件路径，使 `app.getAppPath()` 指向 `out/main`，设计 worker 未启动；改用 Electron 应用目录后通过，没有为此更改产品代码。证据目录 `m111-p1-evV1hW`，初次失败保留在 `m111-p1-xORWe2`。
- `pnpm --filter @molly/e2e canvas:resources` 退出 0：串行分区 1、同时存活独立分区 3、残留 editor HTML Buffer 0。证据目录 `molly-canvas-resources-6fQdGs`。
- 只读 Codex CLI 第二意见（`gpt-6-astra` / high）未发现 P0/P1；其执行的 21 项聚焦测试、Electron 主进程类型检查和文档检查通过。审查进程未运行原生探针；上述原生证据来自本次主执行流程。
- 本地 arm64 测试 DMG 使用 `0.1.0-issue111`，不发布，明确关闭公证。首次打包因 `CSC_NAME` 含不被 builder 接受的证书类型前缀而退出，改用其要求的证书名称后，包内 CLI、图像解码、Bento、浏览器及 Pi 资源探针全部通过。Developer ID 签名正在等待系统钥匙串私钥授权，尚未生成可验收的签名 DMG；该安装验收保持未完成，不能据开发版通过关闭发布阻塞项。

本次没有付费模型或图片请求；不扩大为真实 Kimi 创作质量、全部设计流程或公证分发验收。
