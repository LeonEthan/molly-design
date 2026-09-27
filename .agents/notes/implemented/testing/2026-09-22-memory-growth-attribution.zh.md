# 内存增长的分配归属与测量边界

Status: implemented
Translation: pending
PR: [#54](../process/2026-09-24-github-repository-rebuild.md#pr-54)

## 摘要

接续[历史缓存退休调查](../bug-fix/2026-09-22-history-metadata-retirement.zh.md)，本轮将剩余内存增长拆分为进程记账、分配器容量和具体原生持有者，避免把私有内存斜率直接当作泄漏量。实测确认主进程普通 GC 后仍保留大量几乎空闲的 V8 容量，确定性内存 dump 会额外触发低内存回收；macOS 的共享内存扣除变化也会单独推高私有指标。空白窗口的小项已定位到延迟 KeepAlive 生命周期，实际 Work 的每轮 64 字节候选则定位到有界 StorageArea 缓存，分别通过时钟和跨缓存边界对照验证释放。本轮未证实需要新增运行时修复；旧标准长测的数 MiB 增量仍未逐字节解释，不据此宣布全部稳定。维护者随后接受当前限制并阶段性关闭 Issue #45，后续优化保留在原 Issue 的 comment。

## 调查与判据

本记录落实的决定是：用持有者、容量和操作对照解释总量，不以一次 GC、RSS 下降或 Scout 阈值结果判断泄漏是否消失。产品运行配置、持久数据语义和原生安全设置不为测量数字改变；原生注入只进入隔离诊断进程，不进入产品包。

有效反馈包括：真实桌面 Work 生命周期的标准采样；相同 Work 附加 detailed dump 的归属采样；原有 renderer 堆快照中的实际缓存表；固定键和新键的 Flock 对照；只加载 about:blank 的 Electron 窗口回归。后两类只证明各自缩小后的机制，不能代替真实 Work。

## 主进程 private 不是存活分配量

`e2e/src/support/resource-probe.ts` 的 `privateBytes` 来自 `process.getProcessMemoryInfo().private * 1024`。Electron 39.5.1 的 macOS `app.getAppMetrics()` 只有 resident/peak resident；前者另走 Chromium 的单进程 background summary dump，返回 `private_footprint_kb`。见 [Electron 绑定](https://github.com/electron/electron/blob/v39.5.1/shell/common/api/electron_bindings.cc)及[进程指标实现](https://github.com/electron/electron/blob/v39.5.1/shell/browser/api/process_metric.cc)。

匹配 Chromium 142.0.7444.265 的[计算公式](https://github.com/chromium/chromium/blob/142.0.7444.265/services/resource_coordinator/memory_instrumentation/queued_request_dispatcher.cc)是 `max(phys_footprint_bytes / 1024 - shared_resident_kb, 0)`。物理 footprint 取自 Mach `TASK_VM_INFO.phys_footprint`；扣除项取自 memory graph 的 `shared_memory` 大小。返回的 `shared_footprint_kb` 则经过共享归属图计算，两种 shared 概念不能普遍互换。见 [Mach 字段读取](https://github.com/chromium/chromium/blob/142.0.7444.265/base/process/process_metrics_apple.mm)。

新的无中途 detailed dump Work 30，目录为 `e2e/artifacts/debug-issue45/root-followup/plain-runs/2026-09-22T08-08-46-154Z-416bee2f`。普通 post-GC 采样第 10→30 次：主进程 heap used 增加 333792 字节、heap total 增加 524288 字节、private 增加 5134336 字节。随后主进程的第二次读数如下；不可与前一个采样时刻混算：

| 后续读数                     | 第 10 次 | 第 20 次 | 第 30 次 |
| ---------------------------- | -------: | -------: | -------: |
| private，KiB                 |   134369 |   136913 |   138929 |
| shared，KiB                  |    12272 |     6096 |     6096 |
| 二者实测和，KiB              |   146641 |   143009 |   145025 |
| vmmap 物理 footprint，约 MiB |    143.2 |    139.7 |    141.7 |

private 增加 4560 KiB，但 shared 减少 6176 KiB，二者和下降 1616 KiB；独立 vmmap 物理 footprint 也下降约 1.5 MiB。这直接说明共享扣除变化会产生与物理总量不同方向的斜率，不能把 private 增量全部归为新增存活对象。此处相加是观测对照，不把两个 shared 指标宣布为等价。第 30 次 vmmap 还报告 17.3 MiB swapped，第 10 次仅 32 KiB；RSS/dirty resident 的下降也不能代表全部内存义务消失。

## 普通 GC 与确定性 dump 的差异

同一 plain Work 完成第 30 次后才开启 trace 并做一次确定性 detailed dump，前后没有新增 Work：

| 主进程指标                   |  dump 前 |  dump 后 |
| ---------------------------- | -------: | -------: |
| V8 heap used，字节           | 37749252 | 37516680 |
| V8 heap total，字节          | 78577664 | 38731776 |
| V8 heap physical，字节       | 78577664 | 38469632 |
| new_space physical，字节     | 32505856 |   262144 |
| old_space physical，字节     | 32505856 | 25952256 |
| private，KiB                 |   138929 |   105729 |
| vmmap 物理 footprint，约 MiB |    141.7 |    113.5 |

普通 GC 后 new_space 容量约 31 MiB，但第 10/20/30 次使用量仅 39976/212632/100708 字节。终点 dump 回收约 40 MB V8 physical，live heap used 只减少约 0.23 MB，支持“空闲容量”而非同等大小存活 JS 图的解释。诊断本身同时增加 trace/共享缓冲，不能把 V8 的降幅直接等同于整个进程的降幅，也不据此向生产加入强制 GC。

源码链已核对：CDP [TracingHandler](https://github.com/chromium/chromium/blob/142.0.7444.265/content/browser/devtools/protocol/tracing_handler.cc) 将 `deterministic: true` 映射为 `kForceGc`；[gin dump provider](https://github.com/chromium/chromium/blob/142.0.7444.265/gin/v8_isolate_memory_dump_provider.cc) 调用 `LowMemoryNotification()`；[V8 14.2.231 基础版本](https://github.com/v8/v8/blob/14.2.231/src/api/api.cc) 再调用 `CollectAllAvailableGarbage(kLowMemoryNotification)`。这与原探针对 main 的普通 `global.gc()` 不同；V8 基础 tag 不表示 Electron 补丁逐字节相同。

另一组每 10 次插入 detailed dump 的 Work 30，目录 `.../root-followup/runs/2026-09-22T07-57-34-789Z-bc8a4c7a`，第 10→30 次的 PartitionAlloc（PA）数据为：

| 分配器指标，字节         | 第 10 次 | 第 30 次 |
| ------------------------ | -------: | -------: |
| active allocation        | 37301712 | 36747200 |
| 当前 committed           | 52805632 | 52854784 |
| 最大 committed 高水位    | 52805632 | 63160320 |
| IndexedDB 归属           |   544644 |  2106169 |
| V8 utility heap physical | 37863424 | 38174720 |

IndexedDB 增长时 PA 总 active 反而减少，排除了“private 全部增量就是 malloc 存活总量增长”的读法。SQLite、localstorage 归属分别增加 55976、6873 字节；父子节点、共享缓存和 allocator 归属不能重复相加。PA active 是分配器记账，不是对象可达性证明；其 `size` 对应 provisioned resident 统计，不能当作 Mach 页面实测。定义见[分配器统计](https://github.com/chromium/chromium/blob/142.0.7444.265/base/allocator/partition_allocator/src/partition_alloc/partition_stats.h)及[dump provider](https://github.com/chromium/chromium/blob/142.0.7444.265/base/trace_event/malloc_dump_provider.cc)。

本机 vmmap 无法载入 PA malloc zone introspector，zone 表不完整；仅用 Mach VM-region 汇总作 OS 对照。[PageTag 定义](https://github.com/chromium/chromium/blob/142.0.7444.265/base/allocator/partition_allocator/src/partition_alloc/page_allocator.h)确认 Tag 253 是 PA、255 是 V8。本组物理 footprint 为 109.3/108.6/110.4 MiB，主要 dirty 变化集中于这两类。首次 dump 已收缩 V8 容量，因此这组曲线不能代替标准 Work 趋势。

## Renderer：后段缓存与持久数据规模

重新分析 `e2e/artifacts/scout/2026-09-22T01-39-46-309Z-adb00f59/work` 第 65→120 次的堆快照，直接遍历 LRU 的 Map：chatStreamItems 20→20、scrollPosition 50→50、virtualizer 50→50；raw chat/message wrapper 均为 41→41。React hook state 5225→5225、effect 1402→1402、context dependency 920→920。这支持此前前段 wrapper 增长属于缓存填充，未证实新的无界 JS 持有者；这些旧快照也不能逐项解释最新无快照标准测量。

以同一桌面 Wasm 重新运行 Flock 固定键/新键对照，第 100/200/300/400 次：

| 写入模式   | Wasm buffer 容量，字节                | 持久文件字节                  |
| ---------- | ------------------------------------- | ----------------------------- |
| 覆盖固定键 | 均为 1310720                          | 均为 634                      |
| 每次新键   | 3997696 / 5636096 / 7208960 / 9895936 | 10137 / 19670 / 29186 / 38721 |

额外 200 次只读扫描没有继续增加容量。`memory.buffer.byteLength` 是容量/高水位，不是 Rust 对象独占 retained size。新键和软删除历史继续按现有恢复、同步语义持久化；此处不以丢弃历史制造平台期。脚本与结果位于 `e2e/artifacts/debug-issue45/renderer-followup/` 及 `flock-browser-{same,unique}.jsonl`。

## 空白窗口：定位延迟的原生持有链

独立 Electron 39.5.1 arm64 探针确认：30 个 BrowserWindow wrapper 已全部 finalize、WeakRef 存活为 0、只剩控制窗口；重复 10 次 GC 仍有 BRP 隔离区增长。加载 about:blank 才出现，创建但不 load 的对照不增长。匹配二进制 UUID 的官方符号将主要 56 字节 payload（64 字节 allocator slot）定位为 `mojo::ReceiverSet<blink::mojom::KeepAliveHandleFactory>::ReceiverEntry`。

[KeepAliveHandleFactory](https://github.com/chromium/chromium/blob/142.0.7444.265/content/browser/renderer_host/keep_alive_handle_factory.cc) 销毁后将 Context 留在延迟任务中，[超时常量](https://github.com/chromium/chromium/blob/142.0.7444.265/content/browser/renderer_host/render_process_host_impl.h)为 30 秒；[ReceiverSet::OnDisconnect](https://github.com/chromium/chromium/blob/142.0.7444.265/mojo/public/cpp/bindings/receiver_set.cc) 删除 entry 后仍留有[当前上下文指针](https://github.com/chromium/chromium/blob/142.0.7444.265/mojo/public/cpp/bindings/receiver_set.h)，使已释放 slot 在 Context 存活期间留于 BRP。

诊断只使用 Chromium 已有 scoped test clock，在同一原生进程中推进时间而不 sleep：+1 秒无变化；+60 秒释放 30 项/1920 字节，已识别地址全部退出隔离区。去掉观察器也复现释放；90 窗口分三批，每批后推进 60 秒，30/60/90 次的基线均为 25 项/1776 字节，90 个 wrapper 全部 finalize。基线其他项不声称归零或全部解释。

这修正了“空白窗口小项必然永久累积”的推断，但不能外推到 Work。上述 Work trace 的 10/20/30 次 BRP 为 45/55/65，采样间隔约 42 秒，30 秒的空白窗口链不足以解释它。不移除 keepalive 语义、不关闭 BRP，也不以复用窗口替代正确归因。

## 实际 Work：有界 StorageArea 缓存

实际 Work 原生取样 `native-followup/work-runs/2026-09-22T08-15-23-099Z-6620c7e5` 第 10 次确认 10 个不同的 `mojo::ReceiverSet<blink::mojom::StorageArea>::ReceiverEntry`，各自来自第 1→10 次操作；每个 payload 56 字节、一个未释放的 BRP 引用。这组全类型观察器随后达到显式的 65536 条安全容量而报错，宿主完成退出；只有第 10/20 次 allocator 样本，不能宣称存在第 30 次或 Work 推进时钟结果。

产品提交会隐式创建画布。每次画布使用独立 origin，继承的 Bento 偏好初始化读取 localStorage；它与不访问存储的空白窗口不是同一持有链。独立最小对照使用同一临时 Session、逐次新 origin 的 WebContentsView，执行一次 `localStorage.getItem()`，等待 destroyed 及现有四项清理 Promise。30 次后推进 60 秒，30 个 StorageArea slot 仍在而 KeepAlive slot 释放；额外 `clearStorageData({origin, storages:['localstorage']})` 无效，不读取 localStorage 的对照则只留下固定基线。

匹配版本 [LocalStorageImpl](https://github.com/chromium/chromium/blob/142.0.7444.265/components/services/storage/dom_storage/local_storage_impl.cc) 的桌面缓存淘汰预算是 50 个 area / 20 MiB；检查发生在插入前。这里的 51 条边界针对单 Session、串行关闭视图后留下的 unused areas，下一次新 origin 会退休未使用 holder。仍有 active bindings 的条目不会因超预算被删除，因此这既不是每个 Session 的全部存储硬上限，也不是跨并发 Session 的全应用上限。[StorageArea](https://github.com/chromium/chromium/blob/142.0.7444.265/components/services/storage/dom_storage/storage_area_impl.cc) 持有上述 Mojo receiver。只观察匹配 StorageArea 类型的 150 次对照跨过两次清理边界：

| 迭代                        | 当前保留的 StorageArea entry |
| --------------------------- | ---------------------------- |
| 10 / 20 / 30 / 40 / 50      | 10 / 20 / 30 / 40 / 50       |
| 60 / 70 / 80 / 90 / 100     | 9 / 19 / 29 / 39 / 49        |
| 110 / 120 / 130 / 140 / 150 | 8 / 18 / 28 / 38 / 48        |

证据为 `native-followup/storage-read-150.log`，隔离目录 `molly-native-followup-gJa7eA`；150 个 view wrapper 全部 finalize、原生元数据无无效记录。另一次 104-origin 精确边界对照在第 51→52、102→103 次均观察到 51→1，确认淘汰时点。150 次终点推进 60 秒释放 150 个 KeepAlive slot，48 个 StorageArea 保留至容量淘汰。它证伪了这条小项按新 origin 永久累积的假设，不能证明所有原生分配或总私有内存有界。额外 origin 清理已无收益，删除偏好读取也不再是必要修复；保留来源隔离、现有偏好和 BRP。

## 本地复现与限制

全部原始 trace、堆、符号、诊断注入和捕获日志保留在忽略目录，仅提交本记录。主进程诊断从 `e2e/` 执行：

```sh
pnpm exec tsx artifacts/debug-issue45/root-followup/work-plain-census.mts
pnpm exec tsx artifacts/debug-issue45/root-followup/work-vmmap.mts
```

从仓库根执行纯读取/隔离对照：

```sh
node e2e/artifacts/debug-issue45/renderer-followup/lru-census.mjs <renderer.heapsnapshot>
node e2e/artifacts/debug-issue45/flock-memory-control.mjs same
node e2e/artifacts/debug-issue45/flock-memory-control.mjs unique
env -u ELECTRON_RUN_AS_NODE ISSUE45_WINDOWS=90 ISSUE45_GC_ROUNDS=10 ISSUE45_ADVANCE_EVERY=30 node_modules/.pnpm/electron@39.5.1/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --js-flags=--expose-gc e2e/artifacts/debug-issue45/native-followup/window-retention.cjs
env -u ELECTRON_RUN_AS_NODE ISSUE45_WINDOWS=150 ISSUE45_GC_ROUNDS=10 ISSUE45_QUARANTINE=1 ISSUE45_STORAGE_OBSERVER=1 ISSUE45_ADVANCE_MS=60000 node_modules/.pnpm/electron@39.5.1/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --js-flags=--expose-gc e2e/artifacts/debug-issue45/native-followup/storage-retention.cjs
```

原生详细证据见忽略目录 `native-followup/FINDINGS.md`；主进程完整三点与源代码核对见 `main-followup/FINDINGS.md`。上一轮标准 60 次预热＋60 次测量没有同点 shared 扣除、Mach footprint 和 V8 分区容量，不能把本轮结果追溯为其 +7.56 MiB 的完整解释。下一次标准长测应先保留不受 dump 扰动的结果，再以终点归属/回收对照说明容量；只对已证实失去必要性的持有链实施修复。

## 本轮验证与交付

- `pnpm install --frozen-lockfile`、`pnpm e2e:build` 通过，生产源码保持 `ec32d828` 的既有修复。构建保留既有大 chunk 警告；未修改锁文件、生成资源或 vendor 源码。
- 重建后串行执行 `canvas:resources`、`terminal:resources`、`router:resources` 均通过：画布串行分区 1、同时独占分区 3、HTML Buffer 0；三轮终端 resize/change 残留均 0；120 次导航后的原生历史及滚动缓存均 50，back/forward 321/654、replace/分叉淘汰及 reload 777 恢复通过。证据目录为 `molly-canvas-resources-InpQGy`、`molly-router-resources-bxQWcX`。
- 两次新的 Work 30 分别完成普通采样和转储归属采样；不是重新执行旧 60+60 标准长测。额外 typed Work 因观测器容量失败，其有效样本与限制保留在上文。
- 本轮仅更新调查与解释文档；没有新增生产补丁、测试阈值或持久数据清理，没有提交、推送或关闭 Issue。诊断脚本、原生注入及捕获内容均不进入 Git。

## 阶段性收尾

维护者决定结束本轮专项排查，并在 [Issue #45 的关闭 comment](https://github.com/LeonEthan/molly-design/issues/45#issuecomment-5773885518)中保留后续优化及重新打开条件，不另建 Issue。该 Issue 以接受当前限制、延期优化的方式关闭，不表示整体内存已达到平台期。已确认修复与本归因记录通过 PR #54 交付；Issue 的阶段性关闭和代码合入是独立状态。
