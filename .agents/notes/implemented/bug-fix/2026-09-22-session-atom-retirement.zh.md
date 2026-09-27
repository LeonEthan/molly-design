# 删除会话后释放 renderer 状态索引

Status: implemented
Translation: pending
PR: [#54](../process/2026-09-24-github-repository-rebuild.md#pr-54)

## 摘要

画布 Session 分区回收后，完整 Work 长测的 renderer JS 堆仍缓慢增长。充分预热后的首尾快照显示会话相关状态按删除次数增加；确定性回归进一步确认，界面卸载且文档已删除后，模块级 atom-family 索引仍保留该会话。现由已有元数据订阅在明确的删除事件到达时移除九类临时状态索引，不改变导航、归档、临时缺失时的状态保留，也不删除持久元数据或作品文件。确定性回归与重建后的同条件 Work 诊断通过，atom 状态和 Role 快照不再随删除次数累积；后段 renderer JS 堆增量从约 1.60 降到 1.17 MiB。剩余增量仍以代码类为主，尚未证明长期达到平台，不能宣布 #45 已解决。

## 证据

接续 [#45](https://github.com/LeonEthan/molly-design/issues/45) 与[隔离分区回收](2026-09-21-design-session-reuse.zh.md)。用户执行本地 `renderer-tail-diagnostic.sh`：预热 60 次、测量 60 次、每 5 次采样，首个测量检查点后捕获基线堆。轮次 `2026-09-22T01-14-06-511Z-f6f98783` 功能操作全部通过，耗时 503275 ms；比较区间为总第 65 至第 120 次，包含 55 次额外生命周期。

- GC 后 renderer JS 堆由 72540712 到 74222788 字节（+1682076，约 1.60 MiB），12 个检查点 Theil–Sen 斜率约 28.66 KiB/次。未达到 4 MiB 候选阈值不是无增长证明。
- 首尾快照聚合 `self_size`：`code` +1016468 字节（约 0.97 MiB），普通 `object` +220884 字节，另有字符串、数组、闭包和原生 Wasm 内存变化。605 份 `{d,p,v}` atom 状态、55 份会话元数据及 55 份 Role 快照等形状增量与生命周期数量相关，但聚合自身大小不是独占保留量，不能把全部增量都归因于本次修复。
- 主进程 JS 堆检查点净减少约 0.41 MiB，私有内存/RSS 分别增加约 32.55/29.41 MiB；私有内存的主要跳变发生在基线快照采集之后。该诊断轮用于对象比较，不替代无中途快照的标准 Scout 内存趋势。
- 基线和末尾主堆均为 2 个原生 Session、0 份 HTML Buffer；分区回收没有退化。DOM 节点各点为 787、总进程为 9；监听器通常 410、部分为 411、末点 420，不宣称该轮监听器全程不变。
- 紧反馈使用现有 `docMetaSubscriptionAtom`、真实 Jotai store 与公开 repo watch 事件双替身：订阅会话 atom，再卸载，发出明确删除事件；元数据投影已经没有会话，而 `sessionMetaAtomFamily.getParams()` 仍含其 ID。修复前断言确实失败：`expected [...] to not include 'session-deleted-atom-lifetime'`。新测试使用 fake timers，不等待真实时间、不依赖 GC、内存阈值或 mock 调用次数。

## 修复与边界

`doc-meta.ts` 的已有文档存在性处理器在 `deleted` 分支清除投影之后，调用各 family 的公开 `remove`：会话元数据，四类子/关联会话投影，两类在线状态，以及 Role 临时选择和已水合快照，共九类。共享订阅是生命周期入口，不把清理绑定在某个删除按钮上；repo 的明确删除事件才提供清理授权。现有删除/恢复 epoch、异步读取失效和元数据合并逻辑保持不变。

- 普通卸载、导航、归档以及 `missing` 不清除 family，保留未发送 Role 选择与原有身份。
- 明确删除后不再由这些索引保留旧 atom。已持有 atom 的消费者仍由 Jotai 管理到卸载；这不是按 ID 永久拒绝访问的黑名单。若权威元数据稍后恢复，新查找创建新 atom，由元数据/持久 Turn 重新水合，而不复活删除前的未发送选择。
- 不改 loro-repo 元数据缓存、CRDT 删除记录、持久 Turn、画稿、分区池、导航缓存、Wasm 分配器或 Scout 阈值。本次有确定性保留证据，不将仍未归因的代码类增长当作同一责任链。

曾考虑界面卸载即清理，但会破坏导航返回时的 Role 选择；仅在删除按钮清理则遗漏 daemon 发来的删除事件。统一清空缓存会影响存活会话，因此只移除已删除 ID。没有新增定时回收、后台扫描、存储层或全局淘汰协议。

## 验证与限制

- 新增回归覆盖卸载后删除、归档保留、临时缺失保留、兄弟会话索引身份不变，以及同 ID 恢复后的新元数据/空临时 Role 状态。现有相关五个文件共 78 项通过；组件类型检查通过。
- 首次执行测试脚本的 `--` 参数触发组件全套而非单文件：3194 项通过，仅新增回归失败。修复后的定向命令改为 `pnpm --filter @molly/components exec vitest run tests/doc-meta-subscription.test.ts tests/doc-meta-session-list.test.ts tests/doc-meta-presence.test.ts tests/use-session-agent-role.test.tsx tests/use-session-actions.test.ts`，避免误解执行范围。
- `pnpm check`、`pnpm --filter @molly/electron build:app`、`pnpm format`、`pnpm run docs check` 和 `git diff --check` 通过。全仓组件测试 3195 项通过；公共边界扫描 4272 个文件、24 个 manifest。构建保留既有大 chunk 警告，文档保留 15 条既有规则大小警告，翻译 pending。
- 新构建的 `pnpm --filter @molly/e2e canvas:resources` 通过，目录 `molly-canvas-resources-GnCO8Z`：串行分区 1、同时存活分区 3、HTML Buffer 0。这是原生画布隔离与释放的回归，不代替 renderer 状态的完整 Work 验收。
- 新构建完整 Work 已由用户终端完成，使用同一后段诊断脚本；结果见下节。自动化宿主完整旅程仍受 macOS Keychain 限制，不增加明文凭据或绕过加密入口。
- 只保存公开合成测试与结论；本地堆快照和诊断输出不提交。Spec 意图和状态不变，没有提交、推送或关闭 Issue。

## 修复后同条件 Work 诊断

2026-09-22 用户完成轮次 `2026-09-22T01-39-46-309Z-adb00f59`：预热 60、测量 60、每 5 次采样并捕获基线堆，全部操作通过，耗时 494639 ms。与修复前相同，首尾比较覆盖总第 65 至第 120 次的 55 次额外生命周期。以下按形状聚合，不依赖跨快照节点 ID；形状自身并非业务类型证明，结合确定性删除回归判断修复效果。

| renderer 对象形状 | 修复后基线数量 | 修复后末尾数量 | 净增 |
| --- | ---: | ---: | ---: |
| atom 状态 `{d,p,v}` | 121 | 121 | 0 |
| 派生 atom `{read,toString}` | 29 | 29 | 0 |
| atom `{init,read,toString}` | 3 | 3 | 0 |
| 可写 atom `{init,read,toString,write}` | 68 | 68 | 0 |
| Role 快照 `{currentTurnKey,knownTurnKeys,providerKey,roleId,roleRevision}` | 1 | 1 | 0 |

修复前同条件区间分别新增 605 份 atom 状态、385 份派生 atom 和 55 份 Role 快照；本轮相应净增均为零，确认所复现的索引累积已经消除，不只是落到内存候选阈值以下。

- GC 后 renderer JS 堆由 72047500 到 73270856 字节（+1223356，约 1.17 MiB），较前轮 1.60 MiB 降低约 27%；Theil–Sen 斜率约 22.06 KiB/次，仍为正。不同进程的运行时波动意味着不能将减少的每个字节都归因于本次修复。
- renderer 快照聚合 `self_size` 中，普通 `object` 净增由 220884 降到 19724 字节，`array` 由 150060 降到 15460 字节，`closure` 由 +47584 变为 -56 字节；`code` 仍增加 1004868 字节（约 0.96 MiB），接近修复前 1016468 字节。另有原生 ArrayBuffer backing store +1179648 字节且数量不变，`PerformanceMeasure` +220 个、27296 字节等未在本次修复中处理的变化。原生 backing store 不应直接加到 JS 堆指标上；聚合自身大小也不是独占保留量。没有证据把全部代码增长归为正常预热，或据此对 Wasm/持久元数据实施清理。
- 基线和末尾主堆均为 2 个原生 Session、0 份 HTML Buffer，分区回收未退化。12 个 GC 后检查点总进程数均为 9；DOM 基线和末尾均为 787，第 55 次测量暂为 848；监听器通常为 410，第 25/55 次暂为 419/427，末尾回到 410。没有宣称全部检查点完全不变。
- 主进程 GC 后 JS 堆净减少约 0.45 MiB，私有内存增加约 15.99 MiB；主进程/renderer RSS 分别减少约 33.84/93.75 MiB。中途快照扰动仍存在，这些数值不替代无中途快照的标准趋势，也不证明整体无泄漏。本轮没有 Scout 候选不等于长期稳定。

本轮完成已确认 atom 生命周期缺口的完整 Work 验证，不继续以重复加长同一旅程作为修复证明。尚未归因的代码/Wasm 与少量其他保留需要可区分假设的独立诊断；在获得持有关系和可复现边界前，不扩大运行时清理或改动隔离、持久化语义。#45 的整体长期稳定性结论仍开放。

后续独立诊断及计时记录释放见 [renderer 内存持有关系](2026-09-22-renderer-memory-ownership.zh.md)：分开编译代码、两份 Wasm memory、路由匹配缓存与滚动历史，不改写本轮的原始结果。
