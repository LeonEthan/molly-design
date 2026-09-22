# 永久删除会话时释放保留的画布

Status: implemented
Translation: pending
PR: [#54](https://github.com/LeonEthan/molly-design/pull/54)

## 摘要

Scout 在每次创建、归档并永久删除会话后多保留一个 renderer；本机四轮复现的堆快照显示，四个画布仍由设计服务的 `records` Map 持有。删除会话的 UI 路径没有调用原生画布关闭入口，组件卸载只隐藏了本来应该跨普通导航保留的编辑器。修复复用已有保存确认和关闭能力，在删除整组会话记录或发出机器清理命令前检查并关闭对应画布，不删除作品文件或改变普通切换的保留行为。钩子级回归、四轮原生 Session 及三十轮 Work 复验通过，renderer 由逐轮增长变为恒定一个；Work 仍报告独立的内存增长候选，不据此关闭整个资源增长 Issue。

## 证据与责任

- Issue：[资源增长 #45](https://github.com/LeonEthan/molly-design/issues/45)。两轮主线 Scout（`35583394622`、`35601811935`）均测得每轮增加一个 renderer。
- 本机主线 `1d8967c1`，命令 `pnpm e2e:scout --journey session --iterations 4 --warmup 0 --checkpoint-every 1`：四轮完成，约 26 秒；每轮永久删除后的 GC 检查点 renderer 数为 2、3、4、5，主 UI 监听器均为 401。短轮次没有预热，不据此建立内存阈值。
- 本地证据轮次 `2026-09-21T13-44-21-270Z-a2fa2f00` 的 main heap 中有四个具备 `artworkId/access/view/owner/dispose/revisionId` 字段的实例，`view` 为 `WebContentsView`；反向引用为 Map table → Map →模块上下文中的 `records`。快照不提交仓库。
- `design-service.ts` 明确保留隐藏编辑器，`destroyDesignInstance` 才注销画布、移除原生子视图并关闭 WebContents。`DesignIpc.close` 已包含 `leaveDesign` 保存/放弃保护以及销毁。
- `use-session-actions.ts` 的 direct/archived 删除路径原先只处理会话文档、运行时 store 和机器清理队列，没有调用该入口。仅修改卸载清理会误伤正常切换保留的编辑器，因此不采用。

## 修复边界与取舍

两个删除入口先对所选生命周期内的全部 Session 调用 `design.leave`；任何保存失败或用户取消都阻止资源销毁及删除。检查全部通过后逐个调用 `design.close`，再沿用原删除流程。原生 close 仍自行重查保存条件，不把第一次检查视为绕过后续校验的许可。没有 Electron 桥的既有路径不受影响。

这不是跨会话事务：在预检查通过后发生新的关闭错误，可能已有其他干净编辑器被释放，但会话文档尚未删除，已保存作品仍保留。没有增加锁、持久状态、自动重试或新 IPC。普通归档、隐藏、导航及未选中会话不新增销毁行为。

规则保留于 [hooks 合同](../../../../packages/components/src/hooks/AGENTS.md)，与[串行画布执行记录](../architecture/2026-09-11-canvas-serial-execution.zh.md)的隐藏保留原则一致。没有改变 Spec 意图。

## 验证与限制

- 修复前新增的六项钩子级回归失败：两个入口都没有释放资源，且关闭拒绝未阻止删除/机器清理。修复后定向文件共 52 项测试通过；另覆盖子会话取消前必须保留整组编辑器和文档，以及等待原生 close 确认才删除记录。
- 回归覆盖真实删除钩子与 IPC 调用顺序，原生视图由边界夹具替代，因此不冒充已证明 Chromium 进程退出。
- 自动化宿主启动的 Electron 在测试凭据保存阶段返回 `credential_storage_unavailable`，系统错误为 `errSecInteractionNotAllowed (-25308)`；解锁钥匙串后依旧如此。用户自己的终端运行同命令成功。此差异说明不能将失败归因于用户未正确解锁；未放宽凭据加密，也未修改个人钥匙串授权。
- `pnpm check`、`pnpm format`、`pnpm run docs check` 通过；最后增加的关闭确认等待测试另跑定向文件通过并格式化。文档仅有既有规则文件大小警告。
- `pnpm e2e:build` 通过。用户终端在修复构建上重跑相同参数，轮次 `2026-09-21T14-01-02-314Z-e581955c`，约 24 秒，Session 四轮全部通过。删除后的 renderer 为 1、1、1、1，总进程数为 9、9、9、9，主 UI 监听器均为 401，`suspectedTrends` 为空。这是该短路径的原生回归证据，不替代全旅程长轮次。
- 仅含此修复的 Work 四轮复验也确认 renderer 恒为 1，但监听器继续增长；独立根因与补丁见 [xterm 监视器释放](2026-09-21-xterm-monitor-disposal.zh.md)。
- 两项修复后的 Work 长测 `2026-09-21T14-19-40-469Z-7522c083`（预热 3、测量 30、每 5 轮检查）操作全部通过，耗时 145647 ms。六个 post-GC 检查点 renderer 均为 1、总进程均为 9、监听器均为 410、DOM 节点均为 787。主进程私有内存、驻留内存与 renderer JS 堆仍有增长候选，具体数值见上述 xterm 记录；Issue 保持未关闭。尚未完成修复后的 Session/Review 三十轮复验。
