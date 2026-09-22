# 历史滚动位置与删除元数据副本的退休

Status: implemented
Translation: pending

## 摘要

接续 [renderer 内存归属](2026-09-22-renderer-memory-ownership.zh.md) 对 Issue #45 的调查，本次处理浏览器历史淘汰后的滚动缓存和已删除文档的重复 JS 元数据副本。滚动恢复继续使用 TanStack 原键，通过原生历史项的独立 id 记录归属，并在恢复完成后释放确定已退出历史的记录；元数据只释放字段行格式的删除副本，底层 Flock 及存在性记录不变。旧整对象格式仍需前值生成字段删除事件，不能无条件删除这份缓存。原生内存对照将主要增量分别定位到 Wasm 编译/类型反馈和 IndexedDB 写缓冲、读缓存；固定记录覆盖写入验证缓存会换批回落。但小量 BRP 隔离区增长及全部私有内存的边界仍需单独说明，不能据此宣称整个进程零增长。

## 可证伪判断与失败回归

1. 如果滚动缓存未跟随历史退休，那么不创建模型会话的普通导航也会留下不可达历史的记录。实际原生探针 120 次 chat/archive 导航后 history 为 50、缓存 122，断言失败；回退和前进的位置本身仍正确。
2. 如果删除后的 JS 元数据只是重复读取缓存，去掉副本后 `getDocMeta`、列表、远端导入、删除和恢复应保持结果，缓存数量应只包含仍需缓存的文档。新增测试在旧行为上失败：40 个删除文档扫描后保留 41 份缓存（含一个活动文档）；远端删除也未退休。
3. Wasm NativeModule 和主进程私有内存的变化可能是编译、分配器高水位或存活资源，必须分别测量。禁用一个分层编译开关未消除增量，不能据此直接接受或否定整个编译假设。

## 滚动恢复的持有与生命周期

`patches/@tanstack__router-core@1.171.15.patch` 修改实际由 `@tanstack/react-router@1.170.18` 引入的 core。此前调查读取的 1.171.16 实际属于 DevTools 的另一条依赖；两版本的 scroll-restoration 源码、ESM/CJS 产物及路由匹配实现逐字节相同，因此原来的持有关系与 1000 项匹配 LRU 结论不变。本次最初给 1.171.16 打补丁后，真实原生回归仍以 122 > 50 失败；从 React Router 的模块解析路径确认并修正目标后再验证，未把安装成功当作构建已生效。

原有 `scrollRestorationCache` 保存位置，旁边的 `navigationOwners` 仅保存恢复键 → 原生 entry.id 的对应关系。原生四次导航的事件探针确认 push 的 onBeforeLoad 发生在浏览器历史提交前，此时 native key 仍是 from；onRendered 才是 to。因而在离开和渲染后两个入口核对归属，仅在 router location 的 `__TSR_key` 与实际 `history.state` 相同时记录当前归属；内存 history 或尚未提交的路由不能冒领原生项。恢复完成后的微任务对照 `navigation.entries()`，删除已知 owner 不再存活的键；pagehide 在保存前也执行一次。两份数据分别保存在原有 sessionStorage 键及其 `:navigation-owners` 伴随键中，供 renderer reload 使用。

使用 id 而非 key：原生 key 表示历史槽位，replace 会重用它；id 表示具体记录，replace 改变、reload 保留。这由 [HTML NavigationHistoryEntry 规范](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigationhistoryentry-interface) 定义，原生探针另行验证当前 Electron 的行为。不能在 onBeforeLoad 立即删 fromLocation，因为既有恢复逻辑可能仍需从旧元素位置复制到新页。

未引入任意长度截断、全局清空或替代路由器。自定义 getKey、无 Navigation API 的宿主以及升级前缺少归属的缓存继续原行为。缺少归属的旧项保留量受升级时已有数据约束，本修复不会凭无法验证的键猜测历史，也不声称迁移后缓存绝对等于当前历史长度；全新 profile 的持续增长应消除。Molly 的回归使用真实桌面历史，不用 jsdom 模拟历史容量。

## 元数据的持有与生命周期

扩展已有 `patches/loro-repo.patch`，保留原有 ready 时启动 live monitor 的修改。`LazyMetadataCache` 持有读取后的 JS 对象；字段行格式的删除记录由 `e/docId = false` 权威确认后，删除事件退休该副本，后续读取和列表扫描按需从 Flock 返回克隆而不重新缓存。恢复后重新进入活动读取缓存。

没有删除 `m/*`、`e/*`、`ef/*`、`efx/*` 或 CRDT 删除历史。`docIdIndex`、MetadataManager / FlockDocRegistry 的存在性状态需要为同步提供此前状态，继续随持久历史规模增长。此修复只去掉已证实冗余的对象副本，不能承诺随数据集无界扩大时 Wasm memory 恒定。

旧 `m/docId` 整对象行是明确例外：Flock 事件只带新值，生成精确的字段删除 patch 需要上一次对象。保留这种前值；回归验证删除状态下把 `{title, remove}` 替换为 `{title}` 仍发出 `{remove: null}`。现代字段行自带字段级 patch，删除副本不损失该信息。这里没有新增第二份持久存储，也没有改变归档、保存、撤销、冲突或凭据流程。

## 验证记录

- `pnpm --filter @molly/components exec vitest run tests/deleted-metadata-retirement.test.ts`：旧行为两项均失败，修复后通过；加入旧格式/序列化兼容后共三项通过。
- 连同 `doc-meta-subscription`、`use-session-actions` 共 63 项通过。序列化 Flock 在列表读取前后完全一致；新 Repo 导入后仍可读取删除文档并恢复。
- `pnpm check` 通过：组件 3199 项（414 文件）、CLI 3054 项（另跳过 3 项，264 文件）；公共边界检查 4276 个源文件、24 个 manifest。`pnpm e2e:check` 通过。
- `pnpm build` 通过，包含桌面和内置 CLI；修正 core 依赖目标及事件顺序后分别执行 `pnpm --filter @molly/electron build:app`，最终构建再运行 router 原生回归。最终相关 URL 路由与元数据测试 7 项通过。
- `pnpm --filter @molly/e2e router:resources`：真实 Electron 120 次导航后缓存 50、原生历史 50；back/forward 恢复 321/654，replace 和新分支均删除废弃键，reload 仍恢复 777 且键不变。证据目录 `/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/molly-router-resources-Zwxogh`。
- 真实 Work 4 次元数据清点 `e2e/artifacts/debug-issue45/inventory/2026-09-22T04-26-32-227Z-e616d15b`：读取缓存始终 1；存在性记录 1→5，删除记录 0→4；持久 m/ef/efx 的增长与修复前一致；PerformanceMeasure 始终 0。
- 原生 `canvas:resources`：串行 partition 1、并发 Session 3、残留 HTML Buffer 0；证据目录 `/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/molly-canvas-resources-Hj4vay`。`terminal:resources` 三轮 resize/change 监听器均回到 0。
- 本地诊断、截图、堆及捕获日志位于忽略的 `e2e/artifacts/debug-issue45/` 或隔离临时目录，不提交。

## 原生内存：从总量缩小到持有者

此前默认编译 30 次 Work（`2026-09-22T02-02-54-968Z-2e77a73c`）第 10→30 次两个 Managed NativeModule 合计 6495586→6596119 字节，增加 100533。只加 `--no-wasm-tier-up` 的同样 30 次对照（`2026-09-22T04-01-38-691Z-5eb5e0f4`）为 6496677→6597411，增加 100734。此开关未排除 dynamic tiering 或惰性编译；这组负结果不能证明该增量是泄漏。两组 backing store 都增加 393216 字节，数据规模仍在变化。后续对照如下，生产参数保持不变。

### Wasm 编译与类型反馈

实际运行版本为 Electron 39.5.1 / Chromium 142.0.7444.265 / V8 14.2.231.22-electron.0。V8 基础版本 [NativeModule 实现](https://github.com/v8/v8/blob/14.2.231/src/wasm/wasm-code-manager.cc) 与 [WasmModule 实现](https://github.com/v8/v8/blob/14.2.231/src/wasm/wasm-module.cc) 表明估算包含固定 wire bytes、模块结构、编译状态、类型反馈及代码元数据；它不是实际机器码页的完整统计，更不是独占 retained size。源码取自基础 tag 14.2.231，未假定 Electron 补丁版本逐字节相同；以下实测日志提供当前二进制的直接证据。

用相同 30 次 Work、第 10/20/30 次采样，打开 V8 自身 off-heap 输出。两个 wire bytes 大小为 3181260（Loro）和 2255268（Flock）的模块数量固定。对照变量是 Wasm 编译策略：`--liftoff-only --no-wasm-lazy-compilation --no-wasm-inlining` 预先完成 baseline 编译并关闭优化反馈，未改变业务操作或持久数据。

| 编译策略 | 第 10 次 NativeModule 合计 | 第 30 次 | 增量 | 类型反馈 |
| --- | ---: | ---: | ---: | --- |
| 默认 | 6493921 | 6596384 | 102463 | Loro 186404→225240；Flock 159496→180040 |
| eager + liftoff only，无 inlining | 6533416 | 6533448 | 32 | 两模块均为 0 |

默认目录 `e2e/artifacts/debug-issue45/native/2026-09-22T04-19-25-818Z-4e8adf87`；对照目录 `.../2026-09-22T04-22-32-601Z-a2c48ce8`。后者三次 Loro 4066824/4066824/4066856、Flock 2466592/2466592/2466592。这个结果支持主要 NativeModule 增量来自编译与反馈，不能把 32 字节解释为绝对零，也不能把该结论套到线性 Wasm memory：后者另由仍增长的持久 Flock 数据持有。固定模块的代码/函数集合有界，但未来更多文档、类型或工作负载不在本轮边界证明内。此前 JS code 的关闭优化分层对照见前一 owning note，不与此数据相加。

### 主进程 IndexedDB / LevelDB 缓冲

同一默认 30 次 Work 通过 `disabled-by-default-memory-infra` 的显式 detailed dump 获取主进程分配器归属，无中途 heap snapshot。第 10→30 次：

- PartitionAlloc `allocated_objects_size` 35409993→36996800，增加 1586807 字节；存活分配数 202427→199741，并未同向增长。
- `site_storage/index_db` 553873→2106738，增加 1552865 字节；同源数据库名指向 `file__0.indexeddb.leveldb`。
- 该 partition committed 51068928→50003968，resident 49400640→46660352，wasted 15658935→13007168；主进程私有内存却 99304448→104072192。分配器统计不能与进程私有内存一一相减。

IndexedDB 报告的增长与 live allocation 增量在量级上吻合。它是具体持有者证据，不能声称已经逐字节解释 RSS，也不能把 `site_storage` 父项、子项和 `leveldatabase` 共享缓存重复相加。

最小对照 `indexeddb-buffer-control.mts` 在隔离 profile、相同应用 origin 新建仅供探针使用的数据库，对一个固定键覆盖写入确定性 16 KiB payload，每次等待 transaction complete；不删除/清空任何应用状态。写入总量跨过缓冲预算，最终 4096 次、64 MiB 写入后仍只有一条 16 KiB 记录、version 4095。证据目录 `/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/molly-indexeddb-buffer-fgK2bW`：

| 覆盖次数 | IndexedDB 报告字节 | 共享 web block cache 字节 |
| --- | ---: | ---: |
| 0 | 18268 | 0 |
| 128 | 4300047 | 0 |
| 512 | 10741880 | 6138121 |
| 1024 | 13195817 | 8188150 |
| 1536 | 9400639 | 8188915 |
| 2048 | 9802011 | 8186379 |
| 4096 | 11419924 | 8192764 |

读缓存停在约 7.8 MiB，1024→1536 次总报告量下降约 3.62 MiB；这证伪了“该内存项按写入次数永久累积”的假设。匹配 Chromium 版本的 [leveldb_chrome.cc](https://github.com/chromium/chromium/blob/142.0.7444.265/third_party/leveldatabase/leveldb_chrome.cc) 配置正常设备 8 MiB LRU；[env_chromium.cc](https://github.com/chromium/chromium/blob/142.0.7444.265/third_party/leveldatabase/env_chromium.cc) 的 write buffer 使用最多默认 4 MiB 的动态预算；[IndexedDB backing store](https://github.com/chromium/chromium/blob/142.0.7444.265/content/browser/indexed_db/instance/leveldb/backing_store.cc) 使用该缓存和预算，max_open_files 为 80。观测与缓存填充及 memtable 换批一致。

这个边界针对固定数据库/记录、事务结束且存储正常的对照。它不保证所有 native allocation 均已释放，不覆盖无限新数据库、长事务、压缩积压或增长的数据集。固定记录实验中主进程分配器总存活量仍有其他变化，不能用单个缓存上限替代总进程上限。

### 未解决的具体小项与测量限制

默认 Work 第 10/20/30 次，主进程 BRP 隔离区计数 45/55/65，字节 3184/3824/4464，即后 20 次增加 20 项、1280 字节。匹配版本 [malloc dump provider](https://github.com/chromium/chromium/blob/142.0.7444.265/base/trace_event/malloc_dump_provider.cc) 中该字段来自 `total_brp_quarantined_*`；另有独立 cumulative 字段，因此不能把它误读为累计活动计数。这属于小量仍被引用而未归还的原生分配，最小对照进一步将其缩小到 Electron 的窗口生命周期，具体 C++ 持有者仍未确定，未通过关闭安全隔离区来消除数字。

后续四组独立、无模型凭据的最小对照均使用当前二进制、显式窗口 destroyed/清理 Promise、GC 和 detailed dump，不设置固定睡眠，也不使用 RSS 作为断言：

| 操作 | 第 10/20/30 次 BRP 项数 | 对应字节 |
| --- | --- | --- |
| 仅通过 design IPC create/attach/close 画布 | 42 / 64 / 84 | 2976 / 4384 / 5664 |
| Molly 宿主内仅创建、加载 about:blank、销毁 BrowserWindow | 31 / 44 / 53 | 2160 / 4592 / 3568 |
| 不创建窗口，仅对探针独占 Session 执行四项清理 | 16 / 17 / 17 | 1152 / 1216 / 1216 |
| 独立 Electron entry，不加载 Molly 或 Playwright，开关 about:blank 窗口 | 34 / 44 / 55 | 2352 / 2992 / 5296 |

目录分别为临时根中的 `molly-canvas-native-sKOSvo`、`molly-blank-native-Wqi0gs`、`molly-cleanup-native-TTHPBK`、`molly-bare-native-yKawiM`。空白窗口组某个采样还含瞬时大项，不能把所有采样差分都写成严格 64 字节/次；独立 Electron 的第 10→20 次明确增加 10 项、640 字节，画布第 20→30 次增加 20 项、1280 字节。纯清理对照的后段没有增长。独立 entry 只有固定的一个控制窗口通过 Electron 自带 debugger 发起采样，没有应用文档、Session 池或 Playwright 窗口跟踪。

该最小复现说明 BRP 保留不依赖 Molly 的会话数据或清理策略。它仍是未解决的 Electron 39.5.1 窗口销毁后原生保留候选，尚未取得带符号 C++ 分配/引用栈，也未证明全生命周期上限。不会为这几 KiB 改变生产窗口安全设置、复用并发 WebContents 或盲目升级 Electron。它也不能解释整个主进程数 MiB 的私有内存增量；总私有内存仍只有上述具体持有者的部分归因，不称为全部泄漏量或全部正常缓存。

第一次 trace 误收集所有类别导致诊断宿主在最终 JSON 序列化时超过字符串上限；该轮 `2026-09-22T04-13-36-672Z-9dcfaa94` 不作为有效证据。之后限制类别、只保留 allocator 事件并流式写 JSONL，先 4 次 smoke 成功，再运行上述正式对照。所有带 trace 的数据用于归属诊断；最终标准 Work 不开 trace 或中途 heap snapshot，二者不混为同一趋势。

### 本地复现入口

正式回归：

```sh
pnpm --filter @molly/components exec vitest run tests/deleted-metadata-retirement.test.ts
pnpm --filter @molly/e2e router:resources
pnpm --filter @molly/e2e canvas:resources
pnpm --filter @molly/e2e terminal:resources
pnpm e2e:scout --journey work --iterations 60 --warmup 60 --checkpoint-every 5
```

以下是当前机器保留的忽略诊断脚本，工作目录为 `e2e/`；脚本输出隔离目录和聚合指标，不把捕获内容提交到仓库：

```sh
ISSUE45_WASM_TRACE=1 pnpm exec tsx artifacts/debug-issue45/work-native-memory.mts
ISSUE45_EAGER_WASM=1 pnpm exec tsx artifacts/debug-issue45/work-native-memory.mts
pnpm exec tsx artifacts/debug-issue45/indexeddb-buffer-control.mts
pnpm exec tsx artifacts/debug-issue45/canvas-native-memory.mts
pnpm exec tsx artifacts/debug-issue45/blank-native-memory.mts
pnpm exec tsx artifacts/debug-issue45/cleanup-native-memory.mts
node artifacts/debug-issue45/memory-trace-census.mjs <输出目录>
```

## 最终标准 Work（两项缓存修复后）

`pnpm e2e:scout --journey work --iterations 60 --warmup 60 --checkpoint-every 5`，目录 `e2e/artifacts/scout/2026-09-22T04-38-33-906Z-1f66e086`，耗时 489912 ms。120 次全部通过；没有中途 heap snapshot 或 allocator trace，12 个 post-GC 点比较总第 65→120 次。

| 指标 | 首值 | 末值 | 净增 |
| --- | ---: | ---: | ---: |
| renderer JS 堆 | 72053412 | 73066532 | 1013120 字节（0.97 MiB） |
| 主进程私有内存 | 150733824 | 158663680 | 7929856 字节（7.56 MiB） |
| 主进程 RSS | 257228800 | 262094848 | 4866048 字节（4.64 MiB） |
| renderer RSS | 326402048 | 331120640 | 4718592 字节（4.50 MiB） |
| 进程数 | 9 | 9 | 0 |

renderer JS 堆 Theil–Sen 斜率 16.73 KiB/次，仍为正；DOM 始终 787，监听器 `[410,410,410,419,410,410,410,410,410,410,410,410]`。相同无中途堆快照条件的前一轮为 +0.48 MiB / 14.13 KiB/次，本轮并未显示 renderer 总增量改善，不能把小量对象退休直接等同于总堆平台化；需要使用前述特定持有者及编译对照评估机制。Scout 没有候选只是阈值结果，阈值未变。没有用 RSS 下降、少一次 GC 或一次流程通过证明“全部解决”。

独立 Electron 最小复现从仓库根执行（脚本使用临时 userData，不加载产品入口）：

```sh
env -u ELECTRON_RUN_AS_NODE node_modules/.pnpm/electron@39.5.1/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --js-flags=--expose-gc e2e/artifacts/debug-issue45/bare-electron-native.cjs
```

本轮确认修复的是历史滚动缓存和现代删除元数据的重复 JS 副本；编译/IndexedDB 缓冲得到正反对照归因，持久 Flock 数据的规模相关增长保留原语义。BRP 窗口销毁保留及其余私有内存归属是明确剩余限制，未据此关闭 Issue。所有修改保持未提交，未推送、创建 PR 或发布 Issue 评论。

收尾 `pnpm install --frozen-lockfile`、新测试/探针的 Prettier check、`git diff --check` 和 `pnpm run docs check` 通过；文档检查 errors 为空、topics 为空，仍有 15 条既有规则文件大小警告。新记录翻译 pending；未改变 Spec 意图/审批状态。

后续用户明确要求先保存为本地提交。提交前重新运行 `pnpm format`（无额外格式变更）、`pnpm check`、`pnpm run docs check`，全部通过。暂存校验另将两份依赖补丁的空白上下文改为等价表示并更新锁文件哈希；反向应用旧补丁再应用新补丁，确认五个目标文件逐字节相同。本地提交仅保存阶段成果，不表示剩余内存增长已解决，不推送或关闭 Issue。
