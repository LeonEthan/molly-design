# 移除内置 pi-subagents 扩展与子会话凭据发布

Status: implemented
Date: 2026-10-04
Translation: pending
Issue: [Molly #72](https://github.com/LeonEthan/molly-design/issues/72)

## 摘要

内置 `pi-subagents` 子会话可以通过语言模型连接访问 Pi 的图片模型，绕过产品配置的图片连接；既有记录还指出后台子进程可能越过主回合的编辑生命周期。所有者将 #72 扩大为移除整个扩展及专属集成，并授权按分步计划实施。Molly 现已删除包、配置、能力展示和子会话凭据发布，复用 Pi 的内存接口运行主会话，保留其余五个扩展和已有历史。原生回归、完整仓库检查、CLI 封装和 macOS arm64 实际 Helper 的合成检查均通过；随后当前桌面构建的真实 Kimi 两回合验证了 Codemode、重启续接和五项能力展示。代价是退出该扩展的委派、并行、工作流与后台能力；旧版已分离任务必须在升级前退出，旧凭据副本不会自动删除。

## 范围决定与复用

本变更替代 [原生包方案](../../proposed/architecture/2026-10-01-pi-native-addons.md)中保留子扩展、为其发布凭据及子会话安全扩展配置的部分，以及 [MCP 改造提案](../../../../research/redesign-proposal.md)中等待子会话模型开关的处理方向。旧记录的当时选择与验收仍是历史证据。[Harness Spec](../../../../specs/molly-embedded-pi-harness.zh.md)双语稿同步目标，保持 draft；实现和检查不构成整份 Spec 的批准。

复用现有 Pi 主会话、Molly 生命周期、manifest 驱动封装、共享 `MOLLY_PI_PACKAGES`、能力 reader 和历史读取。仅隐藏工具或等待上游不能满足完整移除目标；自制子扩展、Pi patch/fork 违反已发布包边界，替换委派系统增加未请求的能力与生命周期。已有组件足以承担保留职责，无需新协议或存储。

## 原图片入口的证据

锁定 Pi 1.0.0 与 `pi-subagents` 0.74.0 的真实前台子会话工厂，在隔离临时 profile 中使用合成 OpenRouter Key 与合成推理。探针只检查类型和目录，阻止外部 fetch，没有 MCP、skills、项目或环境扩展，也没有调用生图。

| 条件                                 | models 类型 | 图片模型数量 | generateImages |
| ------------------------------------ | ----------- | -----------: | -------------- |
| 默认受管 profile                     | object      |           57 | function       |
| profile 加 codemode.models false     | object      |           57 | function       |
| 子会话只允许 codemode 工具           | object      |           57 | function       |
| 探针显式传公开 models false 工厂选项 | undefined   |            0 | undefined      |

默认结果重复一致；最后一项仅为测试工厂注入对照，未用作产品补丁。主会话 [mcp.ts](../../../../packages/harness-pi/src/mcp.ts)已明确传 `models: false`，子工厂使用默认配置，而 Pi 使用 `options.models ?? true`。[Pi 1.0.2](https://github.com/earendil-works/pi/blob/cd32f7725fdbddbaecdff5b1e68491563394e0ca/packages/coding-agent/src/extensions/codemode/index.ts)和 [pi-subagents 0.75.0](https://github.com/nicobailon/pi-subagents/blob/ad56bf92fe01a2a5abd962938c619eb2a22ca47d/src/runs/shared/child-session.ts)的源码仍沿用该行为；较新版本未进行完整运行。临时探针已删除，没有保存会话转录。

上一轮只读 Codex CLI 第二意见使用 `gpt-6-astra`、high reasoning，确认设置和工具选择不能关闭该全局，判断为 P1 产品目录与路由合同违约。其在保留委派前提下等待上游的建议，已被所有者的完整移除决定替代。未将意见自动应用为运行时修改。

## 实施顺序与结果

1. 删除 harness manifest 依赖、根 Pi catalog pin、release-age exception 和共享包列表项，由 pnpm 重算 lockfile。现有 staging 与能力读取按清单派生，无平行库存。
2. 删除 `profile-settings.ts` 的 `subagents` block、`SUBAGENT_DEFAULT_PACKAGES`、外部 CLI 子 Agent 发现及专属路径解析。普通 package resolver、profile writer 和主会话 `cc-safety-net` 保留。
3. 审计发现主会话原先也读取 `auth.json` 和 `models.json`，因此先采用锁定 SDK 的 `InMemoryCredentialStore`、`InMemoryModelsStore`、`modelsPath: null` 与已有 `setRuntimeApiKey`，验证主会话消费者后删除 `persistConnection`、native login 和原子模型文件发布。保留 provider config/fingerprint、fd-3 grant、每 worker Key 不变、run fence、记忆提取与使用量、历史 writer guard；`process-lock` 仍被历史使用。旧 profile 文件原样保留且不导入。
4. 删除 Settings 扩展行、中英文文案、Storybook 项和专属 fixture。现有生成器更新通知和归属，仅删除不再交付的包。
5. 撤下专属子工厂、CLI 子 Agent 和凭据发布竞态断言，保留有消费者的锁与连接检查。真实 SDK 新会话无扩展入口；合成旧历史包含 `subagent` 调用和结果，重开仍可读、不重放，并使用当前工具集合。
6. 更新现有 worker 冒烟，检查 manifest/resources、工具和命令缺席、原生 Codemode 与嵌套 read 可用，以及合成 Key 发往正确端点、没有新增 profile auth/model 文件。CLI 构建及 sealed worker 检查通过。
7. 同步 harness README、作用域规则、draft Spec 和活跃研究记录；保留历史决策并链接本记录。运行时目标与升级退出边界已写入拥有文档。
8. 仓库格式、完整检查、public boundary、文档和实际 macOS Helper 验收结果在下面登记；不将部分源码通过转记为完整交付。

## 升级与保留边界

保留通用共享 `subagent_task` 历史、普通 Session/task MCP、既有原生/产品消息和作品。主会话 MCP、Codemode、工具搜索、skills、问答、提及、文件搜索和安全底线继续承担原职责。图片仍通过用户显式图片连接；移除扩展不是 OS 沙箱，也不承诺阻止任意 shell 请求。

旧包公开 `subagent({ action: "stop", id: "<run-id>" })` 及 `/subagents-stop`，但本轮未执行真实 detached 收尾验证，发出停止请求不证明所有进程已退出。升级前应完成或停止旧前台、后台及计划任务，并确认它们已退出；无法确认时暂缓升级。新版本不广泛杀进程，不自动清除旧 profile/history，不声称已撤销旧 Key、擦除旧明文或追溯收尾已发生的编辑。

## 验证与限制

| 检查                                         | 结果与范围                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 原生 profile、Codemode、host 与 history race | 首轮 48 项通过；覆盖剩余扩展加载、连接隔离、Key 变更拒绝、使用量及记忆等主会话消费者                             |
| 增补旧 subagent 调用恢复                     | Codemode/defaults 六项通过；旧结果可读、不重放、当前工具不含扩展                                                 |
| Settings 中英文 inventory                    | 五项通过                                                                                                         |
| Electron model-connection 服务               | 34 项通过                                                                                                        |
| CLI build 与 sealed worker smoke             | 通过；清单、资源、入口缺席；合成推理与嵌套 read 可用；新 profile 无 auth/model 文件                              |
| pnpm format / pnpm check / public boundary   | 通过；完整 harness 16 文件、152 项；CLI 3,102 项通过、三个既有 skip；public boundary 4,704 文件、20 manifests    |
| 文档检查                                     | 通过，零错误；17 个既有作用域规则尺寸预警、零保护主题                                                            |
| macOS arm64 实际 Helper                      | 签名包构建、codesign 验证和实际 Helper 合成 smoke 通过；Pi 1.0.0、六个保留命令；实际产物能力 reader 返回五个扩展 |

### 真实桌面回合与重启续接

用户另行要求真实测试后，复用现有 `ElectronHarness` 的 built OSS desktop 入口和正常原生界面，不增加回归旅程或测试引擎。历史 Kimi Code CLI 长图 runner 不运行本次嵌入式 Pi，不能充当 #72 的验收；本轮也不是 installed-package acceptance。应用使用独立 Electron/CLI 数据、工作目录和随机端点；仅在临时 profile 内复用已有加密连接，未读取或输出明文 Key，结束后临时 profile 已删除。外发仅为合成验收文字与正常工具上下文，预算为两个用户回合、每回合五分钟、零图片调用，不自动重试。

实际构建来源为 `c87b7d299a7f15d1d076035d9dfe928a8b80eab2` 加本次未提交改动，Pi 1.0.0，harness build ID `8e09a0c8ce2c45f3bf728d27fc1da5acb55eeffebe30d69a8c8dad9b629b72ce`。主进程、preload、renderer、CLI、manifest 和源差异摘要随私有证据保留。更正：最初按 Spec 旧记录称模型为 `k3-256k`；当前锁定目录的 “Kimi K3” 对应 `kimi-coding/k3`，两轮真实原生回执均记录 `k3`，界面选择并保留 `high`。本轮不据此声称旧模型 ID 已通过。

| 真实检查           | 结果                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首轮真实 Codemode  | 写入并读回合成标记；`typeof models` 为 `undefined`，完整可枚举 tools 中没有 `subagent` 名称；仅一次 Codemode，无 shell、委派、设计文件或图片调用；界面用时 26 秒    |
| 应用退出与重新进入 | 所属进程和旧端点退出验证通过；原会话历史、模型与 High 选择仍可见                                                                                                    |
| 重启后真实续接     | 原标记保留，新标记写读成功；`models` 与 tools 检查结果不变；界面用时 23 秒                                                                                          |
| 原生恢复与持久化   | 继续使用同一个原生 session ID，旧历史字节前缀摘要一致；两次 Codemode 对应两个不同回合，首轮调用未重放；没有新增 `auth.json`、`models.json` 或模型缓存文件           |
| 正常生命周期与设置 | 两轮自然结束，画布从运行中只读恢复为可编辑；Advanced 实际展示 Pi 1.0.0 和五个保留扩展，无子扩展行                                                                   |
| 使用量与收尾       | 四条主响应、两条个人记忆提取用量均归属 `kimi-coding/k3`；总 token 43,294（含缓存），SDK 费用估算 $0.0670692，实际账单未知；最终所属进程、端点清理通过，临时数据删除 |

不可变轮次位于忽略的 `e2e/artifacts/acceptance/issue72-live-20261004-01/` 和 `issue72-live-20261004-02/`。第一轮因测试脚本调用已不存在的 IPC 名称，在模型派发前失败，零真实模型/图片调用且清理通过；第二轮是上述通过记录。原生历史、截图、摘要、断言结果和构建身份只保留在忽略目录，没有将转录、机密连接或机器状态加入 tracked 文档。

本轮完整 diff 的只读 Codex CLI 第二意见同样使用 `gpt-6-astra`、high reasoning，未发现有证据支持的 P0/P1。它独立验证 CLI 闭包的 225 个包、19,695 个资源摘要与当前 lockfile，文档/public-boundary/差异检查通过；未重跑推理或启动 Agent。该意见是具名 advisory，实际测试证据以上述本轮执行为准。

归属保留现有生成器的输出形式，避免附加逐文件 Prettier 探针引入全文件重排；components 没有包级 format 脚本。额外 root lockfile Prettier 探针发现原 HEAD 已有的格式差异，保留 pnpm 的文件形式和无关依赖版本；冻结安装通过。仓库要求的 pnpm format 已通过。

最初的产品回归与 Helper smoke 均为合成推理；上述后续轮次另行验证了当前桌面构建的真实 Kimi 与实际 GUI。未调用图片供应商，未验收旧 detached 进程退出、旧明文清除、其他模型、完整设计黄金用例或人工视觉质量。签名包检查与本轮 built desktop 真实服务是两份独立证据，不能合并声称真实 installed-package 验收；打包器未配置公证，未验证 Gatekeeper 首次安装或发布条件。英文翻译待补；上述验收期间没有 commit、PR 或公开发布。
