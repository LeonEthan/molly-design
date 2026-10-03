# 新设计首次提交后自动隐藏主导航

Status: implemented
Translation: pending

## 摘要

新设计从首页进入画布时仍显示导航、对话和画布三栏，与使用者期望的首次创作布局不同。此前已合入的展开按钮只在点击时隐藏主导航，并保留对话；这次使用者明确授权新增首次提交后的自动行为。首条消息被接受并导航到目标活动画布后，复用现有专注状态一次性隐藏主导航，后续消息和普通历史访问保持原布局。该行为不改变保存的导航偏好；真实组件回归、隔离原生应用验证与全仓检查已通过，现有使用者应用已正常重启。

## 历史与本次决定

[设计师界面升级记录](../../proposed/feature/2026-10-02-designer-ui-upgrade.md#follow-up-focus-keeps-the-conversation-2026-10-02)保留此前选择按钮触发的决定。对应提交 `8fc8afcf` 经 PR #69 合入：画布展开按钮隐藏左导航，保留对话与画布。本次新增首页首次设计自动触发，部分扩展该旧决定；旧记录不重写为当时已授权自动行为。

本次范围是首页创建新设计的首条消息被接受后的导航交接。目标画布活动时消费一次请求，并进入现有专注状态；提交失败保持布局，继续发消息和普通历史访问不产生请求。显式显示主导航取消专注，画布失活恢复保存的导航偏好。保留现有工具栏的手动切换入口。

## 复用与职责

- [布局状态](../../../../packages/components/src/atoms/layout-state.ts)已有 `designCanvasFocusAtom` 与有效导航隐藏状态，能够保留对话和保存的折叠偏好，因此直接复用。
- [首次提交导航交接](../../../../packages/components/src/components/chat/submission/use-composer-navigation-focus.ts)已有一次性 history-state 请求模式：以目标会话及当前历史入口核对归属，消费后移除请求，避免重新挂载或历史回访重放。首次设计导航沿用这一模式，画布只消费属于活动目标的请求。
- [首页提交](../../../../packages/components/src/components/chat/chat-landing.tsx)在首条消息被接受后发起导航；[设计画布](../../../../packages/components/src/components/sessions/design-canvas.tsx)和既有显示导航动作继续承担专注退出。接受失败不提前改变布局。

已有模块及模式已满足这次需求，无须新持久化、设置或协议。将默认导航偏好写成折叠会影响以后访问，并失去退出画布时恢复原布局的语义；根据所有设计会话或每次发送自动进入专注会重复覆盖使用者显式显示导航的选择。仅靠旧按钮行为不满足本次已确认的首次创作要求。

两份[设计 Spec](../../../../specs/graphic-design-platform.zh.md)同步此新意图并保持 `draft`、`Translation: current`；本次任务授权不作为整份 Spec 的可链接修订批准记录。

## 验证与限制

- [新增回归](../../../../packages/components/tests/design-canvas-navigation-focus.test.tsx)挂载真实 `DesignCanvas`、`WebWorkspaceLayout` 与 Jotai store，9 项先失败后通过；既有相关 36 项通过。覆盖一次性目标交接及原导航偏好的保留和恢复。
- 组件类型检查、完整 `pnpm build`、全仓 `pnpm check` 与 `pnpm format` 通过；组件 3,258 项通过，CLI 和 RPC 包各保留既有 3 项跳过。文档检查通过，无注册 SHA 保护主题。
- 隔离原生 Electron 复用现有 [E2E harness](../../../../e2e/src/support/electron-harness.ts)与本地合成模型，验证新设计首条消息被接受后隐藏主导航，同时对话及画布可见；手动恢复导航后继续发消息保持导航；对话头的恢复入口有效；普通重开及刷新不重放自动专注。
- 首轮原生探针误以 `Message` 定位输入框而失败。修正探针为产品 placeholder 后，新的独立轮次通过；没有为此修改产品代码，也不将失败轮次计为通过。
- Codex CLI（`gpt-6-astra`、high、只读）未发现具体 P0/P1 问题，确认独立的输入框与画布请求保持彼此状态，历史入口更新不会触发画布失活清理；其意见限于静态审阅，不替代原生验证。
- 已用完整构建后的 `preview:local` 正常重启使用者应用，原生可访问状态确认 Molly 窗口、新设计入口与输入框已就绪。

本次只调整布局交接，不改变作品创建、消息接受、Agent 生命周期或画布编辑/只读边界。原生画布实际绘图质量不在本轮验证范围；人工视觉与交互体验仍由使用者判断。
