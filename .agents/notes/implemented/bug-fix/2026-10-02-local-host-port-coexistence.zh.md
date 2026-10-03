# Molly 与 Lody Nightly 的本地宿主端口隔离

Status: implemented
Translation: pending

## 摘要

Molly 的本地宿主租约使用了已被 Lody Nightly 桌面占用的端口，导致桌面持续重连而未启动 daemon。
本次将 Molly 安装 profile 的租约端口从 17790 改为 17792，复用既有租约、supervisor、探针和 socket 重连。
确定性回归已在旧端点下复现重连，在新端点下到达 owned runtime 的 ready/running。
该修复恢复产品间的端点隔离，不解释历史 daemon 的退出原因，也不自动重启已打开的旧桌面。

## 证据与因果链

- 运行中的桌面确实来自本仓库 `pnpm start:local`，未使用数据目录 override；有效 CLI profile 为 `~/.molly`。
- probe、control、Loro socket 均真实返回 `ECONNREFUSED`；旧 run 记录的 PID 已不存在。
  旧日志只有 ready 证据，缺少可确定退出原因的证据，不能将 stale run 文件当作退出根因。
- Molly 的 host lease 端口 17790 实际由 `/Applications/Lody Nightly.app` 的主进程监听。
  连接被关闭且无 JSON lease 记录，不能当作可附着的 Molly runtime。
- [`CliService`](../../../../apps/electron/src/main/services/cli-service.ts) 在 spawn 前调用
  [`acquireLocalCliHostLease`](../../../../packages/shared/src/node/local-cli-host-lease.ts)。
  [`CliSupervisor.reconcile`](../../../../packages/cli-supervisor/src/supervisor.ts) 在租约被占用、probe 无 runtime 时保持重试，未进入 `prepareLaunch/spawn`。
- 使用旧构建和全新临时 profile 的真实桌面复现：IPC 状态为 `reconnecting`，
  `message=Another local CLI host owns the runtime; retrying in 1s`，`retryInMs=1000`。
  这补足了当前启动阻塞的证明，而非仅凭旧 PID 推断。

## 决策与复用阶梯

复用已有安装 profile，只修改 TS/CJS 中 Molly 的端口常量和对应断言；Lody profile、Windows pipe、E2E override 不变。
这部分替代了[早期安装身份记录](../architecture/2026-09-09-graphic-design-platform.zh.md)中的 17790 选择；历史记录保留。
[`start-local.mjs`](../../../../apps/electron/scripts/start-local.mjs) 已构建并同步内置 CLI 和 OSS 桌面，无需适配。
现有 supervisor 的占用等待、退出重试和所有权检查正确，无需第二个 supervisor 或改变重试策略。
现有 probe 和 relay 准确报告 daemon 缺席，relay 已有 redial；延长探针或重连超时不能解决端口占用。

采用新的固定端口，是既有机制的最小适配。每 profile 的 Unix host socket 可复用 endpoint union，
但需要改变宿主路径、陈旧 socket 回收及 TS/CJS 行为，扩大这次修复范围，因此未采用。
固定端口仍可能被其他软件占用；这种情况下现有安全等待继续生效，不允许按 PID 杀掉占用者。
旧 Molly 进程仍使用旧构建，需退出后重新 `pnpm start:local`。
数据目录、run 记录、会话、历史与模型执行语义保持原有行为；不改变 Spec intent。

按[第二意见流程](../../../agent-skills/codex-second-opinion.md)确认 CLI 和 `gpt-6-astra/high` 可用，
但只读调用初始化失败：`failed to initialize in-process app-server client: Operation not permitted`。
没有返回 advisory，也未自动重试、替代模型或绕过权限。

## 验证与限制

[`supervisor.test.ts`](../../../../packages/cli-supervisor/src/supervisor.test.ts) 的新增回归使用合成网络对象、
真实 lease acquisition/endpoint resolver、既有 fake child 和 fake timers。
端口 17790 明确产生 `EADDRINUSE` 且不返回 host record；断言 supervisor 最终到达 owned `ready/running`，
没有真实 sleep、网络或 mock 调用次数断言。修复前为 `reconnecting`，修复后通过。
Supervisor 50 项和 installation profile 11 项通过，后者保留 TS/CJS parity、Windows 和 E2E override 覆盖。

`pnpm install --offline --frozen-lockfile` 和完整 `pnpm build` 通过；manifest 与 lockfile 未变。
新构建用 Playwright Electron 启动真实产品，使用独立临时 `MOLLY_DATA_DIR` 和 Electron userData，
仅用 `MOLLY_E2E=1` 跳过单实例锁，未设置 host 端口 override，也未启用 fixture routing。
IPC 实际报告 `phase=running`、`runtimeOwnership=owned`、`startupStage=ready` 与 `loro.isConnected=true`；
run 文件 PID 与 ready PID 一致。再次启动新隔离实例，核实 daemon 是本轮 Electron 的 `resources/cli/index.js start`
子进程后调用既有 `cli.restart`：replacement PID 改变并回到 owned ready/running，`loro.status` 收到 false→true。
第三轮隔离实例还验证了真实退出恢复：预先订阅状态事件，核实 replacement daemon 仍是本轮 Electron 的上述子进程，
只向该子进程发送 SIGTERM。随后观察到 supervisor 的 `reconnecting/retryInMs`，新 PID 的 owned ready/running，
以及 Loro false→true。这是既有退出重试机制的独立 smoke，不将显式 restart 当作自动恢复证据。
三轮实例均已通过自身关闭流程退出；原有 Molly 窗口和 Lody Nightly 进程仍在，17792 无遗留监听。
这些验证不宣称用户原有窗口已经恢复，也不解释旧 daemon 最初为什么退出。

全量检查首轮发现新增测试两处 floating promise，已补 `void`。
完整 `pnpm check` 复跑通过，包括全仓类型、lint、测试、i18n 和三个边界检查。
其中 Shared 1321、Supervisor 50、CLI 3060（3 跳过）、Components 3247 项通过，Electron 两组 228 和 13 项通过。
Components 输出了历史 vendor Claude tsconfig 依赖解析警告，但全部用例通过；未初始化 vendor 或修改该警告来源。
`pnpm format`、独立公开边界和 docs check 通过；文档无注册 SHA topic。
额外对所有改动文件运行 Prettier check 时，CJS profile 的既有 `getInstallationProfile` 排版未通过；
已核对 HEAD 同样未通过，问题与端口修改无关。保留该未改动行，没有夹带全文件格式修复；其他改动文件通过。
上述修复验证阶段未提交或创建 PR；没有发布、模型调用、清库或 Lody 进程操作。

## PR #70：旧 detached daemon 的显式停止兼容

[P1 评审](https://github.com/LeonEthan/molly-design/pull/70#discussion_r4171857723)
指出端口迁移后旧 detached daemon 仍持有 17790，而新版 stop 只检查 17792。
合成 v1 PID/instance/token 与 socket 回归确认：新端口无宿主时返回 `stale_pid_file`；
新 Electron 已取得新端口时返回 `host_mismatch`，两者都没有停止旧 daemon。
这是已复现的升级控制回归，不补充原 daemon 初始退出原因的证据。

将既有停止函数提取到
[`daemon-stop.ts`](../../../../apps/cli/src/commands/daemon-stop.ts)，供 stop/restart 共用并隔离测试。
默认 local TCP 的显式停止先找当前端点；不匹配时仅检查 loopback 17790。
只有旧宿主的 daemon mode、PID 和 instance 全部匹配当前安装目录的完整控制记录，
才复用 `requestLocalCliHostShutdown` 重新校验所有权、发送 token 并等待所选旧端点 drain。
Cloud、Windows pipe 和 E2E 不查旧端点。旧端点不用于租约 acquisition、运行时 discovery 或自动接管。
外部宿主、认证拒绝和 drain 超时保持现有安全结果；不发送 PID 信号，不改写或删除数据。

复用阶梯：现有 restart 已复用 stop，只需适配该函数的端点选择与 drain 观察；
单纯重试新端口或 socket 不会释放旧 daemon，自动停止/接管旧宿主则扩大权限与启动语义。
因此没有新增协议、supervisor、持久字段或自动迁移机制，也没有改变 Spec intent。

[`daemon-stop.test.ts`](../../../../apps/cli/src/commands/daemon-stop.test.ts)
使用真实 inspect/shutdown 协议逻辑、合成 socket/控制记录和 fake timers。
修复前 3 项失败（两种旧 daemon 停止场景及认证拒绝），7 项通过；
适配后加上 drain、所有权替换及有界超时覆盖，共 13 项通过。
同批 PID 所有权 6 项和 runner readiness 4 项也通过，无网络、真实 sleep 或 mock 次数断言。

本轮独立只读 `gpt-6-astra/high` 决策意见请求仍在初始化时报 EPERM；未返回 advisory，未自动重试。
真实旧端口当前由其他产品使用，本轮没有为升级场景启动或停止真实旧 daemon；
升级控制证据来自上述确定性回归和新版 CLI 构建。前文隔离产品 smoke 属于前一提交，
不当作这次显式 legacy shutdown 的真实启动证明。用户原窗口和 Lody 均未操作。

新版 CLI 生产构建、完整 `pnpm format`、改动文件 Prettier 和公开边界检查通过。
首轮类型检查发现提取函数时误删 status 命令仍需的 import，已补回；
受限环境的完整检查随后遇到既有 socket suites 的 `listen EPERM`，
改在允许本地 socket 的环境复跑，完整 `pnpm check` 通过。
CLI 3073 项通过（3 跳过）、Shared 1321、Supervisor 50、Components 3247 项通过；
历史 vendor Claude tsconfig 告警仍在，未修 unrelated 来源。
