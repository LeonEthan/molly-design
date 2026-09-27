# Molly Design 独立品牌与首发清单

Status: proposed
Translation: pending

## 摘要

现有 Molly Design 已隔离主要安装身份和数据目录，但仍继承 Lody 图标、引导演出、公开 CLI 命名、部分发布配置及少数硬编码路径。独立产品目标已经明确：对外全面使用 Molly Design，内部命名按兼容成本逐项裁定，以纸张与版式为方向重新制作动画与音乐，不迁移 Lody 数据并保护已有 Molly Design 数据。Molly Design 控制运行时资源分发，品牌、引导、公开接口、分发与支持入口独立化构成首发前置条件。本清单区分真实产品入口、兼容接口和上游来源记录；本轮仅记录方案与源码证据，没有实施品牌替换或授权发布。

## 与既有决定的关系

[T26](../../implemented/feature/2026-09-11-folio-public-help.md) 当时明确保留水母图标、内部名称、兼容接口和上游网站材料；[T23](../../implemented/feature/2026-09-11-first-design-onboarding.md) 保留既有插画及引导框架。本提案扩展品牌独立化范围，拟替代上述视觉保留决定，不推翻其历史验收。[设计 Spec](../../../../specs/graphic-design-platform.zh.md) 继续拥有设计行为合同；待方案完整确认后，涉及改变合同的修订须按 Spec 规则回到 draft，不能把既有批准延伸到新方案。

## 已确定的边界

- 用户界面、安装包、用户可见配置、分发与支持入口统一为 Molly Design。独立 CLI 产品已从范围删除；内部包名、协议按实际消费者和兼容成本逐项裁定。
- Logo、首次引导动画及音乐重新制作，统一方向为“纸张与版式：克制、精致的设计工作台”；首次开场自动播放音乐，同时保留静音和跳过，之后启动不自动重播。
- Molly Design 与 Lody 独立安装，不自动读取或迁移 Lody 数据；已有 Molly Design 数据必须继续可用。
- 保留准确的上游作者、许可、依赖来源和历史事实；README 可说明开源来源。产品品牌与来源归属分开处理。
- Molly Design 控制 Agent 运行时资源下载地址与资源发布；可继续复用有准确来源记录的上游适配器。
- 品牌、引导、公开接口、分发与支持入口独立化作为首发前置条件；有理由的内部兼容名称允许记录后保留。
- Molly Design 不提供独立 CLI 产品：删除独立命令行发行、安装和用户使用入口的范围，不另造 molly CLI。现有 apps/cli 中承担 Agent 执行和本地服务的实现属于桌面内部运行组件；这项产品删减不授权直接删除该后台模块。
- 首版提供应用内自动更新，使用 Molly Design 独立的更新来源与验证身份；现有 local updater 禁用策略需要显式修订，不能仅替换地址。更新须保护已有 Molly Design 数据，避免中断未保存编辑或执行中的 Agent；安装时机与失败处理在实施方案中明确。

## 候选实施与验收清单

以下为方案清单，不是已获运行时实施授权的任务表。已有局部实施仍需新安装包核验。

| 范围 | 具体工作 | 验收观察 |
| --- | --- | --- |
| 品牌素材 | 新 Logo、字标、应用图标及透明/小尺寸变体；覆盖 PNG、ICNS、ICO、Dock、安装器和应用内图标 | 系统与应用内展示一致；深浅色及小尺寸可辨认 |
| 全部产品文字 | 主窗口、菜单、About、设置、加载、错误/恢复弹窗、通知、诊断报告、无障碍名称及中英文本；区分真实入口和不可达遗留页面 | 正常与失败路径均称 Molly Design，不只检查首页 |
| 首次引导 | 重写围绕设计创作的分镜、插画、动画、配乐和操作音；复用实际 Agent 配置与首个作品创建流程 | 全新用户从开场到首个可编辑作品；无代码产品或云端能力误导 |
| 引导控制 | 首次开场自动播放音乐，提供跳过、静音、减少动态效果；之后启动不自动重播，退出后停止音频 | 键盘可操作，静音和跳过生效，无残留声音；核验系统阻止自动播放时的可用入口 |
| 内外分享产物 | 检查可达的分享图、二维码、水印、导出默认命名、错误报告、日志头和附件标签 | 产物不替 Lody 宣传；普通设计导出不额外加品牌水印 |
| 桌面内部运行组件 | 删除独立 CLI 发行、安装和产品文档入口，不新建 molly CLI；保留桌面依赖的后台执行能力；审查环境变量与诊断信息中的旧身份 | 用户使用 Molly Design 无需命令行；桌面启动和 Agent 执行正常；旧 Molly Design 配置按明确兼容策略处理 |
| 系统身份 | 核验 appId、URL scheme、进程显示、userData、缓存/日志、守护进程、凭据标识及锁文件 | 与 Lody 同时安装运行互不抢占、不读写对方数据；路径命名变更不丢已有 Molly Design 数据 |
| 发布流水线 | 清理 Release 标题、CI artifact 名称、打包日志、发布 owner/repo、安装器元数据及维护者字段 | 从 Molly Design 仓库全新构建得到 Molly Design 包与校验文件，发布目标正确 |
| 更新 | 清理继承的 Lody feed，建立 Molly Design 独立应用内自动更新；修订本地更新策略，配置制品验证、版本及平台筛选；签名/公证作为建议发布准备，所需账号另行确认 | 两个 Molly Design 版本间真实升级；拒绝错误来源、签名或不兼容制品；下载失败可恢复；更新不丢画稿、附件、设置或会话，不打断未保存编辑及执行中的 Agent |
| Agent 资源分发 | 改为 Molly Design 控制的公共运行时分发，维护版本/校验和、失败提示、镜像与上游来源 | 全新机器可安装 Agent；资源完整且与适配器合同一致 |
| 公开仓库与帮助 | README 以 Molly Design 为主体；保留集中来源说明；整理帮助、反馈、贡献规则、Issue/PR 模板、截图与网站材料 | 所有产品支持链接指向 Molly Design；旧 Lody 网站不被误当 Molly Design 文档 |
| 来源与素材 | 保留 LICENSE、适用署名及第三方清单；记录新图标、插画、音乐来源与可分发依据 | 归属真实，打包不再混入旧品牌素材；不重写 Git 历史冒充原创 |
| 内部命名 | 对 @lody 包、协议、LODY 环境变量、存储 key 和外部子模块列出保留/改名理由 | 不以全库零 Lody 为验收标准；跨边界改名有消费者与数据兼容检查 |

## 已核实的源码证据

- 已有 `dev.molly-design.app`、`molly-design://`、`~/.molly` 等隔离机制，来源见 T26；不应无理由再次改 appId。
- 但[分叉操作存储](../../../../apps/cli/src/session/session-fork-operation-store.ts) 和[预备 worktree](../../../../apps/cli/src/session/worktree/speculative-worktree.ts) 仍有硬编码 `~/.lody` 路径；[附件存储](../../../../apps/cli/src/lib/session-file-attachments.ts) 使用项目内 `.lody/attachments`。须检查 Molly Design 实际消费者及旧路径归属；不迁移 Lody 数据不意味着可以丢弃 Molly Design 已写入旧命名路径的附件。
- [打包配置](../../../../apps/electron/electron-builder.yml) 使用 `build/icon.*`；[图标资源](../../../../apps/electron/resources/icon.png) 与组件内图标还需一并替换，不能只修改一个 PNG。
- [实际引导入口](../../../../packages/components/src/components/onboarding/onboarding-overlay.tsx) 调用 IntroSequence 和 useOnboardingAudio；[分镜](../../../../packages/components/src/components/onboarding/ceremony/intro-sequence.tsx) 引用四张旧插画并驱动声音分层；[配乐](../../../../packages/components/src/components/onboarding/ceremony/use-onboarding-audio.ts) 由 Web Audio 合成，操作音另在 ui-sounds.ts。替换音乐不是寻找 MP3 文件。
- 加载页 `onboarding-loading.tsx` 曾使用旧图标和 Lody alt（实施轮已删除该文件）；[窗口失败路径](../../../../apps/electron/src/main/window.ts) 有 Lody 弹窗文字；[安装等待诊断](../../../../packages/components/src/components/onboarding/provider-wait-report.ts) 的报告标题仍为 Lody。
- [CLI](../../../../apps/cli/src/index.ts) 的公开名称仍为 lody，[manifest](../../../../apps/cli/package.json) 的 bin 也为 lody；包名、命令和内部 import 不是同一层变更。
- [发布 workflow](../../../../.github/workflows/release-electron.yml) 仍有 Lody OSS 标题和 lody-oss-release artifact 名称，但实际 workflow 发布目标取当前 `github.repository`；[打包脚本](../../../../apps/electron/scripts/package-electron.mjs) 仍输出旧产品日志，不能因此声称已发往 Lody 仓库。
- [Sparkle 默认地址](../../../../apps/electron/scripts/sparkle-packaging.mjs) 仍指向 Lody 发布源，但[本地更新策略](../../../../apps/electron/src/main/services/app-updater-sparkle-policy.ts) 禁用 local updater；这是发布配置残留，不是已证明发生跨产品更新。
- [公共运行时默认地址](../../../../packages/platform/src/runtime-artifacts.ts) 在审查时指向上游公共下载主机。这是现有平台合同允许的公共下载例外，不等于连接 Lody 产品云；用户已决定改为 Molly Design 控制分发，后续已确定使用 Molly Design GitHub Releases。
- `.gitmodules` 中的 LodyAI 适配器是实际上游依赖；源码来源不能仅因产品改名而改写为 Molly Design 原创。共享 ACP 合同与隔离 Kimi 子模块规则继续适用。
- [自动启动参数](../../../../apps/electron/src/main/auto-launch-policy.ts) 仍为 `--lody-auto-launch`；[默认 Agent Git 作者](../../../../apps/cli/src/session/git-identity.ts) 仍为 `LodyAI <agent@lody.ai>`。核对实际消费者后调整新写入身份，保留历史作者事实。

## 推荐交付顺序

1. 先锁定首发边界和公开身份，梳理已有 Molly Design 旧路径数据；不先进行全库替换。
2. 并行准备 Molly Design 品牌素材/引导分镜和运行时资源分发方案；具体素材制作另行开展。
3. 实施用户可见文字、图标、引导、命令与路径修正，再更新发布与支持入口。
4. 使用最终制品验收全新安装、已有 Molly Design 升级、与 Lody 并存、下载失败、引导跳过/声音、首个设计、保存重开和导出。清理确认无消费者的旧组件和旧资产。
5. 独立化门槛满足后再进行公开发布；本轮不修改或撤销远端发布状态。

## 清单确认与后续细化

本轮产品选项已确定：无独立 CLI、应用内自动更新、首次开场自动配乐。随后按 to-spec 请求综合为[独立首发规格](../../../../specs/molly-design-independent-release.zh.md)，并发布 [Issue #32](https://github.com/LeonEthan/molly-design/issues/32)，标记 ready-for-agent。本地规格保持 draft；此操作授权规格发布，不等于授权应用公开发布、实施完成或批准整个本地 Spec。

公开配置兼容别名和内部 namespace 依据消费者核查再定，不预设一次性全面改名。新素材具体分镜、资源托管位置、更新安装时机与失败处理留待相应设计/实施任务；不凭空指定基础设施。macOS 签名公证与更新制品验证分开说明，所需发布者账号和证书在准备阶段确认。

## 验证与限制

### 实施进行中（2026-09-13）

用户已授权开始实施，工作分支为 `codex/independent-release`。本记录保持 proposed，直到新增范围完成验收；先前“仅文档”的说明描述规划轮，不再表示当前没有运行时改动。

- 已接入 Molly Design 原创矢量纸张图标及 PNG/ICNS/ICO 导出；四段式排版开场复用现有引导入口，本地配置背景退出代码任务 tour。静音和跳过已接线，最终视觉/听觉仍待检查。
- 品牌标记经用户评审更换：四个手工矢量候选（活版套印、对折纸、版式基线、手写 f）中选定“版式基线 C1”——横线纸面上由文字线构成的 F，行尾带赭色编辑光标，呼应文本可编辑的产品事实。已替换 `geon-mark.svg` 并重新导出全部平台图标（PNG/ICNS/ICO、Dock 加边母版、组件内 `geon-icon.png`）；候选稿与预览留在 `output/logo-candidates/`，非产品源码。
- 后台包设为 private 并移除公开 bin；保留内部包名和启动机制。已修正部分错误、分享、发布和帮助入口。新附件写入 `.geon/attachments`（更正：随 9a34d67 重命名从 `.folio` 改出，本节原记录过期；见 2026-09-14 修正），原消息中已保存的路径保持不变；旧附件不移动或删除。
- 自动更新使用 Molly Design feed，首发仅 macOS arm64。未配置有效包内公钥或原生更新桥时保持不可用，不回退到其他产品或未经验证的更新机制。更新安装通过既有画布主机状态和保存入口冻结新编辑/派发，忙碌或保存失败时拒绝安装并保留工作。
- 公共运行时 URL 改为 Molly Design GitHub Releases 的扁平版本化资源名，显式 API mirror 仍兼容；首发四个资源已本地暂存并通过原有 manifest 的大小及 SHA-256 校验，公开上传等待用户确认，当前默认目标尚不能宣称在线可用。
- 音乐请求准备使用 MiniMax `music-3.0` 生成一次无歌词开场音乐；密钥不进入仓库或记录。API 调用等待单次生成确认，现有合成音乐尚未被新配乐替代。
- 桌面构建通过；平台 17 项、Electron 135 项、共享层 1,095 项和后台 2,710 项测试通过。后台认证测试通过隔离继承的供应商环境执行。最后全量检查的组件部分为 3,293 通过、1 处旧错误标题期望失败；修正后相关 19 项测试定向通过。此前开场/等待报告的旧文案期望也已修正并在全量重跑中通过。最终 `check:quick`（含公开边界）与文档检查通过；不将分段结果表述为一次完整 `pnpm check` 成功。
- 真实 Electron 使用独立 user-data、数据目录和随机守护进程端口验证了开场显示、静音切换和进入配置的交互；开场截图留在本机临时验收目录。配置页在等待实际淡入状态完成后可见；先前空白截图为过早捕获。开场与配置布局已由 Agent 检视，仍待用户视觉验收。没有覆盖用户日常资料或已安装应用。
- 后续仍需完成音乐替换、运行时资源公开上线、正式签名/自动更新端到端验收、剩余可达品牌文案与清理数据提示审查。资源暂存脚本显式要求 `MOLLY_RUNTIME_SOURCE_URL`，不再硬编码上游主机；只验证既有 manifest，不改变版本或自动发布。
- 本机旧分叉操作目录不存在，旧预备 worktree 标记目录为空；仅核对目录存在和条目数量，未读取 Lody 记录。两处路径的通用兼容策略尚待完成，不能以此推断所有用户均无旧状态。

此前规划轮为源码及现有文档审查和规格 Issue 发布，当时未启动安装包、执行 Agent、生成素材、改动运行时代码或发布应用。源码中的字符串存在不证明对应 UI 在 Molly Design 本地组合可达；分享卡、云/mobile 页面等须先确认入口。未创建实施 PR；暂无需要固化的不可逆 ADR。

`corepack pnpm run docs status` 已执行；`corepack pnpm run docs check` 与 `git diff --check` 通过。文档检查有 22 条既有规则文件体积警告；本提案翻译 pending。规划轮未重跑产品测试；实施轮验证见上文。

### 用户批准资源发布与视觉候选（2026-09-13）

用户批准一次 MiniMax 音乐调用及四个已校验运行时的 GitHub 预发布上传，并要求先生成开场图片供选择。

- 用户选择 B 编辑设计静物，并进一步要求四种 graphic-design 场景，包含落地页设计。四幕已明确为海报、编辑出版、品牌视觉、落地页，使用不同图片及对应文案；B 作为第二幕及配置背景，后三张新生成中的海报用于第一幕。用户批准额外一次额度，累计 6 / 6 次图像生成已使用。四张最终 PNG 和完整提示词存入 components assets；未选候选不进入运行时。
- 首次 MiniMax 请求 HTTP 410；用户提供新凭据后尝试一次，再次 HTTP 410，业务码 2153 明确表示 Music API 不再向新用户开放。未收到音频，没有继续重试。用户改为授权操作其已打开的 MiniMax Audio 网页；页面要求首次条款确认和登录，已请求用户完成，随后 Mac 锁屏阻断操作。没有替用户接受条款，未在网页提交生成。
- 四个运行时及 SHA256SUMS 已上传，GitHub 报告的大小与 SHA-256 全部匹配本地校验结果。已公开为 [Molly Design managed runtimes v1](https://github.com/LeonEthan/molly-design/releases/tag/runtime-artifacts-v1) 预发布，非 latest，不发布桌面应用。
- 单图 B 接入后的完整 `pnpm check` 已通过（隔离继承的供应商环境），构建也通过。四场景最新改动另行验证，不把此前全量结果冒充最新结果。
- 四场景改动后，16 项引导测试通过（含图片/文案逐幕同步及末幕停留），`check:quick` 与桌面构建通过；公开 URL 下载的 SHA256SUMS 与本地文件一致。真实桌面逐幕视觉检查和网页音乐生成受 Mac 锁屏阻断，待解锁后继续。

### 网页配乐接入（2026-09-13）

以下记录音乐接入时的验证；最新图片方向见文末。

用户完成网页条款及登录后再次授权继续。MiniMax Audio 以 Music-3.0、纯音乐、数量 1 生成 `Molly Design — Form & Rhythm`（提交按钮显示 300 声贝）。下载无水印 MP3；原始成品 122.8 秒，未遵循 20 秒要求，因此本地提取前 20 秒并规范响度、淡入淡出，没有追加生成。

开场现使用打包 MP3，删除旧合成背景音乐及无用的能量/分轨接口。每幕 5 秒，末幕停留；播放不循环，静音不重启播放，自动播放拒绝可由用户手势恢复，离开/卸载立即停止，异步播放拒绝不再把已退出的开场标为等待手势。操作音效保持独立。新增播放生命周期回归，连同引导共 17 项通过。最终听感仍待用户试听。

本轮组件类型检查、`check:quick`、桌面构建与文档检查通过。使用隔离资料的真实 Electron 验证开场显示、静音切换与进入配置成功；检查了落地页末幕截图。音频文件经解码确认 20 秒、482,628 字节；自动化行为验证不代替人工听感验收。

### 图像原创方向与电商场景修正（2026-09-13）

用户否定旧六张静物方向，批准本轮新增 10 次额度，并明确第四幕为电商商品详情页（如亚马逊 A+ 图），不再使用落地页描述。参考图引导生成的四张 v2 仍过于相似；用户提出侵权风险后，放弃这一组，改为不传参考图的文字生成。

v3 四幕为夜间植物展海报、饮食文化编辑出版、绿色声景音乐节视觉系统、便携咖啡机 A+ 商品详情图。题材、命名、配色、构图均重新制定；统一的是 Molly Design 开场框架及表达、编排、视觉系统、商品叙事的递进。品牌图补做一次修正背景，共使用本轮 9 / 10 次（此前另有 6 次）。最终候选及完整提示词存入 assets 的 v3 文件，退出使用的 v1/v2 场景资产移除；音乐与应用标志保留。

四张已用于本地预览，文案与图片对应，组件 450 个测试文件、3296 项测试通过。图片仍待用户视觉验收；文字生成和差异化设计不等于已完成权利审查。Spec 保持 draft，本记录不表示首发完成。

### 文档滞后修正与旧品牌清理（2026-09-14）

对照实际代码逐条核查本记录与相关文档后发现三处滞后，本轮修正；另发现一处重命名遗漏的运行时缺陷，一并修复。

- **附件路径更正**：附件目录随 9a34d67 重命名已从 `.folio/attachments` 改为 `.geon/attachments`（`session-file-attachments.ts` 的 `ATTACHMENTS_DIR_RELATIVE`），本记录此前描述过期；同文件注释遗留的 `.folio` 已一并修正。原消息已保存路径不改动，旧附件不迁移或删除。
- **内部标记文件名保留**：设计工作区标记 `.folio-current.json`（当前投影）与 `.folio-managed-files.json`（技能清单）作为重命名前兼容名保留；消费者为 `current-projection.ts`、`skills.ts` 及 `workspace.ts` 的 Agent 提示文本（文本与真实文件名一致）。改名须为既有工作区提供读回兼容，首发前如需用户可见打磨再裁定。约束已写入 `apps/cli/src/design/AGENTS.md`。
- **旧场景与资产清理**：删除无消费者的 `underwater-scene.tsx`（其 24 个雪碧图在开场重写时已先行删除，文件引用悬空）与 `aurora-background.tsx`（`@paper-design/shaders-react` 的唯一消费者，该依赖一并从 components 移除并更新锁文件）；删除 `src/assets/onboarding/` 下四张旧插画（0 消费者）与无消费者的 `lody-icon.png`。保留仍有消费者的 `lody.svg`（设置用量页）与 `icon-transparent.png`（两个邀请页），其入口可达性随剩余品牌文案审查一并进行；`worktree.svg` 无消费者但与品牌无关，未处理。旧组件历史保留在 Git 中。
- **旧路径现状**：`session-fork-operation-store.ts` 与 `speculative-worktree.ts` 经共享安装档案解析到 `~/.molly`（local profile，`getLodyDataDir`）；规划轮“硬编码 `~/.lody`”的证据不再描述当前代码。遗留缺口不变：Folio 时期写入旧路径的标记没有迁移或读回策略（本机核查：旧分叉操作目录不存在，旧预备 worktree 标记目录为空）。
- **重命名遗漏修复**：`packages/ignore` 的目录遍历忽略集只有 `.lody`/`.folio`，没有 `.geon`；非 Git 工作区中 `.geon/attachments` 会进入 code-collab 变更追踪。已把 `.geon` 加入 `DEFAULT_IGNORED_DIRECTORY_NAMES`（保留两个旧名以覆盖旧工作区），并在 `directory-walk.test.ts` 断言三个产品状态目录均被跳过。

验证：ignore 包遍历测试通过；components 类型检查与 onboarding 流程/音频测试通过；`docs check` 通过。本轮为文档修正与已确认无消费者资源的清理，不涉及设计行为合同变更；Spec 保持 draft。
