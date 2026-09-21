# 将 Bento 编辑器源码内嵌进主仓

Status: implemented
Translation: current

[English](2026-09-21-vendor-bento-in-tree.md)

## 摘要

设计编辑器的上游 Bento 此前是来自外部组织（nyblnet/bento）的 submodule，Molly
对其没有控制权，构建时还要再套用五个 Molly patch 文件。这一安排让独立品牌发布
依赖第三方组织的托管，并迫使每次检出和 CI 都走稀疏 worktree 加 `git apply` 的
流程。现在 submodule 已移除，其 `slides`/`kernel`/`scripts` 子树内嵌到
`packages/design-bento/bento/`，五个 patch 已直接落到源码上；构建脚本改为复制
该树，不再现场组装 pinned worktree。构建产物 `editor.html` 与 `build.json` 与
变更前基线逐字节一致（sha256 分别为 `65e8e697…0533bb` 与 `633078d9…68ecb1c`），
因此发布的画布没有任何变化。接受的代价：今后升级 Bento pin 需要手工重新导入并
重放记录的适配，而不是改一个 submodule 指针。

## 问题

- submodule 指向 Molly 无法控制的 `nyblnet` 组织；上游强推或删除会破坏全新克隆
  和 CI。
- 每次构建都要建 detached worktree、稀疏检出并按序执行五次 `git apply`，既慢、
  在 Windows 上脆弱，也掩盖了实际参与构建的源码。
- 贡献者文档必须解释三个 submodule 的初始化仪式，而其中一个存在的意义只是被
  patch 成另一个样子。

## 决定

移除 Bento submodule，将其 `slides`、`kernel`、`scripts` 子树（连同 `LICENSE`
与 `THIRD_PARTY_NOTICES.md`）内嵌到 `packages/design-bento/bento/`，并按 manifest
顺序把五个 Molly patch 落为普通源码：

- `canvas-moveable-deferred-dragstart`
- `a1a2-semantic-editor`
- `web-product-session`
- `a1a2-native-mutation-seal`
- `gd4c-frame-decorators`

`scripts/build.mjs` 现在把内嵌树 `cpSync` 到临时目录，不再搭建稀疏 worktree 和
套 patch；vendor 覆盖层、脚本内的 pinned 锚点适配、`npm ci`、tsc/vite 构建、
产物哈希与许可文件输出均不变。`source-manifest.json` 保留同一个 `bentoCommit`，
并在 `appliedPatches` 中记录这些适配；退役的 `patches/` 目录已删除，其哈希条目
从 manifest 的 `files` 映射中移除。`packages/design-bento/AGENTS.md` 约束内嵌树
只能通过有记录的刷新变更。

引用同步：七个 workflow 的初始化行、README/README.zh-CN 与 CONTRIBUTING 去掉了
第三个 submodule（仍保留两个 pinned submodule）；`packages/design-bento/README.md`
改写为内嵌构建与重新导入的升级流程；NOTICE 写明内嵌来源；两条历史 note 中指向已删
patch 文件的 markdown 链接改指 `source-manifest.json`，不改写其历史论证。
`.gitattributes` 已将 `packages/design-bento/**` 固定为 LF，Windows 检出保持字节
一致；oxlint 原本就忽略该树。

## 考虑过的替代方案

- 保留 submodule：迁移成本为零，但外部组织依赖与 patch 流程仍在，全新克隆的
  脆弱性没有解决。
- fork 到 Molly 自己的组织并保留 submodule：消除了组织控制风险，但 worktree/patch
  的复杂度依旧，且事实来源被拆到两个仓库。
- 把打过 patch 的 Bento 发布为 npm 包：要为单一消费者增加发布流水线与版本管理；
  仓内源码树更易于审计和 diff。

## 验证

- 删除 `apps/electron/resources/design/` 后从内嵌树重建：`editor.html` 的 sha256
  为 `65e8e697ed453f33a1dae100d0c0c2ce64f7b40a607c28df286851d4100533bb`，
  `build.json` 为 `633078d957eb035b79aa0414c8423c7833cf8f5990f247cc14377a35968ecb1c`，
  与变更前基于 submodule 的基线完全一致；`verify-resources.mjs` 通过。
- `git ls-files` 与磁盘文件数一致（204 个），没有内嵌文件被忽略规则吞掉。
- `pnpm run docs check` 与完整 `pnpm check` 通过。

## 限制

- 未重新跑画布的视觉验收；等价性论证是构建产物逐字节一致，而非新一轮截图。
- 今后升级上游 Bento 需要手工重新导入子树并重放记录的适配，尚无自动化刷新流程。
