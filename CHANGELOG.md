# 变更记录 (Changelog)

## v0.0.1 - 2026-08-05（首个发布版）

- 多标签：每个标签独立交互式终端（独立 xterm + WS + bash PTY），关闭标签即结束终端
- 惰性连接：进入终端页不自动创建 bash 进程，由用户交互触发连接；未连接提示行；输入触发连接首字符不丢
- xterm.js 渲染（ANSI/光标/Tab 补全/复制粘贴），交互式 PTY 支持 vim/top
- 单条命令 exec（sh -c，cd 会话持久）、多会话（sessions 增删查）
- OSC 7 实时上报 cwd；窗口自适应跟随 QwenPaw 宿主面板，无页面级滚动条
- WS 自动重连（最多 5 次）+ 心跳；关闭标签后端 killpg 兜底回收进程
- 采用 Apache License 2.0 发布
