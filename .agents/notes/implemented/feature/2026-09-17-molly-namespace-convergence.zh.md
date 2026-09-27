# Molly 命名统一：历史品牌替换与兼容边界

Status: implemented
Translation: pending

## 摘要

产品已使用 Molly Design，但失败页面、英文兜底文案和自有代码仍混用 Lody、Folio、Geon，部分旧名称还是持久化格式或外部协议。用户已确认目标拼写为 `Molly` / `molly`；本提案建议统一当前产品文案和自有技术命名，新写入使用新名称，旧作品、附件、设置和会话保留兼容读回。真实上游来源、许可证、历史记录和未提供新协议的外部适配器保留原名，不以全库零匹配作为完成标准。用户随后明确要求“开始执行”，本轮已实施工作区包、产品文案、环境变量、MCP、YAML 与路径的命名收敛及兼容读回。保留安装身份、真实上游来源和不可独立改动的持久化/外部协议；没有提交或公开发布。安装包升级和人工视觉验收不由源码及单元测试代替。

## 与已有决定的关系

- 本提案扩展[独立品牌与桌面首发规格](../../../../specs/molly-design-independent-release.zh.md)，只处理命名及其兼容影响，不承接该规格全部发布工作。
- 拟部分替代 [2026-09-15 改名提案](../../proposed/feature/2026-09-15-molly-design-rename.zh.md)中永久保留 `@lody/*`、`LODY_*`、`geon-canvas/1` 和项目级 `.geon/` 新写入的决定。此前实施与验收仍是历史事实。
- 拟替代[独立品牌清单](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)中 Folio 标记文件继续作为主名称的决定；保留其旧数据读回要求。
- 已批准的[设计规格](../../../../specs/graphic-design-platform.zh.md)目前明确规定 `geon-canvas/1`。本提案不自动改变它的批准状态或授权实施；采用格式变更前，应将受影响的中英文规格修订回 draft，单独记录新修订的批准。
- 当前 `apps/cli/src/design/AGENTS.md`、`packages/design-authoring/AGENTS.md` 和 shared/platform 规则仍有效。实施对应切片时同步更新，不能凭本提案绕过合同。

## 目标和范围

完成后，用户在当前产品的正常、失败、恢复及分享入口看到一致的 Molly 品牌；维护者编写自有代码时使用统一的 `molly` 命名；升级用户仍能打开原作品、附件、草稿和会话。用户原稿和外部文件中的同名文字不属于产品品牌，不进行搜索替换。

| 面                       | 提议目标                                           | 处理边界                                                                                                                         |
| ------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 产品展示文案             | `Molly`                                            | 从旧品牌及当前 `Molly Design` 收敛；覆盖中英文、兜底、辅助标签、错误和诊断标题。安装器名称与数据目录分别处理                     |
| 自有代码标识             | `Molly` / `molly` / `MOLLY`                        | 类型、函数、变量、文件名及前缀按语言惯例替换；第三方 API 名称除外                                                                |
| 根工作区自有包           | `@molly/*`；后台包 `molly`                         | `@lody/*` 和自有 `@molly-design/*` 一并收敛，更新 import、exports、过滤命令、构建脚本和锁文件；保留 private，不创建独立 CLI 产品 |
| 自有环境变量             | `MOLLY_*`                                          | `LODY_*` 仅在兼容入口读取；子进程需要旧变量的情况由适配边界处理                                                                  |
| 自有 MCP、桥接与资源命名 | `molly_*`、`molly.*`、`molly-*`                    | 本仓库控制的生产者和消费者同步变更；外部 ACP 元数据不属于可直接改名的自有接口                                                    |
| YAML 格式                | 新写入 `molly-canvas/1`                            | 接受旧 `geon-canvas/1`，字段和编辑语义保持一致；未知格式仍拒绝                                                                   |
| 工作区新附件、草稿       | `.molly/attachments`、`.molly/artworks`            | 历史路径继续按已保存引用读取，不批量搬动用户工作区                                                                               |
| 当前投影与技能清单       | `.molly-current.json`、`.molly-managed-files.json` | 新写新名；旧文件读回及技能文件所有权识别保留                                                                                     |
| 自有设置和缓存键         | `molly` 前缀                                       | 在既有存储入口按项兼容，不新建平行数据库或迁移服务                                                                               |
| 安装与发布标识           | 保留已是 Molly 命名的稳定标识                      | `dev.molly-design.app`、`molly-design://`、仓库 `LeonEthan/molly-design`、既有更新频道不因缩短展示名再次变更                     |
| 用户级数据位置           | 保持 `~/.molly` 及现有 Electron userData           | 若 productName 改为 Molly，须显式保持现有 userData 位置，避免自动转到空目录                                                      |

包名和安装标识使用不同约束：前者是一起构建的自有代码，可以一次性更新；后者承载安装识别、链接和更新连续性，已有 `molly` 名称就无需为了去掉 `-design` 再迁移。本提案不申请 npm scope、不改远端仓库名、不注册新协议或购买域名。

## 保留项必须有明确理由

1. **真实来源**：LICENSE、NOTICE、作者、上游仓库 URL、第三方素材来源、子模块远端及校验信息保留事实。不得把 LodyAI 适配器伪装为 Molly 原创。
2. **外部运行时协议**：例如 `_meta.lody` 由现有 ACP 适配器生产。保持 wire 名称，在已有边界消费；不能只改本仓库字段而令运行时失配，也不为品牌改名复制共享 ACP 合同。
3. **兼容读取**：旧格式、旧路径、旧 key 和旧参数可以留在对应模块的解析入口及测试中；不继续作为新用户的文案或默认输出。
4. **历史证据**：已实施/归档笔记、Git 历史、原始回执和历史作品保持原样。活动 README、规格、技能与维护规则按当前职责更新，同时保留来源说明。
5. **继承站点与云兼容面**：`site-docs` 当前明确是 Lody 上游站点资料，不将整站替换后宣称为 Molly 产品文档。shared 中保留的 cloud 安装档案不自动变成 Molly 云产品；不启用云请求。若发现资源被本地包实际使用，按该消费者单独裁定。

采用“边界内允许旧名、边界外统一新名”，不采用“整目录免检”：即使一个文件包含外部协议，文件里的产品提示也应更新。扫描中排除普通单词的子串，例如 `imageOnly` 并非 Geon，`portfolio` 并非 Folio；忽略构建产物、依赖、用户生成输出，子模块单独列为外部来源。

## 实施前源码证据

| 证据                                                                                                                                                                                                           | 当前情况及影响                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [boot-failure.ts](../../../../packages/components/src/lib/boot-failure.ts)、[recovery-entry.ts](../../../../apps/electron/src/renderer/src/recovery-entry.ts)                                                  | 启动失败标题和恢复提示直接硬编码 Lody，翻译加载不能覆盖                                  |
| [general-setting.tsx](../../../../packages/components/src/components/settings/general-setting.tsx)、[agent-config-dialog.tsx](../../../../packages/components/src/components/settings/agent-config-dialog.tsx) | 英文兜底仍有 Lody；对应正常英文翻译已有 Molly Design，不能把静态命中都描述为正常界面可见 |
| [usage-share-card.ts](../../../../packages/components/src/components/settings/usage-share-card.ts)、[usage-calendar-model.ts](../../../../packages/components/src/components/settings/usage-calendar-model.ts) | 分享标题与字标仍有 Lody；本地可达性须核对，不能据此新增用量功能                          |
| [canvas-format.ts](../../../../packages/design-authoring/src/canvas-format.ts)                                                                                                                                 | 格式常量为 `geon-canvas/1`，涉及 reader、writer、技能及恢复路径                          |
| [session-file-attachments.ts](../../../../apps/cli/src/lib/session-file-attachments.ts)、[workspace.ts](../../../../apps/cli/src/design/workspace.ts)                                                          | 新附件及部分创作目录仍用 `.geon/`，不是单纯的历史文案                                    |
| [current-projection.ts](../../../../apps/cli/src/design/current-projection.ts)、[skills.ts](../../../../apps/cli/src/design/skills.ts)                                                                         | Folio 文件名仍是当前读写标记，涉及投影版本和技能所有权                                   |
| [installation-profile.ts](../../../../packages/shared/src/node/installation-profile.ts)、[CommonJS 镜像](../../../../packages/shared/src/node/installation-profile.cjs)                                        | 本地数据根已是 `.molly`，展示名、App ID 和 scheme 已独立；同时仍读取 `LODY_*`            |
| [ACP capability normalization](../../../../apps/cli/src/agent/acp-capability-normalization.ts)、[.gitmodules](../../../../.gitmodules)                                                                         | 存在 `_meta.lody` 及真实 LodyAI 子模块，证明全局替换会越过外部协议/来源边界              |

以上是源码核查，不是安装包实测；实施前以当时 HEAD 重建清单，避免依赖会变动的命中数量。

## 兼容与冲突处理

### 新写单一名称，旧读集中在现有入口

- YAML reader 同时接受两个格式 ID，经现有转换器进入同一 BentoDoc 语义；writer 只输出新 ID。通过普通保存或显式导入产生新内容，读取/预览本身不改写原文件。历史版本及未提交草稿不因升级批量重写，拒绝 PPTD 的现有边界不放宽。
- 项目级新附件使用 `.molly`；旧消息继续引用其原路径。续接已有会话使用持久化的实际创作目录，新会话才选择新默认路径；不能用新默认值覆盖冻结的历史路径。旧目录继续纳入忽略规则。
- 投影标记保持原版本校验及 flush 顺序。新旧标记都存在但内容不一致时，以 canonical 重新生成可推导的投影；不得据旧标记提交草稿。技能清单需要合并核验真实所有权，不可把用户文件当作旧托管文件删除。
- 环境变量新名优先，只有新名未提供才读旧别名；新值无效应报错，不静默退回旧值。新旧同时存在的结果必须确定，并在错误中避免输出密钥值。现有 local-only 和遥测禁用约束同时覆盖新旧变量，不能因改名绕过。
- 设置迁移按 key 处理：新值存在就保留；新值缺失才读旧值，成功持久化新值前不删除旧值。不可重置认证、Agent 配置、作品关联或首次引导状态。
- MCP 工具名、权限项、历史工具结果和 server 标识作为一个切片审查。历史结果保持可读，当前工具列表只暴露一套主名称；已有用户配置需要别名时，在同一授权与会话校验后解析，不能注册一套绕过守卫的兼容工具。
- `lody-resource` 等安全相关资源 scheme 只有在实际注册和消费者清单齐备后才改；新旧地址均保留同一来源、会话和路径权限检查，不能靠扩大白名单兼容。

### 数据归属与回退

不扫描、导入或修改真正的 Lody 用户数据；沿用现有 Folio/Geon 开发数据迁移的限定范围，不因为碰到 `.lody` 路径就推定归属。不能证明属于当前产品的数据不自动搬动。

新写格式可能无法被旧应用识别，因此“向前兼容读旧数据”不等于支持旧二进制直接读取新数据。迁移前保留受影响数据的可恢复副本，迁移失败保留源文件并提供可定位错误；重试应幂等。回退验证使用隔离备份，不覆盖用户升级后产生的新作品。无需另建持续快照存储；设计历史仍只用已有本地 Git。

## 实施切片与完成条件

| 顺序                | 所有者和工作                                                                            | 完成条件                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. 固定清单与合同   | 按跟踪文件、真实消费者和外部边界分类；修订受影响 Spec 与最近 AGENTS；列出旧名例外及理由 | 明确每个旧名是待改、旧读还是外部事实；格式合同修订取得批准后才实施                      |
| 2. 产品文案         | components、Electron、locales、诊断、Agent 提示与当前产品文档；沿用既有 Molly 资产      | 正常翻译、缺翻译、启动失败/恢复均不显示旧产品名；不可达旧品牌资源只在证实无消费者后删除 |
| 3. 自有源码命名     | 根工作区包、符号/路径、import/exports、脚本、CI、构建工具                               | 不修改子模块；安装、类型检查及桌面打包解析到正确模块，生成配置与锁文件一致              |
| 4. 进程与工具接口   | shared、platform、CLI、Electron 的环境、桥接、MCP、资源及权限消费者                     | 新接口可用，旧配置只经明确兼容入口；保留外部 ACP 协议；本地组合仍无产品云和遥测         |
| 5. 持久化格式与路径 | design-authoring、设计服务、附件、设置；复用既有 reader/writer 与迁移入口               | 旧数据可打开/续接，新数据仅写新名，冲突/失败不丢失内容，历史回执和路径可用              |
| 6. 集成验收与收尾   | 最终 macOS arm64 安装包、现有 Electron harness、文档及例外复核                          | 完成下述旅程；剩余旧名称都有可核查理由，不将编译通过描述为品牌验收完成                  |

切片可分别审阅，但一个跨进程接口或格式 reader/writer 必须在同一可运行版本中同步交付，不能发布半改名构建。阶段 3 的包改名不要求同时改外部 ACP wire 字段。阶段 4/5 的新写入只在兼容测试通过后启用，不引入长期双写。

## 验证计划

- **静态与构建**：根工作区 `pnpm install`（不进入独立子模块安装），更新锁文件；`pnpm check`、`pnpm format`、`pnpm check:public-boundary`、`pnpm run docs check`，以及根 `pnpm build`。复核残留清单及大小写/文件名，不只检索产品全称。
- **旧数据确定性测试**：使用合成 Folio/Geon/Molly 数据，覆盖旧格式导入与保存重开、附件哈希及预览、草稿续接、设置和 Agent 配置、技能用户文件保护、旧环境变量和新旧冲突。注入失败验证权限拒绝、目标已存在、写入中断和重试，不使用真实用户记录或网络。
- **协议测试**：验证 native ACP 适配器的现有元数据仍被识别，工具权限与历史结果保持一致；测试资源请求拒绝跨会话/越界路径。替换 namespace 不降低 guard。
- **安装包旅程**：全新安装与既有 Molly 数据升级；首次引导、设置、Agent 开始/停止、旧作品打开、人工编辑、自动保存、重开、历史恢复和 PNG/JPEG 导出。观察新创建路径和格式；注入启动失败核对恢复页及复制出的诊断。
- **安装连续性**：展示名缩短后 userData、App ID、深链、已配置更新目标和自启动仍一致；与 Lody 隔离。改动安装器/更新元数据时验证旧 Molly 到新构建的受控升级；不上传公共 release。
- **视觉核验**：人检查菜单、窗口、Dock/安装器名称、英文/中文和错误界面；沿用素材不触发图像生成。旧用量/分享入口先查本地可达性，可达才纳入对应旅程。

不新增只断言字符串被改掉的测试套件；扫描用于清单，行为测试用于证明合同。测试结束保留具体构建身份、通过项及未覆盖项。

## 不做什么与方案取舍

不重构 Agent 生命周期、BentoDoc、保存模型或更新服务；不增加新功能、云产品、独立 CLI、付费生成或发行平台；不改用户作品里的任意文字。不重写 Git 历史、已实施笔记、许可证、第三方品牌及子模块来源。

只改用户文案成本最低，但不能满足自有技术标识统一的目标；无兼容全局替换最容易制造旧数据和外部运行时失配。本提案推荐分层收敛：自有新代码及新写入统一，兼容旧读和外部事实明确保留。包/API 范围较大，宜拆为上述切片；工时应在消费者清单完成后估计，不用命中行数假定机械工作量。

## 实施记录（2026-09-17）

用户在本会话中确认目标拼写后明确要求“开始执行”，授权实现；未授权提交或发布。上文保留方案与验收计划，以下记录实际采用的边界；关联设计格式 Spec 已退回 draft，本记录不构成该修订的独立审批。

### 已实施

- 自有工作区包和内部导入统一到 `@molly/*`，后台包为 private `molly`；更新锁文件、构建脚本和过滤命令，不发布 npm 包。
- 展示名、正常/失败/恢复文案、图标消费者、主题名称、源码入口和主要类型统一为 Molly。旧亮色主题以 Molly Classic Light 继续提供，旧 ID 读回保持原配色。
- 自有 `MOLLY_*` 环境读取以新名优先、旧名 fallback；写入新名。凭证清理同时删除两代名字，避免继承旧变量绕过清理。公开构建仍隔离云配置。
- 自有 MCP 工具和内置 server 改为 `molly`；新资源 URL 使用 `molly-resource`。资源权限、MCP bearer/session guard 保持原检查；旧 HTTP 头仅在新头缺失时读回。旧内置 server 名仍保留为用户配置的禁止占用名。
- 新 YAML 写 `molly-canvas/1`，读 `geon-canvas/1` 仍走相同校验。读取不改写原稿。
- 新附件/作品目录使用 `.molly`；旧消息引用不搬动，已有 `.geon/artworks` 续接原目录。两代目录同时存在时报错且保留草稿。
- 新投影和技能清单使用 `.molly-*`；投影缺失从 canonical 重建，技能仅在新清单缺失时读取旧 Folio 所有权记录，用户修改仍受保护。
- 浏览器设置通过现有入口按 key 读旧写新；新值包括空值均优先，显式 reset 清理对应两代 key，避免复活旧设置。可推导 IndexedDB 索引使用新名字，不删除旧数据库。
- 新运行时 ready marker 为 `.molly-complete`，已校验的旧 marker 缓存仍复用；新本地分支前缀为 `molly/`，原 `lody/` 分支仍可恢复。
- Electron 显示名为 Molly，但 userData 显式固定到既有 `Molly Design` 目录；App ID、深链、`~/.molly` 和更新源不变。

### 明确保留的边界

- `LodyAI` 作者、许可证、仓库 URL、外部子模块、来源校验和继承站点是事实，不改写。
- `_meta.lody`、`_lody/*`、ACP Core 导出符号是外部协议；内部变量跟随这些协议时保留可识别名称。
- 现有 Flock 的 `dotlodyPath`、来源枚举和历史输入配置字段，以及 `lody/supervisor-shutdown` v1、CRDT bucket ID、预览 capability token/cookie 名属于有存量消费者的序列化合同。本轮保留 wire 名称，不重建 Flock 或降级权限校验。它们不是当前产品展示名。
- `Conf` 的 `lody-desktop` 项目键仍是既有窗口/快捷键存储身份；不把其他真实 Lody 目录当作迁移来源。既有 Git credential helper 文件名保持旧工作区配置引用连续性。
- 保留的 cloud 安装档案、旧 npm 自升级目标和 cloud 用量导出的上游 SVG 属于继承的非本地产品能力；不将其替换成不存在的 npm 包/服务，不启用这些能力。当前 Molly 图标消费者使用已有 Molly 资产。
- E2E 的历史 journey ID 和录制格式 ID 保持稳定，场景可见文字改为 Molly。历史笔记、Changelog、合成历史输入及兼容测试允许出现旧名。

### 验证

- 安装与格式：`pnpm install`、`pnpm format` 已完成；新增文件另经 Prettier 检查，`git diff --check` 通过。
- 完整检查：最终 `pnpm check` 全部通过，覆盖 typecheck、lint、完整 test:ci、i18n 和三项边界检查；其中 CLI 2595 项、components 2888 项、Electron 139 项通过。现有跳过项仍为 loro-streams-rpc 3 项、CLI 4 项，没有因改名新增跳过。测试进程移除继承的提供商认证变量，使用合成输入。
- 文档与边界：`pnpm run docs check` 零错误；`pnpm check:quick` 通过，包括 i18n、Code Collab 导入、platform 和 public boundary（4350 文件、24 manifests）。既有 lint 警告未在本轮清零。
- 构建：根 `pnpm build` 通过；最后的设置封装修改后再次完成 Electron `build:app`。macOS arm64 `--dir --publish never` 打包成功，Bento hash/license 与原生依赖门禁通过，产物 `apps/electron/dist/mac-arm64/Molly.app`，仅本地签名，不公证、不上传。
- E2E：`pnpm e2e:check` 通过；真实 Electron smoke 的 3 个场景、18 个步骤通过，覆盖 onboarding、session 和 worktree lifecycle，使用合成数据与独立 profile。
- 包内设计验证：`Molly.app --molly-p1-verify` 返回 0，报告 `status: passed`、`packaged: true`、`appName: Molly`。覆盖编辑、跨隐藏 undo/redo、重开、提交刷新、冲突/失败保留、独立副本、PNG 透明/JPEG 白底及 913×617 尺寸；source preview/import 两份报告也通过，包含只读、CAS、资产失败与丢回复幂等检查。
- 构建基线：`2b0944a7b521a0d881ed6568c2087f226d90f49d` 加本轮未提交工作区，不将该 SHA 声称为包含补丁的发布 commit。包内证据保存于本机临时目录 `/var/folders/dn/56hdvtt50g19brtctz0c9c7w0000gn/T/molly-rename-packed-qb4544yz/evidence/`；没有操作 `/Applications` 或真实用户资料。

限度：未做旧正式安装包到新包的受控升级、Windows/Linux 运行验证、真实付费 Agent/图像请求或人工菜单/Dock视觉验收；旧数据兼容由合成确定性测试验证，不宣称已对真实用户资料执行迁移。英文翻译待补；没有创建 Issue/PR、提交或发布。
