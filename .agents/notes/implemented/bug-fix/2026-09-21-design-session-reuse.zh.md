# 画布隔离分区的生命周期与回收

Status: implemented
Translation: pending
PR: [#54](../process/2026-09-24-github-repository-rebuild.md#pr-54)

## 摘要

清理画布进程、终端监听器和 Session 回调后，反复开关画布仍使主进程私有内存持续增加。Electron 39.5.1 把每个新分区的 BrowserContext 保留到进程结束，清理缓存与存储不能释放分区本身。经用户明确确认，已实现独占租用与关闭后的安全回收：窗口、请求全部结束且清理成功后才可复用，每次使用全新 origin，同时存活的画布不共享 Session。原生隔离回归和完整 Work 三十轮通过，末尾原生 Session 从修复前 34 个降为 2 个（含默认分区），HTML Buffer 残留为零；主进程私有内存增量从约 18.38 降至 6.73 MiB。延长到 120 次后仍只有 2 个 Session、零份 HTML Buffer，但 renderer 最后 60 次仍增加约 1.64 MiB；分区累积已消除，整体长期稳定性未证明，不能因此关闭 #45。

## 问题与证据

接续 [#45](https://github.com/LeonEthan/molly-design/issues/45) 和[回调资源释放](2026-09-21-design-session-callback-retention.zh.md)。两次修复后标准 Work 轮次仍增加约 17.52 / 18.38 MiB 主进程私有内存。首尾堆快照的第 5 至第 30 轮间新增 25 个原生 Session，HTML Buffer 已为零。

修复前 `surface()` 每次用随机 partition 调用 `session.fromPartition`。Electron 固定版本的 [BrowserContext 源码](https://github.com/electron/electron/blob/v39.5.1/shell/browser/electron_browser_context.cc#L306-L331) 使用进程级 `NoDestructor` 映射持有 `unique_ptr<ElectronBrowserContext>`；`From()` 按分区创建或返回已有 context，`DestroyAllContexts()` 才清空整个表。关闭 WebContents 和替换 JS 回调不等于销毁这个原生对象。

无凭据原生对照使用现有 ElectronHarness、真实构建、独立临时 profile。每组新进程，预热 3 次再测 30 次；只加载 `about:blank`，关闭事件后采样并显式 GC，不加载 Bento、不创建画稿、不运行模型。只有分区选择/清理不同：

| 配置 | 末尾原生 Session 数（含默认 Session） | 主进程私有内存首末差 | 本地证据目录 |
| --- | ---: | ---: | --- |
| 每次新分区 | 34 | +16.64 MiB | `molly-session-unique-5KzWoi` |
| 每次新分区，关闭后清存储/缓存/连接 | 34 | +20.48 MiB | `molly-session-cleared-MuJDsK` |
| 关闭并清理后串行使用同一分区 | 2 | +1.03 MiB | `molly-session-reused-xG4woW` |

每组最终堆快照都在采样结束后生成，避免把快照开销算进首末差。内存数值是观察证据，不用作确定性回归阈值；新增分区/Session 数量及上游持有关系才是结构性证据。复用与清理新分区组仅改变分区选择，说明缓存清理本身不是解决方案。该对照没有证明安全可复用真实画布，也没有消除所有运行时初始化开销。

复现实验位于本地忽略的 `e2e/artifacts/debug-issue45/session-context-probe.mts`，分别用 `pnpm --filter @molly/e2e exec tsx artifacts/debug-issue45/session-context-probe.mts unique`（或 `cleared`、`reused`）串行运行。快照只留本机，不提交。

## 已确认实现与边界

2026-09-22 用户明确同意新增隔离 Session 回收复用并继续实现、验证。`design-session-pool-core.ts` 管理可复用分区及一次性租用；`design-session.ts` 只创建 Molly 私有非持久分区，普通编辑器、源预览、导出和固定样稿共用此入口。保存确认仍由原有调用方负责，Bento 不感知这套生命周期。

- 仅回收 Molly 画布专属的非持久分区。新活动画布独占一次租用与全新的随机 origin；不触碰主窗口、浏览器、用户 Session 或凭据。
- 关闭保持现有保存/取消语义；租用立即失效、回调换为拒绝处理器，再关闭所属 WebContents。实际 `destroyed` 事件与所有已接纳请求结束后，才执行 `clearData`、`clearCodeCaches`、`clearAuthCache`、`closeAllConnections`。全部成功才进入可用集合；失败报告并隔离该分区，不自动重试。`clearData` 使用 [Electron 的完整清理 API](https://www.electronjs.org/docs/latest/api/session#sescleardataoptions)，不是只清 HTTP cache。
- 同时存活的编辑器、源预览和导出继续各自隔离；不能按画稿 id 共享，因为同稿也可能并发存在不同 host 与预览。
- 每个协议请求通过该租用的 `run` 接纳和结算；异步 body 读取、写入入队后的执行、保存响应以及 toolbar 查询/应用前显式检查租用仍存活。已退休租用不能因原 Session 被新租用取得而重新授权，旧响应也不发布。关闭前已经交给 worker 的合法写入继续等待完成，不假装能够撤销已经接受的文件操作。
- 获取分区可以等待已无请求/窗口的清理任务，但不等待仍在排空的旧请求。toolbar 查询可能触发画布替换，等待该请求后才能打开替代画布会形成循环依赖。此时分配另一独占分区；数量跟随同时存活/排空的工作量，清理失败的隔离分区是明确例外，不承诺绝对固定数量。
- Native construction 通过租用登记窗口，构造、设置或加载失败也释放租用。普通隐藏不调用退休；重开保持原 WebContents、撤销和租用。原生销毁未完成前，即使已经提出关闭请求，也不会回收。

## 验证

- 原生 `canvas:resources` 在旧构建确实失败：三次串行 attach/close 留下三个分区，断言 `3 !== 1`。修复后的完整桌面构建通过：串行分区数 1；三个同时打开的画布（含同稿双实例）分区数 3；新 origin、旧 URL 拒绝、Cookie 清理、隐藏保持原 WebContents、兄弟分区清理不影响存活实例均通过；最后 HTML Buffer 为 0。本地堆证据目录 `molly-canvas-resources-59vStE`。首次扩展探针错误地任选同稿实例，导致隐藏断言误报；改为精确原生 ID 后通过，未据此修改产品行为。
- 7 项新增确定性核心测试覆盖清理屏障、窗口销毁屏障、并发独占、退休后延迟请求拒绝、已接受请求排空与旧响应拒绝、清理失败隔离、重复退休以及构造失败。延迟请求通过显式 Promise 信号控制，不使用睡眠/GC/RSS 阈值；端点接线另由实际原生访问与代码核对验证，不声称用原生网络重现了所有 body 分片时序。Electron 包总计 172 项、会话删除钩子 52 项通过；最终 xterm 原生三轮 resize/change 残留均为零。
- 已有原生 P0 与 P1 探针通过，目录 `molly-session-reuse-verification-hh5UL1`：固定样稿重开像素相同，PNG 透明/JPEG 白底；真实保存、撤销重做、冲突保稿、隐藏重开、迟到初始加载、失败退出保留编辑、多实例复制/放弃、源预览、版本流程与 913×617 导出仍通过。仅开发构建 macOS arm64，不是安装包或视觉验收。
- 实际 `design.create → attach → close` 的独立诊断预热 3 次、测量 30 次，共创建 33 份合成画稿。目录 `molly-canvas-soak-ujaPva`；预热结束至第 30 次测量，主进程私有内存由 128910336 到 129549312 字节（+638976，约 0.61 MiB），RSS 净变化约 -0.22 MiB；最终 Session 数 2（含主窗口默认分区）、HTML Buffer 0。该结果验证画布分区不再按历史次数积累，不等同完整 Work 或 renderer 长期稳定。脚本保留在本地忽略的 `e2e/artifacts/debug-issue45/canvas-soak.mts`，堆快照只在测量结束后获取。
- `pnpm check`、`pnpm e2e:check`、`pnpm --filter @molly/electron build:app`、`pnpm format`、`pnpm install --frozen-lockfile` 通过。第一次全仓检查在新探针回调参数的六处变量遮蔽上失败，已修正并完整重跑通过；公共边界检查扫描 4271 个文件、24 个 manifest。
- 最终构建在自动化宿主重试标准 `pnpm e2e:scout --journey work --iterations 30 --warmup 3 --checkpoint-every 5`，轮次 `2026-09-22T00-28-15-545Z-0ae6bcb6` 在 `modelConnections.save` 仍报 `credential_storage_unavailable`，检查点为 0，不是通过或无增长。随后用户终端执行同一命令，轮次 `2026-09-22T00-40-05-916Z-c439c242` 全部操作通过，耗时 146469 ms；没有降低加密或凭据隔离。
- 该标准 Work 的六个 GC 后检查点 renderer 数恒为 1、总进程数 9、DOM 节点 787、事件监听器 410。末尾主堆原生 Session 为 2（默认分区与一个画布分区），HTML backing store 为 0；此前相同三十轮末尾为 34 个 Session。结合确定性隔离测试与独立画布诊断，确认分区不再按历史打开次数积累。
- 第 5 至第 30 轮主进程私有内存由 141034496 到 148096000 字节（+7061504，6.73 MiB），此前未复用的标准轮为 +18.38 MiB；主进程 JS 堆 +0.62 MiB，RSS -53.59 MiB。不同运行的内存差值受运行时和系统影响，不将减少的每个字节归因于回收，也不以未达到 Scout 阈值证明长期稳定。
- 同轮 renderer JS 堆由 66705560 到 70911480 字节（+4205920，4.01 MiB），是唯一 Scout 候选。每五轮增量依次约为 1.81、0.89、0.61、0.42、0.28 MiB，呈减速但仍全部为正；renderer RSS 减少 78.98 MiB 不能反证 JS 堆增长。本轮没有基线堆快照，不能从单份最终快照断言增长类别；此前基线诊断以代码类对象增长为主的发现仍需更长观测验证是否达到平台。未修改候选阈值或未经证实的业务缓存。
- `pnpm run docs check`、`git diff --check` 通过；文档仍有 15 条既有规则文件大小警告，翻译 pending。没有提交、推送、发布 PR 或关闭 Issue；本地诊断脚本和快照保留于忽略的 debug/artifact 或临时目录。

## 120 次延长观测

2026-09-22 用户终端运行 `pnpm e2e:scout --journey work --iterations 120 --warmup 3 --checkpoint-every 5`，轮次 `2026-09-22T00-53-01-623Z-47aa62f0`。只延长次数，构建、预热、采样间隔和阈值不变；未启用基线堆快照。123 次含预热的操作全部完成，耗时 506046 ms，24 个测量检查点。

- 最终主堆仍为 2 个原生 Session、0 份 HTML Buffer。24 个 GC 后检查点均为 1 个 renderer、9 个总进程和 787 个 DOM 节点。监听器基线 410，第 15/65 次暂为 419、第 75/90 次暂为 411，后续均回到 410；没有随次数累积。
- 第 5 至第 120 次主进程 JS 堆 +1.12 MiB、私有内存 +15.55 MiB、RSS +7.83 MiB；renderer JS 堆 +7.18 MiB、RSS -24.88 MiB。renderer JS 堆仍是唯一 Scout 候选；其他指标未标记不能证明它们达到平台。
- 按事先约定检查后 60 次：renderer JS 堆 +1.6445 MiB，Theil–Sen 斜率约 26.80 KiB/次；主进程 JS 堆 +0.4152 MiB、私有内存 +6.1406 MiB。私有内存存在第 90 次的台阶，最后 30 次净减少 0.2344 MiB，不把 RSS/私有内存当作精确对象保留量。

| 测量区间 | renderer GC 后 JS 堆净增 | Theil–Sen 斜率 |
| --- | ---: | ---: |
| 第 30 → 60 次 | 1.3736 MiB | 46.56 KiB/次 |
| 第 60 → 90 次 | 1.0164 MiB | 32.85 KiB/次 |
| 第 90 → 120 次 | 0.6281 MiB | 21.44 KiB/次 |

斜率继续下降，但最后一段仍为正，不能称为已稳定。只比较首尾总量或候选阈值会混合早期预热和较小的后段增长。

同一构建的独立 30 次与 120 次运行末尾快照提供定位线索，不等同同一进程首尾差分：renderer 的 `code` 自身大小相差 +2155804 字节（约 2.06 MiB），普通 `object` +197084 字节，另有数组、字符串和闭包变化；原生 ArrayBuffer backing store 总量 +2031616 字节而数量不变。大 Buffer 的引用和构建产物指向现有 Wasm memory 视图，不能据此认定泄漏或认定仅为正常高水位。部分优化指令流能通过 shared-function 信息追到产品 bundle 的已有函数，但尚未证明所有新增代码的持有原因；不能把所有 `code` 增长直接称为正常 JIT 预热。

对象形状差分还显示约 90 份额外会话元数据/配置、约 987 份 atom 状态等，分别存在于仓库元数据缓存和状态引用链；缓存是否应在永久删除后退出、以及保留总量仍需定向验证。最短引用路径不是独占保留路径，尤其 ephemeron/WeakMap 路径不能作为单一责任归因。没有据这些聚合数删除持久元数据、调整状态缓存或改动产品代码。

下一轮改为后段对象诊断，而非继续加大标准观测次数：预热 60、测量 60、每 5 次检查，启用 `--heap-baseline`。基线在总第 65 次、末尾在总第 120 次，以同一进程的聚合对象和引用结构比较定位后段变化；快照会扰动运行时，不能用该轮 RSS 替换本轮标准趋势。命令封装于本地忽略的 `e2e/artifacts/debug-issue45/renderer-tail-diagnostic.sh`，遵循人工启动、自动保存结果的流程；自动化宿主 Keychain 限制不变。用户随后完成轮次 `2026-09-22T01-14-06-511Z-f6f98783`，renderer 后段仍增长约 1.60 MiB；新增 55 次生命周期对应 605 份 atom 状态等，后续确定性复现与局部修复见[会话状态索引回收](2026-09-22-session-atom-retirement.zh.md)。堆分析脚本同样只留在明确标记的本地 debug 目录，不提交快照或捕获内容。

## 取舍与限制

维持随机分区最简单且隔离边界不变，但生命周期内持续积累；给现有 dispose 添加 clearCache/clearStorageData 无法回收 BrowserContext。统一共享一个分区会弱化并发隔离，不采用。Electron 当前公开 Session API 没有逐个销毁 BrowserContext 的入口；不能调用内部指针或为此关闭 sandbox。升级/修改 Electron 是更大的维护范围，当前不实施。

本次实现依据单独明确确认，而非把免审批执行命令视为放宽隔离保证的授权。不改变产品规格、作品持久文件或 Scout 阈值；Spec 的既有 draft 状态不变。分区回收已通过完整 Work 与 120 次延长验证，但剩余主进程和 renderer 增量尚未证明长期达到平台，#45 不因此关闭。自动化宿主的 macOS Keychain 限制由用户终端完成本次验收，不加入明文凭据或绕过 vault 的测试入口。后续转入后段基线/末尾堆对照，再决定是否需要其他修复；快照扰动与普通采样继续分开解释。
