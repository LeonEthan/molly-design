# Molly 独立开源仓库收敛

Status: implemented
Translation: pending

## 摘要

Molly 已有独立桌面身份，但贡献入口、CI 和默认依赖仍混用 Lody 的产品范围。
本次将贡献与安全入口统一到 Molly，修正 Issue 关联和 CI 包选择，正式发布构建限定为
macOS arm64，并按真实消费者缩小默认工作区。上游源码和许可证保留，权利人确认自有
适配代码按 Apache-2.0 发布。仓库整改已实施；签名、公证、最终安装包完整旅程与真实
自动升级仍需单独验收，不能由静态检查或本地构建推定完成。

## 关系与范围

承接[独立首发方案](../../proposed/feature/2026-09-13-geon-independent-brand-release.zh.md)
与[独立发布规格](../../../../specs/molly-design-independent-release.zh.md)，以及
[内置 Pi 迁移](../../proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md)。
本记录只裁定仓库维护与发布配置，不改变设计执行、人工保存或历史兼容合同。
不公开发布安装包，不执行真实付费模型调用，不修改用户的其他工作区改动。

## 已修复的问题

- PR 完整链接曾只识别 Lody，且会把上游链接改成本仓库 `Closes #N`。
  现在仅本仓库链接参与归一化，上游引用原样保留，不算本仓库 Issue。
  回归覆盖本地、完整、显式 Refs、外仓库引用与幂等性。
- 增量 CI 曾通过 `--filter lody` 准备不存在的包。改为真实 `molly`，
  并使用 `--fail-if-no-match`；测试核对实际 manifest 的包名与命令存在性。
- 贡献指南、Issue/PR 表单、策略提示与维护者识别改为 Molly。
  保留旧机器标记供现有机器人评论识别；旧版本表单标题仍可读，不重置原有宽限期或历史状态。
- 安全入口改为 Molly 私密报告页；实际查询发现该仓库未启用私密漏洞报告，
  已启用并读回 `enabled: true`。没有创建 Issue、评论或发送报告。

## 依赖边界的取舍

默认保留 `acp-extension-core`、`acp-extension-dsh` 和 Bento 三个子模块。
DSH 仍被 `packages/shared/src/deepseek-harness.ts` 导入能力合同；删除它会破坏
真实消费者，内置 Pi 并不意味着所有旧合同已经无用。

Claude/Codex/Grok/Kimi 子模块保留在 Git 中，但不参与根 pnpm。Kimi 原本就已隔离；
其余三个本轮退出。根工作区也排除 Lody `site-docs`，移除默认启动入口，CI 不再因
网站源文件安排桌面检查。根依赖安装与 CI 初始化只需要三个保留的源码依赖；内部 CLI 包标记 private，避免误发为独立 npm 产品。
工作区回归测试检查真实包集合，以及每条 `workspace:` 依赖都能在该集合内解析。

曾考虑将所有嵌套源码摊平或直接删除旧项目：前者扩大 Molly 的上游维护责任，后者会
破坏仍有消费者的合同与历史探针，因此不采用。网站作为上游参考保留，不宣称它现在
可以脱离原工作区独立安装或作为 Molly 产品网站发布。

Bento 保持现有固定 commit、五个补丁、vendor hash 和本地 overlay 组装路径。
构建说明明确根 pnpm 与 Bento npm 锁文件的边界、冷缓存网络需求和临时 worktree
清理行为。未新增构建缓存、快照仓库或自动付费重试。

## 许可证与发布

2026-09-20 权利人 LeonEthan 确认拥有 `agentic-listing-design` 中迁入的自有代码，
并明确授权这些代码按 Apache-2.0 发布。范围写入两个设计包的来源 manifest、README
和根 NOTICE；Bento、第三方技能、字体与图标继续保留各自许可证。保持 pinned 源码
字节不变。内置声明生成器增加该适配来源，Bento 资源携带 Molly LICENSE/NOTICE。

正式 release workflow 只构建 macOS arm64；其他平台仍可本地实验构建，不声称正式
支持。打包与发布共享同一解析出的版本，修复手工触发时省略版本可能生成 `v` 标签的
问题；发布制品附带 SHA256SUMS。现有签名、公证与 Sparkle 凭据仍为发布前置条件。实际只读查询确认当前仓库没有 Release，
仓库级与 release 环境的 secret 名称列表均为空；没有读取或输出任何密钥内容。

README 的中英文入口缩短为产品、开始使用和仓库地图；完整配置、恢复与既有验收
限制迁入根 USER_GUIDE 语言对。CONTRIBUTING 负责开发与上游维护，Electron README
负责发布准备。不新增文档站或全局工作索引。

## 验证与限制

依赖安装完成，默认根工作区输出为 20 个项目。锁文件更新主要删除退出项目的依赖；
不是一次全量依赖升级。验证结果：

- `pnpm check` 通过：类型、lint、全量配置测试、i18n、代码协作与平台/公开边界检查。
  既有 6 项集成/可选测试跳过，未新增跳过项。
- GitHub 自动化与 Sparkle 定向测试共 110 项通过；工作流 YAML 解析通过。
- `pnpm build` 成功；`--mac --arm64 --dir --publish never` 本地打包成功，
  包内 Bento 字节、图片解码器、Pi SDK closure、本地服务启动与原生绑定探针通过。
- 渲染资源校验确认 LICENSE/NOTICE 和各第三方声明存在；锁文件冻结校验通过。
- 本次修改文件完成 Prettier 格式化，文档检查与 `git diff --check` 通过。
  保留既有规则文件大小警告；没有注册 SHA topic。

本地打包为目录制品与原生探针，未作为签名、公证或完整用户旅程验收。

完整检查暴露既有 `live-fingerprints` 测试要求最近 30 个提交标题包含 PPTD/Folio；
正常新提交会使该条件失效，GitHub 浅克隆同样无法满足。删除这一非产品行为断言，
保留真实源码来源、manifest、诊断与材料检查；没有改写或删除 Git 历史。

尚未执行公开发布、签名/公证、两个真实签名版本的升级或最终安装包的付费模型旅程。
已有安装版证据见[用户指南](../../../../USER_GUIDE.zh-CN.md#发布状态与支持限制)。
Spec 保持 draft，翻译 pending，不将本次实施视为整份规格批准。
