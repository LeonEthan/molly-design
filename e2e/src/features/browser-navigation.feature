# language: zh-CN

功能: 内置浏览器的本机页面导航

  @lody @P1 @essence @runtime-simulator @LODY-BROWSER-002
  场景: Agent 无需权限提示即可浏览本机合成页面
    假如 已配置确定性 Agent 的隔离桌面
    当 Agent 请求浏览本机合成页面
    那么 浏览工具返回本机页面与快照且没有权限提示
