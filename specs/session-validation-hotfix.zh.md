# 临时跳过会话全状态校验

Status: approved
Approval: [2026-09-21 owner approval at a7a297ae](https://github.com/LeonEthan/molly-design/pull/52#issuecomment-5755930477)
Translation: stale

[English](session-validation-hotfix.md)

合法消息不应因无关旧历史的全状态校验而被拒绝。作为临时的可用性取舍，渲染端和 CLI
的会话 Mirror 跳过更新校验，其他文档校验和外部输入解析保持不变。这不保证 malformed
本地写入会被拒绝，不让旧消息自动变得可渲染，也不授权迁移历史。

此处接受只表示本地 CRDT 更新，不代表成功落盘、Agent 执行或远端送达。
writer 替换仍需单独审查（#460）；通过局部输入校验恢复保护，不重新让旧历史阻断发送。
未更新的客户端仍保持旧行为。

证据：`packages/shared/tests/session-validation-hotfix.test.ts` 和
`mirror-construction-sites.test.ts`。不声称已完成发布端验收。
本文件为待人工审查的草稿，测试不构成批准。

当前实现说明（2026-09-17）：[上游采纳任务](lody-upstream-adoption.zh.md)已将历史写入迁入
逐字段校验的共享 writer；会话 Mirror 只保留控制面。以上临时措施作为迁移背景保留，
不再描述新历史写入的保护边界。发布端与真实接入验收仍未由此声明完成。
