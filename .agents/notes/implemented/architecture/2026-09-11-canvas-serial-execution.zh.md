# 画布保存握手与执行期间只读

Status: implemented
Translation: pending

## 摘要

T02 将同一作品的人工修改与 Agent 执行串行化：已有可见回合拥有者在构造输入基线前等待桌面冻结并 flush 所属画布，执行、取消清理和产物处理结束后才释放。桌面按作品约束所有原生实例的实际保存入口，Bento 仅提供通用只读与 flush；异常脏稿阻止重载，不再被静默清空。版本检查仍由原提交路径独立完成。桌面在线但没有打开画布的后台回合可以运行；完全没有桌面确认的设计派发明确失败，不能把断连猜成没有未保存编辑，普通非设计会话不改变。

## 决定与边界

本票实现[串行编辑决定](../../implemented/architecture/2026-09-11-design-serial-editing.zh.md)的 T02 边界，参照 [Spec](../../../../specs/graphic-design-platform.zh.md)；不修改其审批状态、不实施投影 hooks 或工作目录分离。

CLI 的 `SessionExecutionService` 已有重复派发拒绝、权限等待、取消、steer 和最终处理。新增 `canvas-host` 是这个拥有者的临时桌面 flush 握手，不另建任务调度或持久锁。主进程沿既有机器本地控制 socket 拉取完整拥有者快照和准备请求；独立于可能耗时的图片渲染，所以慢预览不会阻塞执行状态确认。握手通过共享 `designCanvasSerialEditing` 能力版本确认；没有确认的版本保持只读。

准备时先冻结所有已注册的所属实例，排空已接受的保存/导入操作，再逐个通用 flush。进入只读时同步提交已缓冲文本；输入法组合未完成则失败并保留内容，不猜测输入完成。一次性写入凭据只授权这个准备动作的保存请求；普通保存/重命名/采纳入口仍执行同一主进程检查。实际 Agent 基线在确认后由原 `prepareDesignTurn` 构造。前端发送前的保存检查仍保护 composer；队列等待期间不替未来回合提前固定基线，实际派发再次握手。

各 hostId 保有自己的原生画布实例；隐藏或关闭实例不释放作品的执行拥有者。新实例默认只读，先查询真实状态；断连保留只读，收到空闲快照后才能恢复。结束前同步当前稿；若任一实例还有脏内容、组合输入或在途保存，整体重载拒绝并保留实例。不同作品可以继续编辑。通用 bridge 在 dispatch/undo/redo 的实际内核入口拒绝写入，文本/属性输入还在捕获阶段阻止，查看与缩放继续可用。

## 发现的执行时序

已有 Effect runtime 释放早于外层失败/停止产物记录。因此只读释放位于外层处理结束，不能直接挂在内部 runtime map 删除上。Effect 中断也不会取消已经开始的 JavaScript 产物 Promise，设计回合单独等待该实际 Promise 结束。steer 会更新可见 turnId；画布握手保留原拥有者 token 到整条执行链结束，迟到旧消息无法释放后来的拥有者。

`AgentClient.prompt` 的本地 AbortSignal race 会在 provider 回应前拒绝；发送 ACP cancel 不代表实际 prompt 已结束。通用 `getProviderPromptSettlement` 返回 provider Promise 的快照，设计释放等待该事实；原取消 UI 仍立即返回。未被 Agent 接受的 steer 保留前一 provider settlement，已接受的后继绑定对应 provider Promise；画布 token 仍属于整条原始执行链。连接错误会使真实 provider Promise 拒绝并结束等待。

## 取舍与可用性限制

全程未持有磁盘提交锁，原 CAS 不变。没有建立持久 host 注册或恢复锁平台。代价是完全 headless 的设计回合无法证明桌面是否仍持有未保存内容：30 秒没有 flush 回执则明确失败，保留已接受的输入历史、画布和 Agent 文件，不自动重试。在线桌面即使零画布实例也能回执空 flush。普通非设计会话跳过握手；不能将此实现称为所有 headless 设计路径无回归。

取消后的迟到文件保留在原工作目录，取消结果不会自动采纳或提交它们；本票只保证 provider 真正结束后才恢复人工编辑，后续继续或诊断属于 T21。多实例另存必须指定 hostId；复制结束只销毁经比对的来源实例，退出放弃也只销毁用户确认的实例。异常多实例脏稿仍依赖既有冲突保稿出口；只读不替代最终版本检查或文件系统隔离。没有运行付费模型、五种 provider 的真实网络调用或平台安装包验收。

## 验证

确定性测试使用手动 Promise 信号和假定时器：多实例/另一作品、在途保存、保存失败、启动失败、关闭重开、断连、取消、迟到回执、结束后刷新等待、异常脏稿拒绝释放、在线零实例及无桌面超时。真实 SessionExecutionService 测试覆盖准备先于 baseline/prompt、失败保留 human history、最终处理与 provider settlement 结束前不释放。AgentClient 测试区分本地 abort 与 provider 回应/断开；产品 session 测试验证缓冲文本、实际 beforeinput 阻止、受控 flush；已构建的语义 bridge 测试验证尺寸命令、undo/redo 只读拒绝及解锁恢复。

`corepack pnpm check` 已通过，包含全仓类型、lint、测试、i18n、公开与平台边界。Bento 资源和 Electron 本地构建通过；独立 Chromium 使用实际打包资源验证属性修改、readonly 后属性/undo/redo 拒绝、普通保存拒绝及受控 flush。既有 opt-in P1 probe 早于 daemon 初始化，因此仅该合成验证入口注入明确 idle 查询；产品仍默认 unknown 只读。该 probe 不代表真实 provider 全链路或签名安装包验收。

Electron 39.5.1 / macOS arm64 的实际 P1 probe 通过：三个 WebContentsView 分别持有不同 dirty 文档，未指定实例的 copy 拒绝，指定第二实例复制/结束只关闭第二实例，第一与第三文档保持完整；随后放弃第一实例仍保留第三实例 dirty 文档。销毁以 destroyed 事件确认，无 sleep。原编辑、隐藏后 undo/redo、冲突保稿、PNG/JPEG 与退出失败保稿也通过。该运行使用独立 `/tmp/folio-t02-p1-data` 和 `/tmp/folio-t02-p1-user`，非打包运行。`corepack pnpm format`、`corepack pnpm run docs check` 与 `git diff --check` 通过；最后探针改动另经 Electron typecheck 和公开/平台检查。
