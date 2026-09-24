# Renderer 剩余内存增长的持有关系与计时记录释放

Status: implemented
Translation: pending
PR: [#54](../process/2026-09-24-github-repository-rebuild.md#pr-54)

## 摘要

接续 [Issue #45](https://github.com/LeonEthan/molly-design/issues/45) 和[会话 atom 退休](2026-09-22-session-atom-retirement.zh.md)，本次修复机器 Flock 诊断计时在浏览器时间线中的持续保留。真实读取路径的确定性回归先失败、修复后通过；代码类增长则通过编译对象关联和禁用 JS 编译的独立 Work 对照归因，不能与对象泄漏混为一谈。另将 Wasm 增量定位到 Flock 的数据内存，验证固定键与新增键的差别，保留现有软删除和持久元数据语义。路由匹配缓存有实测淘汰边界；滚动恢复历史及持久元数据的长生命周期仍需要独立说明，因此本记录不宣布整机内存已稳定，也不关闭 Issue。

## 反馈回路与假设

先恢复当前分支及五项未提交修复，运行 `pnpm run docs status`，重新执行既有首尾堆聚合，得到与上一记录相同的 `code +1004868`、原生 backing store `+1179648`、PerformanceMeasure `+220`。本次没有重置、提交或改写已有修复。采用 diagnosing-bugs 的反馈回路，先提出四个可证伪假设：

1. 时间线持续持有诊断记录：重复同一机器读取也会增加记录；正确释放后原有观察者仍收到记录。
2. 既有函数的编译形成主要 code 增量：关闭相关编译层应消除这部分增长；快照必须验证开关实际生效。
3. Flock 增长跟随保留的数据规模：固定键覆盖与不断新增软删除键应分离；只读阶段不应持续扩大相同数据的 memory。
4. 路由匹配缓存按不同会话增加但有容量上限：超过上限后旧对象应退出，最新对象仍复用；滚动恢复须另查，不能借用匹配缓存的上限。

诊断材料均在本地忽略的 `e2e/artifacts/debug-issue45/`；没有提交快照、捕获内容或用户配置。文中自身大小均为按单张快照节点/类型聚合，跨快照不用节点 ID；代码关联集合在单张快照内去重，但仍不是独占 retained size。最短强引用路径仅用于寻找持有者，不称为 dominator。

## 计时记录：已修复的持续保留

`use-machine-flock-rows.ts` 的 `recordMachineFlockRowsMeasure` 无条件使用递增名称调用 `performance.measure`，没有对应清理。旧构建原生四次 Work 的计时条目数为 5 → 12 → 16 → 20 → 24；独立 30 次对照在第 10/30 次分别有 40/120 条 `lody:machine-flock:sync-once`，其他两类保持 1/7。每次 Work 的四次 sync 与旧 65→120 次快照多出的 220 条吻合。堆中的 Performance → 原生时间线容器 → PerformanceMeasure 路径和公开 `getEntriesByType` 观察共同确认持有者，不归因于画布或文档未关闭。

回归使用已挂载的 `useMachineFlockRows`、真实 Jotai store、公开 `resyncMachineFlockRows` 与合成 Flock 边界。jsdom 缺少 User Timing，因此接入 Node 的真实 performance 时间线，时钟固定为 0，直接消费观察者队列。原行为留下 open/local-read、三次成功 resync 及失败读取对应的 10 条记录，断言确实失败。第一版未挂载消费者的草稿没有触发惰性扫描，失败点错误，已修正为真实消费者后才作红灯证据。

最小修复在记录后调用 `performance.clearMeasures(name)`，仅清理刚创建的唯一名称；不支持完整 measure/clear API 时跳过该诊断。保留 PerformanceObserver 的排队投递和慢操作 debug 输出，错误读取同样通过原有 finally 结算。不再支持从全局时间线回顾这些已完成记录，也不保留第二份自建历史。回归同时验证观察者收到四种标签、失败读取仍失败、其他来源的计时记录不受影响。相关文件 24 项通过。

## Code：编译归因与可验证的对照

最新旧构建后段快照仍用 `2026-09-22T01-39-46-309Z-adb00f59` 的第 65→120 次。通过 `instruction_stream`、`deoptimization_data` → `SharedFunctionInfoWrapper` → 该函数的 script 关联编译负载；集合包括指令、重定位、位置表、反优化表，单张快照内去重。相关负载自身大小增加 985820 字节，其中 code 类型为 980520、hidden 类型为 5300 字节。code 聚合还有 24348 字节未归入这组负载；这些自身大小不是独占保留量。

- 全部带 script 的函数信息为 40789 → 40787；拥有优化代码的函数信息为 2186 → 2506。前者没有按会话增加，后者表明更多既有函数获得编译版本。
- 优化代码数量 2189 → 2515；单函数大多一份（2183 → 2497 个），两份的函数由 3 → 9 个。没有证据说所有函数已完成预热，也没有据此承诺固定的最大字节数。
- 相关负载主要属于已有主 bundle；另有少量 preload、布局和诊断 bundle。不能按 minified 名称把共享匿名函数归为一个业务类型。

独立原生对照使用真实构建和 Work Page Objects，每组新 profile、同样 30 次 Work，比较第 10→30 次，在两点各取堆用于对象比较。只改变诊断宿主的 JS 编译开关，模型连接仍走原加密保存，Wasm、画布隔离及产品代码不变。

| 诊断配置 | GC 后 renderer JS 堆增量 | code 自身大小增量 | 优化代码对象首→尾 |
| --- | ---: | ---: | ---: |
| 默认编译 | 2916092 字节 | 2580468 字节 | 1227 → 1809 |
| `--no-opt --no-sparkplug`，不足以关闭全部优化 | 2310060 字节 | 1781548 字节 | 1223 → 1791 |
| 再加 `--no-maglev` | 102940 字节 | 17708 字节 | 0 → 0 |

证据目录分别为 `controls/2026-09-22T02-02-54-968Z-2e77a73c`、`controls/2026-09-22T02-06-23-233Z-e2360230`、`controls/2026-09-22T02-10-03-960Z-7f3892b1`。中间配置保留了优化代码，明确不把它当作完整消融。有效消融与后段函数关联共同支持主要 code 增量来自运行时编译；这比只延长同一旅程更有辨别力。产品没有禁用 JIT，也没有更改 Scout 阈值。诊断快照扰动 RSS，三组不用于评价 RSS 改善或宣称全部平台化。

## Wasm 与持久元数据：随数据规模保留

旧后段快照中，两份大 backing store 的模块绑定已分开：LoroDoc 导出 `LORO_VERSION/lorodoc_*` 的 memory 首尾均为 1441792 字节；Flock 导出 `rawflock_*` 的 memory 为 2621440 → 3801088 字节。全部 1179648 字节增量属于后者。三份具备 `eventBatcher/inner/listeners` 的 Flock 包装对象首尾均为 3，没有逐次多出包装实例。模块级 Uint8Array 视图指向该 memory，不把共享 bundle Context 中的 MonacoEnvironment 最短路径误判为 Monaco 泄漏。

真实四次 Work 的 metadata Flock 中 `e` 行由 1 到 5，明确删除值由 0 到 4，`m` 行由 10 到 99；`metadataManager.cache.cache` 和 existence 索引各由 1 到 5。源实现 `deleteDoc` 是软删除；元数据可用于读回/恢复，`purgeDoc` 是另一个操作。惰性元数据缓存通过 repo metadata manager 的 Map 持有相同元数据，删除状态不是删除元数据的授权。

最小合成对照用桌面实际加载的 `flock_wasm_bg-DbJW30Eu.wasm`（SHA-256 `9246ae09f885c7deed96a273f64fdaf645703ed41340403809f723fea246fe84`）及其 bundler glue，在 Node 中实例化，不接任何磁盘 repo 或传输。模拟每会话 20 个元数据字段和一份 existence 行，固定 peer 与逻辑时间，每次结束把 existence 写为 false；不使用 tombstone pruning。Node 专用发行二进制摘要不同，早期该版本实验只保留为诊断草稿，表中使用与桌面相同的二进制重跑结果。

| 同一 Flock 中的操作 | 100 次后 memory | 400 次后 memory | 400 次后的保留行 |
| --- | ---: | ---: | ---: |
| 反复覆盖同一会话键 | 1310720 | 1310720 | 21 |
| 每次新增会话键并软删除 | 3997696 | 9895936 | 8400 |

停止写入后各扫描 200 次，两组 memory 字节数均不再增加。固定键的导出文件维持 634 字节；新增键组从 10137 增至 38721 字节。实际应用还保留其他 Flock 的删除记录，此合成对照不是每个实际分配字节的解释，也没有证明存活 Rust 分配的独占大小或 allocator 无碎片。另有旧后段 `Managed<wasm::NativeModule>` 自身大小增加 132085 字节、数量不变，属于模块关联原生内存，不能并入上述 backing store 或宣称已逐字节归因。整个历史数据集继续扩大时，不能承诺 Flock memory 恒定；本次不清空元数据、CRDT 记录或作品，也不把随数据规模增长误称为有固定上限的启动预热。

## 路由对象与尚未解决的边界

旧后段的 `{key,next,prev,value}` 和 `{branch,rawParams,route}` 每次新增一份，强引用路径为全局 router → processedTree → matchCache → get 的 Context → Map。固定依赖 TanStack Router core 1.171.15（此前检查的 1.171.16 属于 DevTools，相关源文件相同） 在此使用容量 1000 的 LRU；原生最小探针向实际构建的 `getMatchedRoutes` 输入 2001 个不同合成 Session 路径，确认旧键退出、最新键仍复用且保留恰好 1000 条。不是按聚合增长斜率推测有界。

另一批 DOM selector → scroll position 对象由模块级 `scrollRestorationCache`（当前旧 bundle 绑定 `GR`）按 history key 持有，不能套用上述 1000 上限。初版快速 hash 导航没有触发完整页面切换，因此其仅两条缓存不是淘汰证据。改为在空 profile 的 chat/archive 之间切换，每次明确等待 router `onResolved`：120 次普通导航后，浏览器 history 长度为 50，而 module cache 经其原有 pagehide 持久化入口暴露 122 条。没有创建模型会话或文档，复现不依赖会话数据规模。只在测量结束触发合成 pagehide 以读取缓存，随后销毁整个隔离宿主。

这是本次明确定位、**尚未修复**的历史淘汰缺口：已经无法通过当前原生 history 返回的记录仍保留在滚动恢复缓存中。当前依赖在 onBeforeLoad 中记录旧页位置，pagehide 序列化整个缓存，未删除淘汰历史的键。原生证据为 `molly-router-control-eti0XV/result.json`，复现命令 `pnpm --filter @molly/e2e exec tsx artifacts/debug-issue45/router-push-control.mts`；匹配缓存的 1000 上限也在该探针中独立验证。安全修复仍须确定旧 history key 的退休入口，覆盖返回/前进、replace、分叉导航及渲染器重载的恢复语义；本次不采用任意长度截断、停用恢复或清空 sessionStorage。该缺口不能归为正常预热，#45 仍有未解决部分。

后续实现、实际依赖版本更正和最新验证见[历史与元数据退休](2026-09-22-history-metadata-retirement.zh.md)。上面的“尚未修复”描述本轮调查结束时的状态，不能覆盖后续结果。

## 验证与限制

- `pnpm install --frozen-lockfile`、相关 24 项回归、`pnpm check` 和桌面 `build:app` 通过；全仓组件 3196 项通过。构建保留既有大 chunk 警告，未提交生成产物。
- 本次自动化宿主的 Keychain 路径已可用，原构建完整 Work 四次及三组 30 次诊断均完成。没有解密、索取凭据或绕过 vault，旧记录中的宿主限制是当时结果，不是当前阻塞。
- 重建后的原生 `canvas:resources` 通过，串行分区 1、并发分区 3、HTML Buffer 0，目录 `molly-canvas-resources-w4mExg`；`terminal:resources` 三次 resize/change 残留均为 0。
- 重建后的四次原生 Work，PerformanceMeasure 数为 0 → 0 → 0 → 0 → 0，持久元数据行数仍与旧构建逐次一致。目录 `inventory/2026-09-22T02-14-59-520Z-c1aa9809`；对照为 `inventory/2026-09-22T02-09-37-705Z-d1840128`，没有通过清除持久数据消掉时间线增长。
- `pnpm run docs check` 和 `git diff --check` 通过；文档只有 15 条既有规则大小警告，翻译 pending。只格式化本次修改的两个 TypeScript 文件，没有为提交执行全仓格式重写。
- Spec 意图和状态不变。未提交、推送、发布 PR、发送 Issue 评论或关闭 Issue。

## 重建后的标准 Work

命令 `pnpm e2e:scout --journey work --iterations 60 --warmup 60 --checkpoint-every 5`，轮次 `2026-09-22T02-19-00-461Z-fb13c5c8`，120 次操作全部通过，耗时 484589 ms。未启用 `--heap-baseline`，没有中途堆快照；12 个测量点仍比较总第 65→120 次。

| post-GC 指标 | 首值 | 末值 | 净增 |
| --- | ---: | ---: | ---: |
| renderer JS 堆 | 72621244 | 73123712 | 502468 字节（0.48 MiB） |
| 主进程私有内存 | 151127040 | 161088512 | 9961472 字节（9.50 MiB） |
| 主进程 RSS | 324763648 | 335986688 | 11223040 字节（10.70 MiB） |
| renderer RSS | 479051776 | 484409344 | 5357568 字节（5.11 MiB） |
| 总进程数 | 9 | 9 | 0 |

renderer JS 堆 Theil–Sen 斜率约 14.13 KiB/次，仍为正。DOM 为 787，第三个测量点暂为 796；监听器为 `[419,410,433,419,410,410,419,410,410,410,410,410]`，末尾回到 410。没有逐次增加的进程或监听器模式，不宣称每个采样点完全一致。

候选为空，但标准趋势仍不能证明全部增长停止。上一轮 1.17 MiB 是带中途快照的诊断轮，本轮 0.48 MiB 不是相同采集条件的因果比较，不能把差额全部算成清理几十 KiB 计时记录的收益。主进程的剩余私有内存/RSS 增量也没有由本轮趋势获得独占分配归因，不能把它们相加成泄漏量。当前已确认计时保留消除；滚动恢复淘汰缺口、持久历史规模及尚未逐字节归因的原生分配仍限制 #45 的整体结论。
