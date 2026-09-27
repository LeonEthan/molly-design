# 收敛为单人本机桌面产品

Status: proposed
Translation: current

[English](2026-09-15-local-only-product-scope.md)

## 摘要

Molly Design 的公开桌面版已经使用本地组合，但继承的产品云、远程 host、多人协作和移动产品实现仍留在公开源码与共享 UI 中。提议将维护范围收敛为单人本机桌面创作，删除这些没有当前产品用途的入口、运行路径和代码；保留本机后台服务、多窗口同步、文件能力及桌面窄窗口布局。联网模型服务和可信的公共下载仍可由用户或应用明确使用。删减必须逐层核对消费者和旧 Molly Design 数据读回，不能用静态命中数或构建通过证明端到端能力未受损。

## 目的与已确认范围

本提案记录已确认的产品范围，实施方案仍待评审，入口收敛已开始。[设计平台 Spec](../../../../specs/graphic-design-platform.zh.md)规定本地单人桌面、保留 Agent 和 Bento 创作链路，并将云协作排除首期；[独立发布 Spec](../../../../specs/molly-design-independent-release.zh.md)不新增产品云、账号、移动端或 Web 产品。现有 [README](../../../../README.md)也声明 OSS 桌面不提供托管工作区、团队共享和远程产品能力。此处进一步要求移除不再维护的继承实现，而不是只对用户隐藏入口。

| 范畴   | 删除目标                                                                             | 必须保留                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| remote | 认证产品云、云数据传输、远程 host 的注册/连接/选择/执行、远程预览隧道及其后台工作    | 本机 Electron 与内嵌 CLI 的 IPC、本地数据通道、Agent 执行；用户自配模型/图像服务、公共运行时下载和 Molly Design 应用更新 |
| 协作   | 多人共享作品、会话或工作区，邀请、成员权限、团队可见性和面向其他成员的 presence/发布 | 本机多窗口同步、本地会话与作品关联、Agent/人工编辑串行保护、本地文件树、编辑冲突及 diff                                  |
| 移动端 | 移动产品页面、原生 shell、手势/底部 sheet、移动专属导航与故事                        | 桌面缩窄窗口时必要的响应式布局和键盘/指针操作                                                                            |

“本机 host”不是远程 host；localhost 上的桌面预览或内部 socket 不因名称中有 remote/host 而自动删除。用户自行使用 Git 远程仓库或外部 MCP/模型服务不属于产品云功能；Molly Design 的设计历史仍在独立的本地 Git 仓库，不要求远程仓库。移除团队共享不等于移除本地 CRDT 持久化；移除移动产品不等于强制桌面窗口保持宽屏。

## 已检查的实现差距

- [CLI 启动](../../../../apps/cli/src/commands/start.ts)同时组合本地 `createLocalCloudPort` 和云 `createCloudCliPort`；[Fleet](../../../../apps/cli/src/lib/molly-fleet.ts)仍按可用云 token 构造远程桥。[本地 port](../../../../packages/platform/src/local.ts)的空可选能力说明目前本地运行不需要这些产品云服务，但尚未证明所有云分支可一次性删除。
- [渲染器根路由](../../../../packages/components/src/routes/__root.tsx)在本地平台使用静态认证上下文，仍保留 cloud 根组合；[工作区运行时](../../../../packages/components/src/providers/create-workspace-runtime.ts)及[目标路由](../../../../packages/components/src/providers/workspace-target-router.ts)仍支持 local/dual/cloud。删除双平面时须保护本地房间路由、重连和持久写入。
- [设置目录](../../../../packages/components/src/components/settings/settings-tabs.tsx)已有云能力门控，但[侧栏](../../../../packages/components/src/components/loro-app-sidebar.tsx)仍含团队分享和移动分支。门控说明入口目前可能不可达，不等于代码已从产品中剔除。
- 原移动目录曾由窄 Web 与桌面渲染器共享；[会话详情](../../../../packages/components/src/components/sessions/session-detail.tsx)和路由也有移动分支。应先确定桌面窄窗口的用户可观察行为，再删除专属分支。
- [Code Collab v2](../../../../apps/cli/src/lib/code-collab/README.md)承担本地文件索引、当前更改、会话 diff 和冲突处理；[文件界面说明](../../../../.agents/docs/sessions-file-surfaces.md)显示桌面仍消费这些能力。按目录名整体删除会破坏本地功能。
- [本地 Loro 通道说明](../../../../.agents/docs/cli-lib-local-loro-data-plane.md)记录多窗口和 CLI/渲染器之间的房间同步；[设计 Spec](../../../../specs/graphic-design-platform.zh.md)仍要求本地 Loro/Flock 保存会话与作品关联。不能把“删除多人协作”推导为“删除所有同步”。

以上是源码与文档检查，没有在安装包中证明所有旧入口的可达性，也没有完整消费者清单。`packages/cloud-api`、云认证依赖和共享协议字段应在实施切片中按实际 import、运行时构造和历史读回核对后裁定；不预先承诺整个包或所有字段都可删除。

## 提议的实施顺序

1. **建立产品可达清单与基线。** 从本地 Electron 构建、内嵌 CLI、渲染器路由、设置和后台任务追踪产品云/远程 host/多人/移动入口；记录当前本地会话、附件、作品、草稿、文件预览及窄窗口的可观察信号。区分代码存在、实际构造和安装包可达。
2. **删除产品入口与调度。** 移除远程 host 选择/配对、团队分享/邀请/成员页、移动产品导航及其后台任务。旧深链和显式命令返回明确不可用或转向本地有效入口，不悄悄请求产品云。
3. **收敛运行时。** 逐模块移除云 port 的具体组合、远程桥和云房间/重连逻辑，保留本地平台身份、本地 Loro/RPC、权限回应、Agent 生命周期、附件及预览。删除不再有消费者的云 DTO、依赖、能力开关和协议写入；保留必要的旧数据读兼容，不继续创建旧功能记录。任何包级删减同步更新 lockfile 并运行公开边界检查。
4. **拆除移动实现，整理共用 UI。** 删除移动路由、专属组件与原生行为；将桌面窄窗口确实需要的布局留在桌面界面中。保持桌面文件、会话和画布操作在支持的窗口尺寸下可用。
5. **更新合同和说明。** 根据最终删除范围修订受影响的 Spec、模块 README、`.agents/docs/` 与最近的 `AGENTS.md`。改变已批准的意图或保证时，相关 Spec 返回 draft 并等待该修订的人类批准；不要用本提案取代 Spec。

切片应按依赖关系做小步删除，并在每步检查删除后的复杂度是否回流到调用方。如果某模块仍为多个本地消费者提供大量行为，就保留该模块或抽出当前本地职责；不为将来重开云/移动端预留新开关或空 adapter。

## 取舍、风险与验收

仅隐藏入口的改动较小，但会继续维护云/移动分支，不能达到“剔除”目标。整包删除 `Code Collab`、Loro/Flock 或内嵌 CLI 虽看起来更彻底，却会把本地文件、数据读写或 Agent 执行一并删除。本提案选择删除产品专用实现，并让现有本地职责决定共用模块的保留范围。

主要风险是旧 Molly Design 作品、附件、草稿和会话字段失去读回；远程/本地同名 RPC 的误删；云分支移除时使本地房间状态或权限回应失效；删除移动布局后让窄桌面窗口无法操作。另须保护 Molly Design 与 Lody 的安装和数据隔离，不扫描、迁移或删除 Lody 用户数据。公共运行时和应用更新下载必须继续遵守[平台合同](../../../../packages/platform/AGENTS.md)，不能借删云打开认证产品云请求或遥测。

验收以最终本地构建和隔离的安装包为界：确认没有产品云认证请求、远程 host 连接或多人共享入口；本机创建/恢复设计会话、Agent 执行/取消/权限回应、人工编辑/自动保存/存版本、附件读回、预览、PNG/JPEG 导出及多窗口保护仍可观察；桌面窄窗口可完成核心操作；合成旧 Molly Design 数据可读，Lody 数据保持隔离。测试使用确定性 fixture 和明确状态，不依赖公网或真实等待。类型、静态、相关测试、构建、格式、文档及 `check:public-boundary` 随各实施切片执行；静态零关键词命中不是验收条件。

**黄金 case 是最终验收的必过端到端用例。** 复用已经冻结并有可执行 runner 的 [Kimi MagSafe 复刻用例](../../../../e2e/KIMI-REPLICATION-ACCEPTANCE.md)：285×2000 的参考图 SHA-256 `3f155040ce8152cd3e5808d000cbedb482307c1c1c1f4df68b6f50ae82baaa89`，准确初始提示词 `复刻这个设计`，真实 Kimi Code CLI 的 `K3` / `Thinking High`。最终删减后的 Molly Design 构建须创建全新隔离轮次，经普通桌面附件、Agent 创作、产物提交、Bento 原生编辑、自动保存/版本、重开和 PNG/JPEG 导出；核对图片实际送达和读取、画稿结构/素材/可编辑性及导出读回。人工对同一最终成图与冻结参考图判断高视觉一致性；技术通过或旧轮次的人类接受不能代替该判断。保留失败轮次，不自动付费重跑，也不把真实模型用例放入无网络的确定性回归。[此前单文件黄金轮](../../implemented/architecture/2026-09-15-single-canvas-authoring-redesign.zh.md#单文件黄金轮结果)已获技术、编辑和人工视觉接受，只证明当时构建，不能证明本次删减后的构建。

## 实施进度与验证限度

入口切片已删除内嵌 [CLI start](../../../../apps/cli/src/commands/start.ts) 的产品云登录/云 port 组合，并让 [CLI 平台选择](../../../../apps/cli/src/lib/cli-platform.ts)、[桌面主进程](../../../../apps/electron/src/main/platform.ts)与[渲染器平台选择](../../../../packages/components/src/lib/app-platform.ts)拒绝显式 cloud 值。[daemon start](../../../../apps/cli/src/commands/daemon.ts)不再做云认证前置检查，仍使用本地 runner ready 握手；[渲染器根路由](../../../../packages/components/src/routes/__root.tsx)只装配本地 provider；桌面深链只处理本地项目打开，旧产品云认证、host 配对、结账返回和团队邀请不再触发。[Fleet](../../../../apps/cli/src/lib/molly-fleet.ts)现只接受本地 port，从本地目录启动隐式工作区，已删除云工作区订阅、重试与远程桥调度；本地目录无法读取时明确失败。远程桥模块及其纯云测试已删除；MachineRuntime 不再暴露远程桥状态转换，内建 Agent 注册由本地 `Lody.start()` 触发，相关 15 项定向测试通过。CLI 入口已删除产品云 `login/logout`、孤立的云认证预检/恢复模块；`app/project` 改用 Molly Design 安装域的稳定本机 machine ID，项目深链固定使用 `molly-design://`，对应 18 项定向测试通过。邀请、加入/创建云工作区，以及账号、成员、计费、云使用量的旧路由现只重定向到本地有效页面，原路由的托管请求与无消费者的页面组件已删除；设置导航现从“偏好设置”开始，旧云 tab 落到该本地页；桌面设置模态框已不装配托管账号/计费/云统计，工作区路由不再预载 billing。已删除无产品消费者的账号、邀请、所有权、billing 与统计组件、缓存和相关移动故事；协作会话/UI、移动导航及其他云消费者仍待清理。保留本机身份、Supervisor、Agent 生命周期和公共运行时下载。旧 CLI 测试期待 cloud 可启动，已改为期待明确拒绝。清理测试进程继承的 Claude 认证变量后，相关 38 项测试与完整 `corepack pnpm check` 通过；入口后续改动的全仓 typecheck 也通过。渲染器双平面、会话分享、移动实现及入口之外的托管消费者仍在；本记录保持 `proposed`，不能把入口切片当成目标完成。

后续切片注销了 CLI 的云同步、工作区、MCP、machine、导出、反馈、Agent 配置和 Session 命令，并删除独占的命令文件与测试。本地 Task 自动化仍调用 `session.ts` 的创建与分发函数，因此保留该模块并裁掉 Commander 命令处理。`app` 本地 one-shot 不再初始化分析或向产品服务器同步时间。MCP 不再公布 `lody_feedback`，其托管提交流程和 CLI 反馈实现已删除。渲染器工作区根路由、认证布局和首页只装配隐式本地工作区；旧登录、邮箱补全/恢复、设备授权和结账回跳地址转向 `/`，独占的托管页面与故事已删除。本地主布局中的云 Bug Report 表单和 HTTP 提交实现已删除；桌面连接提示现在明确打开公开 Issue 页面。至路由切片为止，类型检查、路由生成、定向设置测试、文档检查、完整 `corepack pnpm check` 和本地桌面构建均通过。Bug Report 和分享 hook 删减后仍须复跑完整检查；云房间/重连、云 machine/session/admin 消费者、分享 UI、原生/移动分支及窄桌面布局仍待完成。

起始时此 worktree 未检出 ACP 子模块，文档检查对 Kimi/Codex 目标报六条缺失链接，公开边界检查也因缺少 `workspace:*` manifest 失败；这是检出状态，不是提案引入的链接。随后按仓库锁定提交初始化全部子模块；`corepack pnpm run docs check` 与 `node scripts/check-public-boundary.mjs` 均通过。入口切片完成后，完整 `corepack pnpm check` 与本地桌面构建均已再次通过；最终删减后的构建仍须复验。安装包、真实 Agent 或黄金 case 尚未运行；先前 golden 通过记录不覆盖本次改动。

本次完整删减继续将渲染器收敛到本地运行：目标路由只返回本机平面，工作区运行时在装配前拒绝 `cloud`/`dual` 与认证 token；本地 Machine RPC 的房间重加入、提交应答和文件资源保持独立。产品云操作消费者、托管 GitHub 安装/项目设置、多人设备和项目分享、邀请/加入请求、账户与计费、PostHog 根 provider、OneSignal 推送与 Task 云图片上传均已移除；CLI 的远程 Machine RPC 监听和托管 GitHub token broker 不再启动。移动目录、原生附件行为、移动专属组件/路由及 Task 移动分支已删除；桌面窗口最小宽度为 620px，另有窄窗口操作脚本。新会话图片和一般附件只经本地 CLI；本地非图片附件下载/预览走 Electron 资源协议，保留旧云附件 URL 的历史读回代码但本地产品不会取得新云 token。旧数据协议字段和未装配的兼容代码按实际消费者保留，不把源码关键词命中数当作运行时验收。

至此，公开边界、文档链接、格式/差异空白检查、Electron 与组件类型检查、lint 及本机附件资源测试已通过；全仓组件测试的两项失败来自已删除的远程凭据撤销按钮测试，过时断言删除后 13 项定向组件测试通过。最终构建、窄桌面脚本、最终源身份的独立黄金轮及人工视觉判定仍待完成。前述检查结果不能代替这些验收，提案状态继续为 `proposed`。

构建复核又发现 CLI MCP catalog 仍公布 `lody_task_upload_images`，会使用产品云 Task 图片 API；该工具、唯一上传实现和相关旧测试/说明已删除，保留 `lody_upload_images` 的本机会话附件路径。50 项 CLI MCP catalog 定向测试通过。删除发生在第一次“最终”构建之后，因此验收只认随后重新构建的源身份。

随后按实际附件消费者继续删除 CLI 的会话图片/文件云上传与本地附件回填实现。MCP `lody_upload_files` 和 `lody_upload_images` 现都经本地文件附件请求，Agent ACP `image`、内嵌 `resource`、工作区内 `resource_link` 作为本地文件块持久化；Codex 生成图片的路径和 inline 两种结果也走本地附件。遗留 `session/image-upload` 协议收到请求会明确拒绝并指向本地文件附件通道。新用户附件不再排队 R2 回填；旧 relay 读回代码仅供历史记录识别，在本地没有新的托管凭据。删除后 31 项 ACP/MCP 定向测试和 CLI 类型、lint 通过；最终构建及黄金轮必须以这一修订重跑。

渲染器运行时的后续消费者清理删除了 Loro Streams 云房间适配器、云平面附着、云重连循环、远程游标恢复和云 Machine RPC 请求构造；本地房间继续通过同一 Repo 与 Electron 数据通道重加入。Machine RPC facade 现在只发送 Electron IPC；无法定位本机 Machine 时返回明确错误，不把本地路径送到远程服务。旧远程预览创建/撤销和托管 Bug Report 的无消费者运行时方法也已删除。云 presence、云 Machine monitor、会话观看状态发布及只靠云 presence 才启动的 ACP 配置刷新已从本地运行时拆除，本机 CLI 的 presence 快照仍供 Machine 在线状态使用。旧云传输和相关纯云测试删除，本机目标监控测试、文件预览与会话控制测试保留。组件类型检查、相关 17 项测试及局部 lint 已通过；由于此删减发生在前一轮重建和全仓检查后，最终全仓检查、构建、窄桌面和黄金轮仍须对新的源身份执行。

边界复核发现两个启动期的旧 Lody 状态读回：`authTokenAtom` 与 `userAtom` 原先从 `lody_auth_token`、`lody:auth-bootstrap` 初始化，可能在本地 provider 的 effect 清零前短暂暴露旧凭据/身份。两者现在初始为 `null`，本机平台快照随后提供 Molly Design 身份。另有继承的“清缓存/清空全部并退出”功能会扫描并删除所有 `lody*` IndexedDB、localStorage、Cache Storage、cookie 和 service worker；本地单机产品无云端可重建保证，也不应触及 Lody 数据。已移除其设置、连接提示、崩溃页入口和开机清空调度，崩溃页保留重试、无数据清理的重载、复制诊断和公开 Issue 链接。真正按 Molly Design 所有权划界的数据重置另需独立评审。相关 20 项定向测试和组件类型检查通过；最终检查和黄金轮须覆盖这次变更。

旧托管附件消费路径也已停止取产品云 URL：历史 Task 图片、会话图片和文件的云字节请求明确报告不可用，本机文件仍通过 Electron 资源协议预览/下载；本地附件输入与 ACP 输出继续按本地通道保存。启动期云时间校准、远程 CLI 版本查询、机器凭据签发和密码校验的 HTTP 调用移除。负向附件测试以禁止 `fetch` 的环境验证托管路径不会发请求，相关 18 项测试通过。Better Auth/Convex 客户端、云认证恢复、OAuth 回调、原生认证同步、移动恢复分析与未装配的应用启动分析已删除；路由上下文和 Storybook 改用本地会话。崩溃边界不再发 PostHog 异常。组件清单去掉认证及 Konsta 直接依赖并更新锁文件。保留历史字段与少量兼容 UI 代码只用于本地读回或已装配的共用组件；最终全量检查仍是这一删减的必要验收。

最终界面审计还发现本地项目目录弹窗会按 `isMobile` 装配专属底部 Drawer；该分支、专属组件及移动 Storybook case 已删除，桌面始终使用同一 Dialog。@ 提及菜单原在宽度 639px 以下切换到为手机 Drawer 设计的 docked panel，与桌面最低 620px 窗口发生重叠；现在窄桌面始终采用受输入框和视口约束的浮动菜单，模块规则同步修订。无消费者的移动返回导航也删除。21 项目录选择和提及菜单测试及组件类型检查通过。完整测试第一次复跑只有旧云时间校准断言失败；该断言已删除，本地“无时间服务请求”测试单独通过，完整检查需再跑到结束。

第一次最终 Electron 打包指出 Konsta 依赖虽已从组件清单删除，Tailwind 入口仍导入 `konsta/theme.css` 并扫描其移动组件路径；类型与单测未覆盖 CSS 解析。已删除这些主题/扫描路径并保留产品主题色变量，Electron `build:app` 成功。新增 CSS 修正须随后重新执行格式、全仓检查和完整 `e2e:build`，黄金轮只对复核后的产物启动。

修正后的最终验收：`corepack pnpm format`、`corepack pnpm run docs check`、`git diff --check`、冻结安装、完整 `corepack pnpm check`、完整 `e2e:build` 和 620px 窄桌面脚本均通过。黄金 case 首轮 `local-only-20260916-0220` 在模型派发前因侧栏收起、Settings 按钮被卸载而失败，保留了失败报告与屏幕；未触发 Kimi 付费调用。验收页改从产品自身的“Go to Agent Settings”入口配置 Agent，`@lody/e2e check` 通过。独立轮 `local-only-20260916-0225` 使用冻结 SHA 参考图、原始提示词和真实 Kimi Code `K3 · Thinking High` 自然完成；提交回执为 committed，570×4000 画布可按比例对齐 285×2000 参考，PNG/JPEG 导出及重开后的 SHA 相同，Bento 的标题编辑、移动、裁切、自动保存和重开读回通过。该轮技术及编辑状态 `passed`，整体仍为 `pending-human-review`；必须由用户查看原始输出/全长对照并判断高视觉一致性。本提案继续为 `proposed`，Spec 修订继续为 `draft`，没有擅自记录视觉批准或提交代码。

黄金技术通过后的产品可达审计发现侧栏/归档仍有“我的任务 / 所有任务”团队范围控件，侧栏和归档分别从旧 `lody-sidebar-chat-scope`、`lody-archive-scope` 读偏好，可能把历史本机会话藏起。现在删除两个范围 atom、控件及团队专属 Storybook case；侧栏筛选仅调整 Workspace/Updated 排列，本机运行始终展示获许可的全部会话，归档保留本地项目所有权检查但不再按旧作者 ID 隐藏记录。Electron preload 的 Better Auth 桥类型与 OneSignal Window 声明也删除；它们本无运行时实现。窄桌面脚本加入侧栏筛选与归档无团队范围入口的可观察验收。此修正会产生新构建，前述黄金轮只能证明旧产物；若要求最终源码的付费模型黄金轮，必须依 case 规则另行授权，不能把旧轮次追认为最终通过。

范围清理后的最终确定性复核：`corepack pnpm format`、`corepack pnpm run docs check`、`git diff --check`、完整 `corepack pnpm check`、完整 `e2e:build`、`@lody/e2e check` 和扩展后的 620px 窄桌面脚本均通过。脚本在实际构建中打开侧栏筛选和归档，确认仅有 Workspace/Updated 排列选项、没有“我的任务/所有任务”团队控件。旧黄金报告此前只记录 main/CLI/Bento 三个哈希，不能鉴别这次只修改 renderer 的构建；黄金 runner 已增加 renderer HTML 及入口 JS/CSS 哈希记录，文档同步更新。新 renderer HTML SHA-256 为 `7129fbef746ab5b238b1950ace685828970524cf9c5c393adac9e53b15bead92`，入口 JS 为 `e359f87cb576a22e3513e0ae663d1a14f8021c342f03d64896879f93424d5282`。上一黄金轮的视觉判定仍待用户；新构建的黄金技术/视觉验收不能由旧报告替代。

用户随后明确授权对这次新渲染器构建再运行一轮真实 Kimi 黄金 case。隔离轮 `local-only-final-renderer-20260916-01` 使用冻结参考与原始提示词，经正常 UI 选择 `K3 · Thinking High`；报告记录上述 renderer HTML/JS 哈希及 CSS 哈希 `de18d96ce23088f4269950a633b90cafc0f6dad1af3c47755d213263ec1ee978`。Agent 自然结束并取得 committed 回执；原始 570×4000 PNG SHA-256 `dc575399ee2b8f7114e8260ea15fde6f1b5e0ffd7b19e782a3ce205abab26830`，PNG/JPEG 重开导出哈希不变，Bento 标题编辑、移动、裁切、自动保存及 YAML 读回均通过。用户远程无法访问 worktree 图像，所以全长参考/输出截图和原始 PNG 已直接贴入对话。用户随后明确判定该最终图通过高视觉一致性验收；报告记录人工判定，技术、编辑、视觉及整体状态均为 `passed`。该接受只适用于本轮报告记录的新渲染器构建，不追认此前失败或待判定轮次。

代码评审后的修正处理了三项本地产品风险。MCP 的单会话创建/聊天 Operation 在 durable dispatch 后使用 best-effort 的最终本地交付确认，重连失败只记录告警，不把已经可能执行的派发返回成可重试失败；其他一次性写入仍要求确认。本机 Agent 与本地 Loro 数据通道改为桌面必需服务，删除“运行本机 Agent”开关、对应 IPC 和 relay 开关；升级时清除旧 `cliAutoStartEnabled=false` 偏好，避免本地执行、终端和附件能力被历史设置关闭。旧附件不再请求产品云：会话图片从 Molly 自有 `lody-session-image-v1` CacheStorage 读取；旧 `transport: 'r2'` 文件在 Molly CLI `_backfilled` 目录按 size/SHA-256 找回并继续走受限 Electron 资源协议，且新附件配额不会再清除此兼容副本。旧 Task 图片的历史实现从未把字节持久化到 Molly 数据目录或 CacheStorage，只有进程内 blob URL；对没有本地字节副本的记录，离线版本无法在不恢复产品云认证读取的前提下重建内容，因此仅保留文本/标识并明确不可用。该限制不适用于新附件或已有本地副本，也不允许扫描或迁移 Lody 数据。

修正后的完整 `corepack pnpm check` 在清除继承的 Claude 认证测试变量后通过：CLI 2592 项、组件 2862 项和 Electron 139 项测试通过，类型、Oxlint、i18n、Code Collab import、平台及公开边界检查均通过；`corepack pnpm format`、`corepack pnpm run docs check`、`git diff --check` 和本地生产构建也通过。由于这些评审修正改变了 CLI、Electron 与 renderer 源码，上一轮已经人工接受的黄金报告不再精确覆盖当前源码身份；按黄金 case 规则没有自动发起新的付费 Kimi 轮次。

用户随后授权当前源码的最终黄金验收。隔离轮 `local-only-post-review-20260916-01` 正常选择 `K3 · Thinking High` 并使用冻结参考与原始提示词；Agent 自然结束，但生成稿采用 `1140 × 8000` 画布，最终 intake 因高度超过既有 4096 上限写入 `design_store_failed` 的 `invalid` 回执，故未进入导出、编辑和人工视觉验收。失败证据完整保留且 runner 没有自动重试。诊断发现运行时 schema 已执行每边 1–4096，而物化给 Agent 的格式文档只写“正整数”，没有公开具体上限；现已在 graphic-design 主技能、格式和复刻参考中明确 1–4096，并要求超限时等比缩放、不得把参考图放大到上限之外。该修正只补齐已有合同，不静默修复模型输出；新的真实模型轮仍须独立授权。

用户再次授权后，独立轮 `local-only-post-review-20260916-02` 使用包含上述合同修正的重建产物，经正常 UI 选择 `K3 · Thinking High`，并以冻结参考与原始提示词自然完成。回执为 committed，作品为 285 × 2000；原始 PNG SHA-256 `cbdc5d4b21c6acedfd881544ad597f982d572c4cfe066ccc1a3f55511ad4c5ca`，PNG/JPEG 在重开后哈希不变。Bento 标题编辑、移动、裁切、自动保存及 YAML 读回通过。全长参考/输出对照和原始 PNG 已直接贴入对话，用户确认高视觉一致性通过；报告的技术、编辑、视觉和整体状态均为 `passed`。前一失败轮继续原样保留，不追认为通过。

合并后的新源再次执行了获授权的真实黄金轮。`local-only-merged-20260916-01` 在模型菜单节点脱离后于分发前失败，没有模型调用；runner 的菜单选择已改为打开后重新取得节点。`local-only-merged-20260916-02` 随后以 `K3 · Thinking High`、冻结参考和原提示词自然完成，取得 committed receipt，生成 285×2000 画布，PNG/JPEG 重开哈希分别为 `1117bfb6ce36753e2ed9de5ef9c51eeff05af3375f80814e227865fcb1604cd6` 与 `a1cfdd76faa22a56c5feb01b4b8e59210ac52ddd2e2e71dc567a35a168bddea4`。旧编辑步骤因仍定位已退役的隐藏 `.c2a-surface` 而失败并原样保留；进一步核对发现移除隐藏旧面板后缺少可见图片裁剪入口，旧移动写入的上游 `x/y` 也不等于规范 `bounds`。

选区契约和可见 pill 现已补入 `image-crop` 与 `position`，画布分别映射到 `setImageCrop` 和 `setBounds`。不调用模型的保留 profile continuation 通过普通 Session 路由在当前构建上重放编辑；调试轮 `editing-resume-01` 至 `-19` 均保留，最终 `local-only-merged-20260916-02-editing-resume-20` 通过可见文本、位置、裁剪、自动保存、完全关闭/重开、YAML、导出及黄金版本恢复。该 continuation 证明编辑更正，但本次真实输出的人工视觉判断仍待用户确认；由于修复发生在模型分发后，若要求最终提交与真实模型轮源身份完全一致，还需用户另行授权新一轮，不能自动付费重跑。

用户随后接受合并源输出的高视觉一致性，并另行授权修复后的最终源码真实轮。`local-only-final-source-20260916-01` 使用提交 `2cf60736c24179dd8694e88eaebc6156063908f6` 的构建，经正常 UI 选择 `K3 · Thinking High`，以冻结参考和原提示词自然完成并取得 committed receipt。画布为 285×2000；PNG SHA-256 `0c3adf212afb053460417f56234659d464fbb44f1954580a21630680de9bf30b`、JPEG SHA-256 `ebb33e04116850ceb1b84789793fad5687c975c3ff02709b731db410c710b9cf` 在完整应用重启后不变。可见文本、位置、裁剪、自动保存、YAML 读回、编辑导出及黄金版本恢复全部通过。全长对照已直接贴入对话，用户确认高视觉一致性；技术、编辑、视觉和整体状态均为 `passed`。

报告的 `source.dirty` 为 `true`，原因是 checkout 中保留着与构建无关的既有未跟踪诊断脚本；它们没有被暂存或由构建导入。报告同时固定了准确的 tracked commit，以及 main、CLI、Bento、renderer HTML/JS/CSS 哈希。本提案仍保持 `proposed`，因为黄金验收完成不等于批准提案或 Spec 状态。
