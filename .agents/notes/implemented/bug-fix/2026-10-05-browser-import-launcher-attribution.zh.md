# 开发版浏览器导入的启动器权限归属

Status: implemented
Translation: pending

## 摘要

开发版 Molly 的网站账号设置无法列出 Chrome 配置，刷新后导入按钮仍禁用，而启动终端已有 Chrome 数据访问权限。macOS 实际把运行中 Electron 的浏览器数据访问归属给启动链中的 Claude Code，并拒绝读取。从已有浏览器访问权限的启动环境正常重启 Molly 后，现有配置发现和导入流程恢复，Pinterest 在内置浏览器中识别了导入的账号。中英文错误提示和使用文档补充了编程 Agent 的权限归属；本次没有新增读取器或权限机制，开发会话仍只保存在内存中。

## 问题与证据

本记录补充[开发版导入](../feature/2026-10-03-development-browser-account-import.md)的启动归属证据，不改变其系统授权、签名或持久性边界。[此前发现诊断修复](2026-10-04-browser-import-discovery-diagnostic.md)处理的是成功读取后误拒绝服务目录诊断；本次失败发生在列出配置之前。

- 在实际设置页点击 Refresh 后，Chrome、Edge、Brave 仍被列为不可读取，Import from browser 保持禁用。该界面断言能够重复捕获原始症状。
- 当前进程的 macOS TCC 请求使用 `kTCCServiceSystemPolicyAppDataDetailed`，访问方是 Electron，负责方是 `com.anthropic.claude-code`，结果为拒绝。终端已有权限不意味着其启动链中的编程 Agent 也有权限。
- 同一工作树中的生产 `listImportSources` 从已有权限的 Otty 启动环境返回 3 个 Chrome 配置。使用相同原生依赖的隔离普通 Electron 探针也返回 3 个配置，排除了缺少 Chrome 配置或 Electron 原生依赖不可用的解释。
- 记录仅保留诊断结论和数量；没有提交原始系统日志、用户会话、账号标识、配置路径或 Cookie 值。

## 复用与修复

1. 检查并实际重试 `BrowserAccountsSetting` 的现有 Refresh。它能够更新来源列表，但不能改变已运行进程的系统权限归属，因此单独刷新无法解决本次拒绝。
2. 原样复用 `listImportSources`、固定版本 `rookie-cookies`、站点限定读取和 Cookie 导入事务。证据指向系统访问拒绝，没有理由更换读取器或放宽失败检查。
3. 在作品显示 Saved、当前回合已结束时正常退出应用，经过现有保存与退出流程，再通过根目录 `pnpm start:local` 从已有权限的启动环境重新启动。没有修改系统权限、签名、权限数据库或源浏览器数据。
4. 只适配既有中英文 `unreadableSources` 提示，以及[使用指南](../../../../USER_GUIDE.md#built-in-browser-research-current-development-build)和 [Electron README](../../../../apps/electron/README.md)：开发版需检查启动它的终端或编程 Agent，也可直接从已有权限的终端启动。无需增加文件夹选择器、书签、子进程读取协议或新存储。

[设计工作台 Spec](../../../../specs/graphic-design-platform.zh.md#内置网页调研与素材)的站点限定导入目标和 draft 状态均未改变。设置继续要求选择来源配置并主动导入；Cookie 数量仍不作为网站登录证明。

## 验证与限制

- `pnpm install` 完成，依赖和锁文件没有变化。
- 浏览器来源、签名和服务的 25 项测试，以及网站账号设置的 5 项测试通过；其中设置测试覆盖不可读取来源、手动刷新恢复、授权等待和显式重试。本次没有用模拟测试替代原生权限归属验证，也没有新增只断言文案的测试。
- 全仓 `TMPDIR=/tmp pnpm check` 通过，覆盖类型检查、lint、CI 测试、i18n 和公共边界检查；Loro RPC 保留其既有的 3 项跳过测试。修改文件的 Prettier 格式化和 `git diff --check` 通过。
- `pnpm build` 成功；`pnpm start:local` 重新完成本地 OSS 构建并启动实际桌面，配置选择器和 Chrome 导入按钮恢复。
- 实际设置页对选定的 Chrome 配置执行一次 Pinterest 导入，保存 6 个站点 Cookie。随后在 Molly 内置浏览器打开 Pinterest，网站进入账户首页并显示个人主页、通知和账户菜单；未手工登录网站。再次刷新设置后，Chrome 来源、导入按钮和已保存 Cookie 数量仍正常。
- 只读 Codex CLI 第二意见使用 `gpt-6-astra`、high reasoning，支持启动归属诊断及窄范围恢复，未发现文案和文档差异中的 P0/P1。它指出隔离探针不能替代完整桌面的导入和网站登录验收；上述实际验证由主执行者完成，意见没有自动应用。
- 本轮只验证当前机器上的 Chrome/Pinterest。Edge 和 Brave 仍不可列出；没有为它们授予权限。开发版退出后不会保留登录态，本轮未验证签名分发、公证、升级或重启持久性。应用保持运行，未执行发布。
