# language: zh-CN

功能: 内置浏览器的私网边界

  @lody @P1 @essence @runtime-simulator @LODY-BROWSER-002
  场景: 本机地址在没有权限提示时仍被浏览器拦截
    假如 已配置确定性 Agent 的隔离桌面
    当 Agent 请求浏览本机地址
    那么 浏览工具拒绝本机地址且没有暴露页面
