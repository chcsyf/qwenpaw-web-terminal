# 🖥️ Web 终端 (qwenpaw-web-terminal) v0.0.1

浏览器终端窗口插件，由第三方扫雷插件（minesweeper-game）的 app 插件骨架改造而来。采用 [Apache License 2.0](LICENSE) 许可协议发布。

## 功能（v0.0.1）

- **多标签**：每个标签一个独立交互式终端（独立 xterm + 独立 WS + 独立 bash PTY）；
  切换标签不中断终端，点击标签上的 × 关闭标签即结束该终端（后端 killpg 回收进程）
- **惰性连接**：进入终端页/初始标签**不自动连接**——不会默认创建 default bash 进程；
  连接由用户交互触发（点击标签、新建标签、切「交互式终端」模式、点「重连」、或在终端内输入字符）。
  未连接时终端内显示灰色提示行，连接成功自动清除；输入触发连接时首字符不丢
- **xterm.js 渲染**：自托管 `ui/vendor/`（xterm.js 4.19 + fit addon），真正的终端渲染——
  ANSI 颜色/光标、`ls --color`、vim/top 不再乱码；支持 Tab 补全、Ctrl+C、复制/粘贴
- **交互式终端**：`WS /api/qwenpaw-web-terminal/ws`，Python `pty` + bash，支持 vim/top 等需要 TTY 的程序
- **单条命令**：`POST /api/qwenpaw-web-terminal/exec`，`sh -c` 执行，支持 `cd` 会话持久
- **多会话**：`GET/POST/DELETE /api/qwenpaw-web-terminal/sessions`，exec 与 PTY 按 `session_id` 隔离 cwd；
  前端每个标签即一个会话，可新建/关闭
- **实时 cwd**：PTY 内 `cd` 后，通过 OSC 7（`\x1b]7;file://host/path\x07`）自动上报，
  顶部目录徽标实时更新
- **窗口自适应**：监听浏览器 resize，自动 `fit` 并同步 PTY 窗口大小；
  根容器跟随 QwenPaw console 宿主面板高度（`height:100% + minHeight:0`），无页面级滚动条
- **自动重连**：WS 断开后 1.5s×N 自动重连（最多 5 次），可手动「重连」
- **心跳**：WS 支持 `\x00ping` -> `\x00pong`

![qwenpaw-web-terminal-0.0.1](qwenpaw-web-terminal-0.0.1.png)

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/qwenpaw-web-terminal/status` | 插件状态、版本、cwd（支持 `?session_id=` 指定会话） |
| GET  | `/api/qwenpaw-web-terminal/sessions` | 会话列表（id + cwd） |
| POST | `/api/qwenpaw-web-terminal/sessions` | 创建会话 `{id, cwd?}` |
| DELETE | `/api/qwenpaw-web-terminal/sessions/{sid}` | 删除会话（并兜底结束该会话活跃 PTY） |
| POST | `/api/qwenpaw-web-terminal/exec` | `{cmd, session_id?, timeout?}` → `{ok, stdout, stderr, exit_code, cwd}` |
| WS   | `/api/qwenpaw-web-terminal/ws?session=default` | 交互式 PTY；文本帧即输入，`\x00resize:cols:rows` 调整窗口，`\x00ping` 心跳 |

> 注意：插件 HTTP 路由挂在 `/api` + prefix（registry 源码 `full_prefix = f"/api{normalized}"`），
> 不是 `/api/plugins/...`（那是插件管理路由，安装/卸载用）。
> 前端 vendor 资源经 `/api/plugins/qwenpaw-web-terminal/files/ui/vendor/*` 公开加载。

## 前端资源

```
ui/
├── index.js           # 前端入口（xterm.js 渲染 + 多标签 + 惰性连接 + 自动重连）
└── vendor/
    ├── xterm.js       # xterm.js 4.19.0 (MIT)
    ├── xterm.css
    └── xterm-addon-fit.js
```

## 安装 / 升级

```bash
qwenpaw plugin validate ./qwenpaw-web-terminal
qwenpaw plugin uninstall qwenpaw-web-terminal   # 已有旧版时先卸载
qwenpaw plugin install ./qwenpaw-web-terminal
```

刷新 QwenPaw 页面，「设置」菜单或应用中心可见「🖥️ 终端」。

## 目录结构

```
qwenpaw-web-terminal/
├── plugin.json   # 清单：type=app, entry backend+frontend, menu, meta.pawapp
├── plugin.py     # 后端：status / sessions / exec / WebSocket PTY
├── ui/index.js   # 前端：xterm.js 终端组件
└── ui/vendor/    # 自托管 xterm.js
```

## 变更记录



## 安全警告

- exec 与 PTY 均以 **QwenPaw 进程身份执行宿主机 shell 命令**，属于高危能力。
- 仅建议在本地 / 可信内网使用；不要部署到公网平台，不要在生产环境开启。
- 无独立鉴权，控制台可见即可用。

## 已知限制

- 单条命令模式为「一次性执行」语义（`sh -c`），`cd` 由后端维护会话级 cwd；
  复合命令 `cd x && pwd` 在同一次调用内有效但不会持久化（单独 `cd x` 才会）。
- 每个标签每次连接启动全新 bash（不保留会话内环境变量/命令历史，cwd 从会话读取）；
  标签切换不中断，关闭标签才结束对应 bash。
- 前端 vendor 走 `/api/plugins/{id}/files/...` 公开路由，无独立鉴权。
