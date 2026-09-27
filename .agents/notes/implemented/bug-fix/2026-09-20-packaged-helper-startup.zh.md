# 本地安装包的 Helper 启动与资源范围

Status: implemented
Translation: pending

## 摘要

[#46](https://github.com/LeonEthan/molly-design/issues/46) 的完整打包在首次启动 Helper 时超时。
打包配置将本地 Sparkle 验证目录收入应用；改变输出目录时还会收入历史安装包。
本次排除这两个目录，并避免格式化改写已封装的 CLI 资源，复用全部原有打包探针。
修复后完整 DMG 打包、不同 Helper 签名的首次启动和独立目录安装启动通过；用户完成系统钥匙串授权后，安装包中的 Kimi `k3-256k/high` 新会话真实回复与结算通过。
产物仅为 macOS arm64 本地包，未公开发布，未完成 Developer ID 签名或公证。

## 问题与修复

接续[内置引擎实施记录](../../proposed/architecture/2026-09-19-embedded-pi-harness-implementation.zh.md)，
不将此前图片探针的路径别名修复当作 Helper 超时的修复。
基线 `29777922` 上复现：旧默认产物的 `app.asar` 为 1.7 GB，包含 `.sparkle-local`；
独立输出目录还把旧 `dist` 打进去，应用达到 7.7 GB。
首次 Helper 的 30 秒图片探针超时，进程采样只有 `_dyld_start`，尚未进入 JavaScript。

`electron-builder.yml` 仅增加 `.sparkle-local` 和 `dist` 排除项。
减小实际打包内容后，Helper 和全部 after-pack 探针通过；没有延长超时、重试启动、
清除 quarantine/provenance、修改系统策略、跳过探针或升级 Pi。
系统策略内部的具体阻塞原因仍无法仅凭采样证明；证据支持收窄包内容解决了本机构建的复现路径。
为排除相同签名缓存影响，另用 `0.1.0-issue46.1` 生成完整 DMG；Helper CDHash 从
`fdd05814b782289b172bba9e6da661d19d80833c` 变为
`4adf78f81f9b7dc99af2456f0840f3452af3f5e5`，首次探针仍全部通过。

另一次打包暴露出 `prettier --write .` 会改写 `resources/cli/harness` 的已封装 JS，
完整性检查正确拒绝改变后的资源。`.prettierignore` 排除生成的 CLI 和本地更新夹具；
重新同步构建资源后校验通过。并发任务改写资源导致的中间失败不算产品通过证据。
修复只涉及构建输入范围，不改引擎、凭据、取消、图片付费或设计事务。

## 构建与验收证据

- 源码基线：`29777922`，加本记录对应的打包配置修复；`pnpm build` 通过。
- 交付文件：`apps/electron/dist/issue-46-final/MollyDesign-0.1.0-arm64.dmg`，188,429,690 bytes；
  SHA-256 `afa920645a042f7a5369639ac043421310fadf9109232f6b26f3b716b97348f1`。
- 应用 0.1.0，Electron 39.5.1，包内 Node 22.22.0 / N-API 10，Pi 0.85.1，协议 1；
  引擎 build `50754cb985235537ca737170468d792bc2d88340dc610de72c85063c500064a4`，
  212 个依赖、13,751 个封装资源，包含原有 pi-ask-question 0.4.0。
- 最终 `app.asar` 110,153,657 bytes；实际归档确认无上述两个本地目录。
  完整打包的 Bento、图片解码、Pi、CLI、PTY、SQLite 探针通过。
- 从 DMG 复制到独立测试位置，卸载磁盘镜像后启动；`codesign --verify --deep --strict`
  通过（仅 ad-hoc 签名）。PATH 限为 `/usr/bin:/bin:/usr/sbin:/sbin`，使用独立
  Molly 数据与 Electron profile，首次配置界面正常，空连接提示可手工编辑/导出，缺项时禁止保存。
- `pnpm format` 通过且未改写封装资源。Electron 173 项、打包/解码定向 11 项通过。
  `pnpm check` 类型检查和 lint 通过，测试被既有 `live-fingerprints.test.ts:121`
  Git 历史文字断言阻断。继续执行剩余包：Shared 1,314、Harness 242、Components 3,184 项通过；
  CLI 3,060 项通过、3 项跳过，另 1 项 `cli-platform.test.ts` 被宿主继承的 cloud 环境影响。
  仅移除 `MOLLY_PLATFORM` / `LODY_PLATFORM` 后重跑该文件，7 项全部通过，未修改测试或产品逻辑。
  i18n、模块/平台/公开边界和文档检查通过。规范、Spec 双轴审查均无 P0/P1，
  审查时保留的真实会话验收缺口由下节补齐。

安装验收仅复制既有加密连接文件，未读取密钥明文、私人会话或用户素材。
不将本机安装启动等同于其他平台支持。

## 钥匙串授权后的安装包验收

用户在系统界面完成钥匙串授权后，沿用同一最终安装包及独立测试目录完成以下操作：

- 通过原生设置编辑并保存 Kimi 连接，密钥框保持空白以保留已存加密凭据；连接 revision 为 3。
- 首次引导未提供可选引擎，使用其已有「Skip for now / Enter Molly」进入工作台，显式选择本地机器后正常提供 Molly 模型目录。该引导限制保留；不需要安装外部 CLI。
- 在新设计会话中显式选择 `k3-256k` 和 `high`，发送合成的单句连接验收任务，要求不调用工具、不读写文件。
  原生界面收到符合任务的中文回复；运行时画布只读，结束后恢复编辑和导出。
- 运行账本为 `settled` / `completed`，仅一个模型请求且为 `succeeded`；
  usage 为 input 8,817、output 35、cache-read 0，费用未报告。新增图片请求为 0，无工具调用或自动重试。
- 运行快照的 Pi 版本、协议及 buildId 与上述最终包一致；插件集合摘要为
  `7e17c76220158a869a5c9525f819ec4fdcaf1a65f306ef4be66276b9ae1b06b7`。
  原生「Bundled capabilities」也显示相同引擎 build 和 pi-ask-question 0.4.0，
  明确说明终端 UI、可选 grill-me 和命令映射限制，不把目录当作全部能力已验收。
- 在连接编辑表单填入无效地址后，保存禁用，提示更换 endpoint 必须重新授权凭据；取消编辑后原连接保留。
  本次没有故意向真实服务发送错误 Key 或错误模型请求，认证/协议错误继续复用现有回归证据。

记录只保留构建、状态和用量摘要，不提交实际会话 transcript 或密钥。
该证据完成 #46 的本地安装与 Kimi 新会话范围，不替代完整设计旅程、其他 Provider 或正式分发验收。
