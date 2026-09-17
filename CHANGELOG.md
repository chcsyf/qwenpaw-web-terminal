# 变更记录 (Changelog)

## v0.2.6 - 2026-09-17

- **修复：`/exec` 端点阻塞事件循环（与 v0.2.5 同源，但入口不同）**
  - 根因：`exec_cmd()` 是 `async def`，却直接在事件循环线程执行
    `subprocess.run(cmd, shell=True, timeout=min(max(req.timeout,1),300))`，
    单条命令最长可冻结整个 QwenPaw 服务 **300 秒**（所有 agent / 通道 / HTTP 一起停摆）。
  - 修复：改为 `await asyncio.to_thread(subprocess.run, ...)`，阻塞转移到线程池。
  - 备注：v0.2.5 修的是 PTY I/O 路径（`_pty_loop` 的 `os.read` / `_pty_write` 的 `os.write`），
    本次是该插件第二处同源阻塞入口。

## v0.2.5 - 2026-09-17

- **修复「PTY I/O 阻塞 asyncio 事件循环」（破坏性 bug）**：
  - **现象**：主服务整体无响应——所有 HTTP 请求挂起 30s 被浏览器取消、SSE 永久 pending、
    `Failed to load agents`，实测连续约 **40s**；卸载插件后消失（栈顶 `plugin.py:_pty_loop` 的
    `os.read`，syscall 证据 `read` on `/dev/pts/ptmx`，其余线程 futex 等锁）。
  - **根因（两层叠加）**：
    1. `pty.openpty()` 返回的 `master_fd` 是**阻塞模式**（全文无 `os.set_blocking`/`O_NONBLOCK`）；
    2. `os.read`（读循环）与 `os.write`（WS / SSE 输入通道，两处）**直接在事件循环线程执行**。
       一旦「无数据 / PTY 输入缓冲满」，内核调用真阻塞 → 整个事件循环停摆。
  - **修复**：
    * `_spawn_pty()`：`os.set_blocking(master_fd, False)` —— 从根上让 PTY I/O 不再阻塞。
    * 读循环单独捕获 `BlockingIOError`(EAGAIN) → `continue`。
      ⚠️ 必须放在 `except OSError` **之前**：`BlockingIOError` 是 `OSError` 子类，
      旧代码的 `except OSError: break` 会在置非阻塞后把 EAGAIN 当致命错误，**直接把读循环打死**。
    * 写路径改用 `_pty_write()`：非阻塞 + 让出事件循环重试（EAGAIN 时不丢键、不阻塞事件循环）。
  - **加固**：新增事件循环延迟自检 `_lag_watchdog()`（lag > 200ms 打 WARNING，作为回归哨兵）；
    `_cleanup_pty()` 的 `proc.wait` 超时 1s → 0.2s，降低最坏情况阻塞。
- **版本号统一为 0.2.5**（plugin.py / plugin.json / index.js / README）

## v0.2.4 - 2026-09-11

- **修复「开启登录认证后公网访问不可用（两处 401）」**：
  - 所有 API 请求统一经 `apiFetch()` 注入 `Authorization: Bearer <localStorage['qwenpaw_auth_token']>`
    （原仅部分请求带 `X-Agent-Id`，认证开启后 `GET /sessions`、`DELETE`、`/status`、`/ai/models`、
    `/api/approval/*` 等均 401）
  - WS / SSE(`EventSource`) 无法自定义请求头 → 连接 URL 追加 `&token=`（AuthMiddleware 支持 query token）
  - vendor 静态资源（xterm.js 等）改走**免登录公开路径** `/api/frontend_plugin/{id}/files/ui/vendor/`，
    不再走 `/api/plugins/{id}/files/`：后者需认证且 `<script>` 无法带 Header → 公网下 401，
    `window.Terminal` 加载失败导致「显示已连接但终端区域空白」
- **性能修复（影响整个主服务，不止本插件）**：
  - PTY 读循环原用同步 `select.select(..., 0.1)`，空转时每会话每轮阻塞 asyncio 事件循环最多
    100ms（实测主服务响应出现 ~101ms 延迟尖峰）→ 改 `loop.add_reader()` 事件驱动
  - 历史缓冲原 `(buf + data)[-_BUF_MAX:]` 在缓冲接近 4MB 时每次追加都整块复制（O(n²)），
    高频输出下 CPU 飙升 → 改 `bytearray` 原地追加 + 超限按需裁剪
  - SSE 下行原 80ms 轮询会话缓冲 → 改事件驱动（新输出即时推送，keepalive 注释帧保活）
- **传输健壮性**：
  - SSE 上行输入合并 + 串行发送（逐键 POST → ~15ms 批量、同一时刻仅一个请求在飞，保证 FIFO 顺序）
  - WS 首次握手失败先重试 3 次再降级 SSE（避免瞬时抖动/服务重启导致永久降级）
  - SSE 连接异常时给出明确提示（原为静默）
- **版本号统一为 0.2.4**（plugin.py / plugin.json / index.js / README）

## v0.2.3 - 2026-08-25

- **SSE 降级传输通道（方案 A）**：平台网关丢失 WebSocket `Upgrade`/`Connection` 头导致
  WS 握手被当普通 GET 返回 404 时，前端 WS 首次握手失败自动降级为 SSE，控制台仍可交互——
  - 后端新增 `GET /api/qwenpaw-web-terminal/stream?session=x`（SSE 输出流，`data:` 行为
    base64(UTF-8)，`:` 注释行 ping 保活，基于会话缓冲偏移量轮询，零侵入 PTY 循环）
  - 后端新增 `POST /api/qwenpaw-web-terminal/input`（SSE 模式统一输入通道 `{session_id, data}`，
    data 兼容 WS 控制协议 `\x00resize:c:r` / `\x00ping`）
  - 前端新增 `openSseFor` / `closeTransportFor` / `sendInput` 统一入口，WS 与 SSE 共用
- **修复 AI 命令卡片在 SSE 降级下失效**：`ptySend`（「插入脚本/运行/清空/中断」四按钮回调）
  原只写 WS 通道，SSE 降级时命令被丢弃无回显；现复用 `sendInput` 的 SSE/WS 分派，SSE 已建立时
  走 `POST /input` 命中下一轮数据流
- **版本号统一为 0.2.3**（plugin.py / plugin.json / index.js / README）

## v0.2.2 - 2026-08-15

- **AI 面板模型下拉只显示可用大模型**：`GET /ai/models` 过滤未配置 API key 的 provider
  （github-models/modelscope/dashscope/openai/anthropic/gemini 等官方预置但未配 key 的
  不再出现），仅保留已配置 key / 本地 / 免 key / OAuth 已连接的 provider
- **命令卡片按钮 UI 优化**：
  - 按钮区保持单行四按钮，按钮内部改为「图标 + 文字」横排：图标 15px、文字 9px，
    文字过长自动换行，按钮整体更紧凑
  - 「✍ 写入终端（不执行）」按钮文案改为 **「✍ 插入脚本」**（行为不变：填入终端
    输入行不回车，确认后回车执行），toast/面板说明同步更新
- 前端 VERSION 常量同步至 0.2.2（修复 v0.2.1 发布时未同步的滞后）
- 版本号统一为 0.2.2（plugin.py / plugin.json / README）

## v0.2.1 - 2026-08-14

- **命令卡片对齐官方代码块视觉语言（#6911）**：
  - 卡片头部新增 **📋 复制** 按钮，一键复制命令全文（剪贴板不可用时退回 prompt），
    与官方代码块的复制动作对齐
  - 语言标签改为徽章样式（`bash`/`shell` 等围栏语言名，带背景色与圆角）
  - 命令文本 **bash 语法高亮**：行首 `#` 注释、引号字符串、`${var}`/`$var` 变量、
    `-x`/`--xxx` 选项、内置命令关键字（echo/cd/ls/git/pip 等 80+）与命令首词分色渲染，
    主题化配色与官方代码块一致
- **OS Shell 窗口化声明**：`launch_scope` 由 `page` 改为 `window`——2.1.0 OS 桌面中作为
  可移动/可调整大小窗口打开；2.0.1 不识别 `window` 值时自动回退 page 内嵌（功能不受影响，
  渐进增强，无需改动其他代码）
- 版本号统一为 0.2.1（plugin.py / plugin.json / README）

## v0.2.0 - 2026-08-12

- **AI 助手面板**：工具栏「🤖 AI 助手」展开右下角可折叠对话面板
  - 发送消息自动附带**当前终端会话内容**（去 ANSI 的最近 400 行/12KB 输出）与当前目录，
    复用 QwenPaw agent 管线（`workspace.stream_query`）：同一 `session_id` 延续会话历史，
    支持工具调用/记忆/技能，与主聊天能力一致
  - SSE 流式渲染（`object: content` 增量事件），**思考过程**以灰色「🤔 思考过程」
    区块单独展示；发送/停止同一按钮切换（空闲「发送」，生成中「停止」红色）
  - **命令卡片**：AI 回复中的 ` ```bash ` 代码块渲染为命令卡片，提供四个动作
    （全部经终端通道，非后端静默执行）：
    - ✍ **写入终端（不执行）**：PTY 模式经 WS 发送 Ctrl+U 清行 + 命令文本（不回车），
      用户确认后按回车执行；exec 模式写入输入缓冲
    - ▶ **运行**：清空输入行 + 写入命令 + 回车，在终端内执行（可见回显/输出，可中断）
    - 🗑 **清空输入**：向终端发送 Ctrl+U，删除已插入的命令
    - ⏹ **中断**：向终端发送 Ctrl+C（面板头部也有全局「⏹ 中断」按钮），中断正在执行的命令
  - **模型选择**：面板顶部下拉可选可用大模型（`GET /ai/models`），选择持久化，
    通过 `model_slot_override` 按请求切换
  - **审批处理**：AI 需要权限审批时（tool_guard ASK 模式挂起）面板内轮询
    `/api/approval/list` 弹「⚠️ 需要审批」卡片，可一键允许/拒绝（`/approve` `/deny`）
  - **上下文持久化 + 清空**：会话 ID 存 localStorage，刷新后继续同一对话；
    「🗑 清空」重置会话
  - 后端新增 `POST /ai/chat`（SSE）与 `GET /ai/models`，从主服务
    `MultiAgentManager` 获取 workspace，非 QwenPaw 环境返回 503 明确提示
- 版本号统一为 0.2.0（plugin.py / ui/index.js / plugin.json / README）
- 预览图更新为 `qwenpaw-web-terminal.png`，README 图片引用改为 GitHub 绝对链接
  （raw.githubusercontent.com），不再使用相对路径
- **修复命令卡片闭包 bug**：AI 回复含多个 ```bash 代码块时，`renderAiMessage` 的
  `while` 循环里 `cmdText`/`mkClick` 都是 `var`（函数作用域），所有卡片 `onClick` 闭包
  引用同一变量，点击任何「写入终端/运行」都会执行**最后一条**命令。终版改为每个按钮
  `onClick` 直接以 IIFE 捕获「当前 cmdText + action」，彻底消除共享变量（经 Node 实测
  修复前后行为，确认多代码块各自独立）。

## v0.1.4 - 2026-08-07（Bugfix：结束所有后台会话 = 结束并删除）

- **「结束所有后台会话」改为结束并删除**：此前只 kill 进程、会话保留在管理面板
  （需手动逐个删除）；现改为对所有「不在前台标签栏且正在运行」的会话直接 DELETE
  （结束进程 + 删除会话），按钮文案同步改为「结束并删除所有后台会话」

## v0.1.3 - 2026-08-07（Bugfix：刷新后历史完整回放）

- **刷新后历史不再缺失**：此前 attach 回放后会清空缓冲，刷新后只能回放
  「上次连接以来」的增量，更早历史丢失；现改为保留全量历史缓冲，每次连接
  都回放完整内容（前端 onopen 已清屏，全量回放不会重复）
- **历史缓冲上限 256KB → 4MB**（保留尾部）：长输出命令（如 `seq 1 80000`、
  构建日志）刷新后不再只显示尾部，头部历史也完整保留
- **前端滚动缓冲 5000 → 50000 行**：回放内容超过 5000 行时仍可上滚查看

## v0.1.2 - 2026-08-07（按功能规格对齐）

- **默认标签与智能体同名**：进入终端页自动创建一个与当前智能体
  同名的默认标签，惰性连接（仅输入/点重连触发，不自动创建 bash 进程）；
  若该默认会话已在后台运行（刷新/断网后）则改为打开（attach 原进程，不重复创建）
- **刷新后只保留默认标签**：除自动创建的默认标签外，其他会话
  全部留在后台（进程保留、缓冲回放），不再从 localStorage 恢复标签列表
- **管理面板「打开所有会话」**：一键把所有不在标签栏的会话转入
  前台（attach 后台进程）；状态徽标按文档对齐为 前台运行 / 前台空闲 / 后台运行 / 空闲
- **心跳保活 + 死连接清理**：前端每 20s 发 `\x00ping`，
  后端守护任务清理超过 60s 无消息的「已连接」死连接（标签冻结/断网/TCP 悬挂），
  管理面板不再残留「已连接」幽灵会话；正常空闲终端由心跳保活，不会被误杀
- **全量输出历史回放**：缓冲从「仅断开后输出」改为「始终记录 PTY 输出」
  （上限 256KB），attach 时回放完整历史——刷新/重连后终端恢复断点前内容
  （命令回显、输出、prompt），不再空白；断开期间的新输出也一并回放
- 所有会话断开均后台保留（含 default），与会话持久化一致

## v0.1.1 - 2026-08-06（Bugfix：会话一致性）

- **同名新建 → 直接打开**：新标签/管理面板新建会话时，若名称已存在则打开现有会话
  （不重置 cwd、不重复创建）；后端 `POST /sessions` 幂等化（已存在时返回现有状态）
- **「结束所有后台会话」修复**：改为结束所有**不在前台标签栏**且正在运行的会话
  （含后台运行与悬空连接），此前只杀 detached 导致按钮经常无效
- **初始化不再自动创建会话**：只恢复 localStorage 里上次打开的标签；首次进入只建
  default 兜底标签（惰性不连接）。不再因当前智能体选择而自动创建同名会话标签，
  防止 default/agent 同名终端反复出现、持续运行
- 管理面板会话 id 前加 📌 标记「前台已打开」的会话，便于区分

## v0.1.0 - 2026-08-06（会话持久化 + 会话管理）

- **会话持久化**：WS 意外断开（刷新/断网）不再 kill PTY 进程，终端转入后台保留，
  输出写入 64KB 环形缓冲；重新连接同会话自动 attach 原进程并回放缓冲。
  正常关闭标签（×）仍由前端显式 DELETE 结束进程，保持直觉。
- **会话管理面板**：标签栏新增「🗂 会话管理」按钮，弹出管理面板：
  列出所有会话（状态：运行中·已连接 / 后台运行 / 空闲、PID、缓冲大小、最后活动），
  支持打开（attach 后台进程）、结束进程（保留会话）、删除会话、结束所有后台会话、新建会话。
- **标签布局持久化**：打开的标签列表存 localStorage，刷新后恢复；后端会话全量
  收敛到管理面板，标签栏不再无限堆积。
- 新增接口 `POST /sessions/{sid}/kill`（结束进程、保留会话）；`GET /sessions` 增强
  返回 PTY 运行状态；主服务退出时 shutdown hook 清理所有遗留 PTY，避免孤儿进程。
- 版本 v0.0.1 → v0.1.0

## v0.0.1 - 2026-08-05（首个发布版）

- 多标签：每个标签独立交互式终端（独立 xterm + WS + bash PTY），关闭标签即结束终端
- 惰性连接：进入终端页不自动创建 bash 进程，由用户交互触发连接；未连接提示行；输入触发连接首字符不丢
- xterm.js 渲染（ANSI/光标/Tab 补全/复制粘贴），交互式 PTY 支持 vim/top
- 单条命令 exec（sh -c，cd 会话持久）、多会话（sessions 增删查）
- OSC 7 实时上报 cwd；窗口自适应跟随 QwenPaw 宿主面板，无页面级滚动条
- WS 自动重连（最多 5 次）+ 心跳；关闭标签后端 killpg 兜底回收进程
- 采用 Apache License 2.0 发布
