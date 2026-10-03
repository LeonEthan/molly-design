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
