"""
Web 终端插件 v0.2.5 - QwenPaw
浏览器终端窗口：
  - GET    /api/qwenpaw-web-terminal/status            插件状态、版本、cwd（支持 ?session_id=）
  - GET    /api/qwenpaw-web-terminal/sessions          会话列表（含 PTY 运行状态，供管理面板）
  - POST   /api/qwenpaw-web-terminal/sessions          创建会话 {id, cwd?}
  - POST   /api/qwenpaw-web-terminal/sessions/{sid}/kill  结束该会话的 PTY 进程（保留会话状态）
  - DELETE /api/qwenpaw-web-terminal/sessions/{sid}    删除会话（并强制结束该会话活跃 PTY）
  - POST   /api/qwenpaw-web-terminal/exec              单条命令执行（sh -c，cd 会话持久）
  - WS     /api/qwenpaw-web-terminal/ws?session=x      交互式 PTY（bash，OSC 7 上报 cwd）
  - GET    /api/qwenpaw-web-terminal/stream?session=x  SSE 输出流（WS 被网关剥升级头时的降级通道；
                                                       data 行为 base64(UTF-8)，注释行 : ping 保活）
  - POST   /api/qwenpaw-web-terminal/input             SSE 模式输入通道 {session_id, data}
                                                       （data 兼容 WS 控制协议：\x00resize:c:r / \x00ping）
  - POST   /api/qwenpaw-web-terminal/ai/chat           AI 助手对话（SSE 流式，自动附带当前终端内容）
  - GET    /api/qwenpaw-web-terminal/ai/models         可用模型列表（AI 面板下拉选择）

v0.2.5 修复（PTY I/O 阻塞 asyncio 事件循环 —— 破坏性）：
  - 根因：pty.openpty() 返回的 master_fd 默认【阻塞】，而 os.read/os.write 直接在
    事件循环线程执行；一旦「无数据 / PTY 输入缓冲满」就真阻塞，整个事件循环停摆
    （实测主服务所有 HTTP 悬挂 30s 被浏览器取消、SSE 永久 pending，约 40s 无响应）。
  - 修复（完整版方案 A）：
    * _spawn_pty() 把 master_fd 置为非阻塞 os.set_blocking(fd, False)
    * 读循环单独捕获 BlockingIOError(EAGAIN) → continue（旧代码的 except OSError 会把
      它当致命错误 break，反而直接打死读循环）
    * 写路径（WS 输入 / SSE /input）改 _pty_write()：非阻塞 + 让出事件循环重试，
      EAGAIN 时不丢键、不阻塞事件循环
  - 加固：事件循环延迟自检 _lag_watchdog()（lag > 200ms 打 WARNING，回归哨兵）；
    清理路径 proc.wait 超时 1s → 0.2s，降低最坏阻塞。
  - 版本号统一为 0.2.5（plugin.py / plugin.json / index.js / README）

v0.2.4 新增（性能 + 认证 + 传输健壮性）：
  - 修复 PTY 读循环用同步 select.select() 阻塞 asyncio 事件循环（实测主服务 ~101ms 延迟尖峰）
    → 改 loop.add_reader() 事件驱动（不支持时回退非阻塞轮询）
  - 修复历史缓冲 O(n²) 复制（(buf+data)[-4MB:] 每次整块复制）→ bytearray 原地追加 + 按需裁剪
  - SSE 下行改事件驱动（原为 80ms 轮询 buf）→ 新输出即时推送、keepalive 注释帧保活
  - 修复「开启登录认证后公网访问不可用（两处 401）」：
    * 所有 fetch 统一经 apiFetch() 注入 Authorization: Bearer <localStorage['qwenpaw_auth_token']>
    * WS / SSE(EventSource) 无法带请求头 → URL 追加 &token=（AuthMiddleware 支持 query token）
    * vendor 静态资源(xterm) 改走免登录公开路径 /api/frontend_plugin/{id}/files/...
      （原 /api/plugins/.../files/ 需认证，<script> 带不了头 → 终端渲染库加载失败、区域空白）
  - SSE 上行输入合并 + 串行发送（逐键 POST → ~15ms 批量，保证 FIFO 顺序，防请求风暴/乱序）
  - WS 首次握手失败先重试 WS_FALLBACK_RETRY 次再降级 SSE（避免瞬时抖动导致永久降级）
  - SSE 连接异常时给出明确提示（原为静默）
  - 版本号统一为 0.2.4（plugin.py / plugin.json / index.js / README）

v0.2.3 新增（SSE 降级传输）：
  - 部分平台网关反向代理不透传 WebSocket Upgrade 头 → 后端把握手当普通 GET 返回 404，
    前端表现为「一直重连」。新增纯 HTTP 的降级通道：GET /stream（SSE 下行）+ POST /input（上行）。
  - 前端 WS 握手首次失败自动切换 SSE 并记忆偏好（localStorage），本地/正常环境零影响仍走 WS。
  - SSE 与 WS 共用同一 PTY 会话与历史缓冲：会话持久化、全量回放、OSC7 cwd 上报语义不变。

v0.1.0 新增（会话持久化）：
  - WS 意外断开（刷新/断网）不再 kill PTY 进程，进程转入后台保留，输出写入历史缓冲；
    重新连接同会话自动 attach 并回放完整历史。正常关闭标签由前端显式 DELETE/kill 结束。
  - GET /sessions 返回每个会话的 PTY 状态（运行/已连接/后台运行/缓冲大小），
    配合前端「会话管理」面板进行打开、结束、删除、清理空闲。

安全提醒：exec 与 PTY 均以 QwenPaw 进程身份执行宿主机 shell 命令，
属于高危能力，仅建议在可信环境（本地/内网）使用。
"""
import asyncio
import base64
import fcntl
import json
import logging
import os
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

PLUGIN_VERSION = "0.2.5"

router = APIRouter()

# ============ 会话状态 ============
# 默认工作目录：QwenPaw 数据目录下的 default 工作区（若存在），否则进程 cwd
_DEFAULT_CWD = str(Path.home())
for _candidate in (
    Path(os.environ.get("QWENPAW_WORKING_DIR", "")),
    Path.home() / ".qwenpaw",
    Path.home() / ".copaw",
):
    _ws = _candidate / "workspaces" / "default"
    if _ws.is_dir():
        _DEFAULT_CWD = str(_ws)
        break

_sessions: dict = {}  # session_id -> {"cwd": str, "created_at": float}
# 会话持久化 PTY 存储：session_id -> PTY 记录
# 记录字段：
#   proc: Popen          交互式 bash 进程
#   master_fd: int       PTY master fd
#   ws / connected      当前活跃 WS（无连接时为 None/False = 后台运行中）
#   loop_task: Task     统一读取循环（connected 时输出到 WS，同时写入历史缓冲）
#   buf: bytes          会话完整输出历史（上限 _BUF_MAX 保留尾部，attach 时全量回放）
#   created_at / last_activity: float
_pty_store: dict = {}
# 会话输出历史缓冲上限 4MB（保留尾部）：无论连接与否都记录 PTY 输出，
# attach 时全量回放（不清空）→ 刷新/重连后前端清屏 + 回放完整历史
_BUF_MAX = 4 * 1024 * 1024
_exec_timeout = 60.0
# 心跳守护：前端每 20s 发 \x00ping，超时无消息视为死连接（标签冻结/断网/TCP 悬挂）
_HEARTBEAT_TIMEOUT = 60.0
_REAPER_INTERVAL = 20.0
_reaper_task: "asyncio.Task | None" = None
# 事件循环延迟自检（回归哨兵）：任何在事件循环线程上的阻塞调用（PTY I/O、DNS、
# 磁盘…）都会表现为 loop lag。超阈值打 WARNING，便于一装上就发现，而不是等页面卡死。
_lag_task: "asyncio.Task | None" = None
_LAG_WARN_SEC = 0.2
# 延迟自检的观测状态（经 /status 暴露）。
# 注意：插件自身的 logger 未接入主日志文件，仅靠 logger.warning 用户在日志里看不到，
# 必须提供可直接查询的出口，否则「回归哨兵」形同虚设。
_lag_state: dict = {"last_ms": 0.0, "max_ms": 0.0, "warns": 0, "samples": 0}
# SSE 降级通道：输出轮询间隔 / 网关保活注释帧间隔
_SSE_POLL = 0.08
_SSE_KEEPALIVE = 15.0


def _session_cwd(session_id: str = "default") -> str:
    info = _sessions.setdefault(
        session_id, {"cwd": _DEFAULT_CWD, "created_at": time.time()}
    )
    return info["cwd"]


def _set_session_cwd(session_id: str, cwd: str) -> None:
    info = _sessions.setdefault(
        session_id, {"cwd": _DEFAULT_CWD, "created_at": time.time()}
    )
    info["cwd"] = cwd
    info["last_activity"] = time.time()


def _agent_workspace(agent_id: str) -> str:
    """返回指定 agent 的工作区路径（<WORKING_DIR>/workspaces/<agent_id>），
    找不到时回退 _DEFAULT_CWD。"""
    if agent_id and agent_id != "default":
        base = os.environ.get("QWENPAW_WORKING_DIR", "") or _DEFAULT_CWD
        ws = Path(base) / "workspaces" / agent_id
        if ws.is_dir():
            return str(ws)
    return _DEFAULT_CWD


def _request_agent_cwd(request) -> str:
    """按请求的 X-Agent-Id 头解析"当前智能体"工作区，作为新会话默认 cwd。"""
    agent_id = (request.headers.get("x-agent-id") or "").strip() or "default"
    return _agent_workspace(agent_id)


class ExecRequest(BaseModel):
    cmd: str
    session_id: str = "default"
    timeout: float = _exec_timeout


class SessionRequest(BaseModel):
    id: str = "default"
    cwd: str = ""


# ============ 状态与会话管理 ============
@router.get("/status")
async def get_status(session_id: str = "default"):
    """获取插件状态；cwd 返回指定会话的（默认 default，兼容旧版调用）"""
    return {
        "ok": True,
        "name": "Web 终端",
        "version": PLUGIN_VERSION,
        "type": "pty",
        "cwd": _session_cwd(session_id),
        "supports": ["exec", "pty_websocket", "sessions", "persistent_pty"],
        # 事件循环延迟自检（回归哨兵）：
        #   loop_lag_ms     — 最近一次采样（正常应 < 20ms）
        #   loop_lag_max_ms — 进程内历史最大（若飙升到数百 ms/秒级，说明事件循环被阻塞）
        #   loop_lag_warns  — 超过 200ms 阈值的次数（应恒为 0）
        "loop_lag_ms": round(_lag_state["last_ms"], 1),
        "loop_lag_max_ms": round(_lag_state["max_ms"], 1),
        "loop_lag_warns": _lag_state["warns"],
        "loop_lag_samples": _lag_state["samples"],
    }


@router.get("/sessions")
async def list_sessions():
    """列出所有会话：id、cwd、PTY 运行状态（供管理面板展示与清理）。"""
    now = time.time()
    out = []
    for sid, info in sorted(_sessions.items()):
        entry = _pty_store.get(sid)
        running = bool(entry and entry.get("proc") is not None and entry["proc"].poll() is None)
        if running:
            created_at = entry.get("created_at", now)
            last_activity = entry.get("last_activity", now)
        else:
            created_at = info.get("created_at", now)
            last_activity = info.get("last_activity", now)
        out.append(
            {
                "id": sid,
                "cwd": info["cwd"],
                "created_at": created_at,
                "last_activity": last_activity,
                "pty": {
                    "running": running,
                    "pid": entry["proc"].pid if (running and entry) else 0,
                    "connected": bool(running and entry and entry.get("connected")),
                    "detached": bool(running and entry and not entry.get("connected")),
                    "buffered": len(entry.get("buf", b"")) if running else 0,
                },
            }
        )
    return {"ok": True, "sessions": out}


@router.post("/sessions")
async def create_session(req: SessionRequest, request: Request):
    """创建（或重置）一个会话，可指定初始 cwd；未指定时默认当前智能体工作区
    （依据 X-Agent-Id 请求头）。

    v0.1.1：幂等——同名会话已存在时直接返回现有状态，不重置 cwd、
    不重复创建（防止「新建同名终端」破坏正在使用的会话）。"""
    sid = (req.id or "default").strip()
    if not sid:
        return {"ok": False, "error": "会话 id 不能为空"}
    if sid in _sessions:
        return {"ok": True, "id": sid, "cwd": _sessions[sid]["cwd"], "existed": True}
    target = req.cwd.strip() or _request_agent_cwd(request)
    target = os.path.expanduser(target)
    if not os.path.isabs(target):
        target = str((Path(_DEFAULT_CWD) / target).resolve())
    if not Path(target).is_dir():
        return {"ok": False, "error": f"目录不存在: {target}"}
    _set_session_cwd(sid, target)
    return {"ok": True, "id": sid, "cwd": _session_cwd(sid), "existed": False}


@router.post("/sessions/{sid}/kill")
async def kill_session_pty(sid: str):
    """结束该会话的 PTY 进程（后台保留的终端）；会话状态保留，重连时重新拉起。
    进程已死/不存在时幂等返回。"""
    killed = _kill_pty(sid)
    return {"ok": True, "id": sid, "killed": killed, "existed": sid in _sessions}


@router.delete("/sessions/{sid}")
async def delete_session(sid: str):
    """删除会话状态；若该会话有活跃/后台 PTY，直接 killpg 强制结束进程组。"""
    existed = sid in _sessions
    _sessions.pop(sid, None)
    killed = _kill_pty(sid)
    return {"ok": True, "id": sid, "existed": existed, "killed_pty": killed}


# ============ 单条命令执行 ============
@router.post("/exec")
async def exec_cmd(req: ExecRequest, request: Request):
    """执行单条 shell 命令（非交互），支持 cd 持久化会话 cwd。"""
    cmd = (req.cmd or "").strip()
    if not cmd:
        return {"ok": False, "error": "命令为空"}
    session_id = req.session_id or "default"
    if session_id not in _sessions:
        # 新会话：默认落在当前智能体工作区（依据 X-Agent-Id 请求头）
        _set_session_cwd(session_id, _request_agent_cwd(request))
    cwd = _sessions[session_id]["cwd"]

    # 单独处理 cd（shell=True 下 cd 不会跨进程持久，这里自己维护会话 cwd）
    if cmd.startswith("cd ") or cmd == "cd":
        target = cmd[3:].strip() or "~"
        new_cwd = os.path.expanduser(target)
        if not os.path.isabs(new_cwd):
            new_cwd = str((Path(cwd) / new_cwd).resolve())
        if not Path(new_cwd).is_dir():
            return {
                "ok": False,
                "error": f"cd: 目录不存在: {new_cwd}",
                "cwd": cwd,
            }
        _set_session_cwd(session_id, new_cwd)
        return {"ok": True, "stdout": "", "stderr": "", "exit_code": 0, "cwd": new_cwd}

    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=min(max(req.timeout, 1.0), 300.0),
            executable="/bin/sh",
        )
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout or ""
        err = exc.stderr or ""
        if isinstance(out, bytes):
            out = out.decode("utf-8", errors="replace")
        if isinstance(err, bytes):
            err = err.decode("utf-8", errors="replace")
        return {
            "ok": False,
            "error": f"命令执行超时（>{req.timeout}s）",
            "stdout": out,
            "stderr": err,
            "cwd": cwd,
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("[qwenpaw-web-terminal] exec failed")
        return {"ok": False, "error": f"执行失败: {exc}", "cwd": cwd}

    # 更新会话活动时间
    _sessions[session_id]["last_activity"] = time.time()
    return {
        "ok": True,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "exit_code": proc.returncode,
        "cwd": cwd,
    }


# ============ AI 辅助对话（v0.2.0） ============

class AIChatRequest(BaseModel):
    """AI 对话请求体。

    text        用户消息正文
    session_id  终端会话 ID（自动附带该会话的当前内容/目录作为上下文）
    agent_id    目标 agent（可选，默认 default / X-Agent-Id）
    model       模型选择（可选，格式 "provider_id:model"，空 = 使用 agent 默认模型）
    """

    text: str
    session_id: str = ""
    agent_id: str = ""
    model: str = ""


# 终端缓冲 → AI 上下文：剥掉 ANSI 转义序列，保留最近若干行
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-_]")
_AI_CTX_MAX_LINES = 400
_AI_CTX_MAX_CHARS = 12000


def _terminal_context(session_id: str) -> str:
    """取会话终端的近期输出作为 AI 上下文（去 ANSI，倒序截取最近行）。"""
    entry = _pty_store.get(session_id)
    raw = ""
    if entry and entry.get("buf"):
        raw = entry["buf"].decode("utf-8", errors="replace")
    if not raw:
        return ""
    clean = _ANSI_RE.sub("", raw)
    lines = clean.splitlines()
    if len(lines) > _AI_CTX_MAX_LINES:
        lines = lines[-_AI_CTX_MAX_LINES:]
    text = "\n".join(lines)
    if len(text) > _AI_CTX_MAX_CHARS:
        text = text[-_AI_CTX_MAX_CHARS:]
    return text


def _build_ai_prompt(req: AIChatRequest) -> str:
    """把当前终端会话信息拼进用户提示词。"""
    parts = []
    cwd = _session_cwd(req.session_id or "default")
    parts.append(f"终端会话：{req.session_id or 'default'}")
    parts.append(f"当前目录：{cwd}")
    ctx = _terminal_context(req.session_id)
    if ctx:
        parts.append("终端当前内容（最近输出，仅供你读取参考，不要重复输出）：\n```\n" + ctx + "\n```")
    parts.append("---")
    parts.append(
        "你是 Web 终端里的 AI 助手。你可以：\n"
        "1. 读取上面的终端内容，分析输出、解释错误、给出建议；\n"
        "2. 给出要执行的命令时，把命令放在 ```bash 代码块 里（每行一条）；\n"
        "   前端会把代码块渲染成命令卡片，用户可「写入终端」（填入输入不执行，回车后执行）、\n"
        "   「运行」（写入并回车，在终端内执行）、「清空输入」（删除已插入的命令）、\n"
        "   「中断」（向终端发送 Ctrl+C）——执行始终发生在用户终端里，不是后端静默执行；\n"
        "3. 不要真的去执行命令，也不要调用工具执行，执行由用户在前端确认（或点「运行」经终端通道执行）。"
    )
    parts.append("---")
    parts.append(req.text.strip())
    return "\n".join(parts)


async def _get_workspace(request: Request, agent_id: str = "") -> object:
    """从主服务拿 agent workspace（与 QwenPaw 内部路由同一获取方式）。"""
    if not hasattr(request.app.state, "multi_agent_manager"):
        raise HTTPException(
            status_code=503,
            detail="MultiAgentManager 未初始化，AI 对话不可用",
        )
    manager = request.app.state.multi_agent_manager
    target = agent_id or request.headers.get("X-Agent-Id") or "default"
    try:
        workspace = await manager.get_agent(target)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=404, detail=f"Agent 不存在: {target}") from e
    except Exception as e:  # noqa: BLE001
        logger.error("[qwenpaw-web-terminal] get_agent(%s) failed: %s", target, e)
        raise HTTPException(status_code=500, detail=f"获取 Agent 失败: {e}") from e
    if workspace is None:
        raise HTTPException(status_code=404, detail=f"Agent 不存在: {target}")
    return workspace


def _serialize_event(ev: object) -> str:
    """把 stream_query 产出的 schema 对象序列化为 SSE data 行。"""
    try:
        if hasattr(ev, "model_dump"):
            payload = ev.model_dump()
        elif isinstance(ev, dict):
            payload = ev
        else:
            payload = {"object": "event", "data": str(ev)}
    except Exception as e:  # noqa: BLE001
        payload = {"object": "error", "error": f"序列化失败: {e}"}
    return "data: " + json.dumps(payload, ensure_ascii=False, default=str) + "\n\n"


@router.post("/ai/chat")
async def ai_chat(
    req: AIChatRequest,
    request: Request,
) -> StreamingResponse:
    """AI 辅助对话（SSE 流式）。

    复用 QwenPaw agent 管线（workspace.stream_query），同一 session_id 延续
    会话历史。自动附带当前终端会话的目录与近期输出作为上下文。
    事件为 QwenPaw 协议对象：
      {object: "response", status: "created"|"in_progress"|"completed"}
      {object: "message", role: "assistant", content: [{type:"text", text}]}
    """
    workspace = await _get_workspace(request, req.agent_id)
    session_id = req.session_id or ("qwt-ai-" + uuid.uuid4().hex)
    prompt = _build_ai_prompt(req)

    async def event_generator():
        try:
            stream_req = {
                "input": [
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": prompt}],
                    }
                ],
                "session_id": session_id,
                "user_id": "qwenpaw-web-terminal",
                "stream": True,
            }
            if req.model and ":" in req.model:
                stream_req["model_slot_override"] = req.model
            async for ev in workspace.stream_query(stream_req):
                yield _serialize_event(ev)
        except asyncio.CancelledError:
            logger.info("[qwenpaw-web-terminal] ai/chat cancelled (session=%s)", session_id)
            raise
        except Exception as e:  # noqa: BLE001
            logger.error(
                "[qwenpaw-web-terminal] ai/chat error (session=%s): %s",
                session_id,
                e,
                exc_info=True,
            )
            yield "data: " + json.dumps(
                {"object": "error", "error": str(e)}, ensure_ascii=False
            ) + "\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _provider_usable(info) -> bool:
    """判断 provider 是否可用（已配 key 或本地/免 key 类型）。

    未提供 API key 且需要 key 的 provider（如官方预置但未配置的
    github-models/modelscope/dashscope 等）不可用，其模型不进入下拉列表。
    """
    if getattr(info, "is_local", False):
        return True
    if getattr(info, "oauth_connected", False):
        return True
    if not getattr(info, "require_api_key", True):
        return True
    return bool(getattr(info, "api_key", "") or "")


@router.get("/ai/models")
async def ai_models(request: Request) -> dict:
    """可用模型列表（供前端下拉选择，仅含已配置 key 或本地/免 key provider）。"""
    try:
        manager = getattr(request.app.state, "provider_manager", None)
        if manager is None:
            return {"ok": True, "models": [], "active": ""}
        infos = await manager.list_provider_info()
    except Exception as e:  # noqa: BLE001
        logger.error("[qwenpaw-web-terminal] ai/models failed: %s", e)
        return {"ok": True, "models": [], "active": ""}

    models = []
    for info in infos or []:
        if not _provider_usable(info):
            continue
        pid = getattr(info, "id", "") or ""
        pname = getattr(info, "name", "") or pid
        if not pid:
            continue
        all_models = list(getattr(info, "models", None) or []) + list(
            getattr(info, "extra_models", None) or []
        )
        seen = set()
        for m in all_models:
            mid = getattr(m, "id", "") or ""
            if not mid or mid in seen:
                continue
            seen.add(mid)
            mname = getattr(m, "name", "") or mid
            models.append({
                "value": f"{pid}:{mid}",
                "label": f"{pname} / {mname}",
                "provider": pname,
                "model": mname,
                "is_free": bool(getattr(m, "is_free", False)),
            })
    return {"ok": True, "models": models, "active": ""}


# ============ 交互式 PTY（WebSocket + 会话持久化） ============
def _notify_sse(entry) -> None:
    """唤醒所有挂起的 SSE 下行流（有新输出到达）。事件驱动，替代 80ms 轮询。"""
    for ev in tuple(entry.get("sse_events") or ()):
        try:
            ev.set()
        except Exception:  # noqa: BLE001
            pass


def _append_buf(entry, data: bytes) -> None:
    """写入会话历史缓冲（保留尾部 _BUF_MAX 字节，作为全量历史滚动窗口）。

    用 bytearray 原地追加 + 超限时按需裁剪，避免旧实现
    `(buf + data)[-_BUF_MAX:]` 在缓冲接近上限时每次都整块复制（输出越大越慢，
    高频输出下 CPU 飙升）。同时唤醒 SSE 下行通道。
    """
    buf = entry.get("buf")
    if not isinstance(buf, bytearray):
        buf = bytearray(buf or b"")
        entry["buf"] = buf
    buf += data
    over = len(buf) - _BUF_MAX
    if over > 0:
        del buf[:over]
    _notify_sse(entry)


async def _pty_write(entry, data: bytes) -> bool:
    """把前端输入写入 PTY（master_fd 已置非阻塞）。

    - 非阻塞写 + 让出事件循环重试：PTY 输入缓冲满时 os.write 抛 EAGAIN，
      绝不能阻塞事件循环；也不能丢弃（丢键），所以 sleep 后重试直到写完。
    - 返回 False 表示 fd 已失效（会话结束 / 被清理）。
    """
    view = memoryview(data)
    while len(view):
        fd = entry.get("master_fd")
        if fd is None:
            return False
        try:
            n = os.write(fd, view)
        except BlockingIOError:
            # EAGAIN：内核 PTY 输入缓冲已满，稍后重试（不丢输入、不阻塞事件循环）
            await asyncio.sleep(0.005)
            continue
        except (OSError, ValueError):
            return False
        view = view[n:]
    return True


def _spawn_pty(session_id: str, cwd: str):
    """创建交互式 bash PTY 子进程并登记到 _pty_store，返回记录。

    通过 PROMPT_COMMAND 在每次提示符前输出 OSC 7（file://host/path）
    上报当前工作目录，前端解析后更新 cwd 显示。
    """
    master_fd, slave_fd = pty.openpty()
    env = dict(os.environ)
    env.setdefault("TERM", "xterm-256color")
    env.setdefault("COLORTERM", "truecolor")
    env["PROMPT_COMMAND"] = 'printf "\\033]7;file://%s%s\\007" "$HOSTNAME" "$PWD"'
    proc = subprocess.Popen(
        ["/bin/bash", "-i"],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=cwd,
        env=env,
        preexec_fn=os.setsid,  # 独立进程组，便于整体 kill
        close_fds=True,
    )
    os.close(slave_fd)
    # 关键：master_fd 默认是【阻塞】模式。若不置为非阻塞，事件循环线程上的
    # os.read/os.write 一旦遇到「无数据 / PTY 输入缓冲满」就会真阻塞，
    # 导致整个 asyncio 事件循环停摆（实测主服务无响应约 40 秒，HTTP/SSE 全部悬挂）。
    try:
        os.set_blocking(master_fd, False)
    except (OSError, AttributeError):  # noqa: BLE001
        logger.warning(
            "[qwenpaw-web-terminal] os.set_blocking(master_fd, False) 失败，"
            "PTY I/O 仍可能在事件循环线程上阻塞"
        )
    # 默认窗口 80x24
    try:
        fcntl.ioctl(
            master_fd,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", 24, 80, 0, 0),
        )
    except OSError:
        pass
    entry = {
        "proc": proc,
        "master_fd": master_fd,
        "ws": None,
        "connected": False,
        "loop_task": None,
        "buf": b"",
        "created_at": time.time(),
        "last_activity": time.time(),
        "last_seen": time.time(),
    }
    _pty_store[session_id] = entry
    logger.info(
        "[qwenpaw-web-terminal] PTY session %s spawned (pid=%s, cwd=%s)",
        session_id,
        proc.pid,
        cwd,
    )
    return entry


def _attach_or_spawn(session_id: str):
    """返回该会话的 PTY 记录：进程存活则复用（attach），否则重新 spawn。"""
    _ensure_bg_tasks()  # 热重载后 startup hook 不保证执行，这里惰性补启后台任务
    entry = _pty_store.get(session_id)
    if entry and entry.get("proc") is not None and entry["proc"].poll() is None:
        return entry
    if entry:
        _cleanup_pty(session_id, entry)
    cwd = _sessions.get(session_id, {}).get("cwd", _DEFAULT_CWD)
    return _spawn_pty(session_id, cwd)


def _kill_pty(session_id: str) -> bool:
    """结束该会话的 PTY 进程组并清理记录；无记录/已死返回 False。"""
    entry = _pty_store.get(session_id)
    if not entry:
        return False
    proc = entry.get("proc")
    if proc is not None and proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:  # noqa: BLE001
            pass
    _cleanup_pty(session_id, entry)
    return True


def _cleanup_pty(session_id: str, entry) -> None:
    """清理 PTY 记录（进程已退出 / 被 kill / 删除会话时调用）。"""
    if _pty_store.get(session_id) is entry:
        _pty_store.pop(session_id, None)
    task = entry.get("loop_task")
    if task is not None and not task.done():
        # 不在读取循环自身内部时取消它（EOF 清理时 task 就是当前 task）
        try:
            if asyncio.current_task() is not task:
                task.cancel()
        except Exception:  # noqa: BLE001
            pass
    try:
        os.close(entry["master_fd"])
    except OSError:
        pass
    proc = entry.get("proc")
    if proc is not None and proc.poll() is None:
        # 刚被 kill：通常毫秒级退出。用很短超时，避免在事件循环线程上长时间阻塞
        # （旧值 1s 意味着最坏情况事件循环被占住 1 秒）。
        try:
            proc.wait(timeout=0.2)
        except Exception:  # noqa: BLE001
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass


async def _lag_watchdog() -> None:
    """事件循环延迟自检：每 0.5s 采样一次 loop lag，超过阈值打 WARNING。

    这是「PTY 阻塞事件循环」这类问题的回归哨兵——只要事件循环被任何同步调用
    （os.read/os.write、DNS、磁盘 I/O…）占住，lag 立刻飙升并在日志里可见，
    不必等到页面卡死才发现。lag 长期为 0 即说明事件循环健康。
    """
    loop = asyncio.get_running_loop()
    while True:
        t0 = loop.time()
        await asyncio.sleep(0.5)
        lag = loop.time() - t0 - 0.5
        lag_ms = lag * 1000.0
        _lag_state["last_ms"] = lag_ms
        _lag_state["samples"] += 1
        if lag_ms > _lag_state["max_ms"]:
            _lag_state["max_ms"] = lag_ms
        if lag > _LAG_WARN_SEC:
            _lag_state["warns"] += 1
            logger.warning(
                "[qwenpaw-web-terminal] event loop lag %.0fms (> %.0fms 阈值) —— "
                "有阻塞调用占住了事件循环线程",
                lag_ms,
                _LAG_WARN_SEC * 1000,
            )


def _ensure_bg_tasks() -> None:
    """确保后台任务（心跳清理 / 延迟自检）在运行（幂等）。

    正常路径由 startup hook 启动；但热重载（POST /api/plugins/install）时
    startup hook 不一定重新执行，故在首个会话请求路径上惰性补启，
    保证哨兵始终在线。
    """
    global _reaper_task, _lag_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _reaper_task is None or _reaper_task.done():
        _reaper_task = loop.create_task(_reaper_loop())
    if _lag_task is None or _lag_task.done():
        _lag_task = loop.create_task(_lag_watchdog())


async def _reaper_loop() -> None:
    """心跳守护：周期性清理「显示已连接但长时间无任何消息」的死 WS 连接。

    浏览器标签冻结/休眠、断网或页面被强制销毁时，TCP 连接可能悬挂——
    服务端 receive() 永远阻塞、finally 不执行，导致 connected 残留、
    管理面板显示「已连接」但实际已无人。前端每 20s 发 \x00ping 保活，
    超过 _HEARTBEAT_TIMEOUT 无任何消息 → 视为死连接，强制关闭清理。
    """
    while True:
        await asyncio.sleep(_REAPER_INTERVAL)
        now = time.time()
        for sid, entry in list(_pty_store.items()):
            if not (entry.get("connected") and entry.get("ws") is not None):
                continue
            last = entry.get("last_seen", now)
            if now - last <= _HEARTBEAT_TIMEOUT:
                continue
            proc = entry.get("proc")
            logger.info(
                "[qwenpaw-web-terminal] PTY session %s heartbeat timeout (%.0fs idle) — closing stale ws (pid=%s)",
                sid,
                now - last,
                proc.pid if proc is not None else "?",
            )
            try:
                await entry["ws"].close(code=1001)
            except Exception:  # noqa: BLE001
                pass
            # 死连接清理：进程保留后台（会话持久化）；handler 的 finally 会清理，
            # 此处兜底避免竞态窗口
            entry["ws"] = None
            entry["connected"] = False
            entry["last_activity"] = time.time()


async def _pty_loop(session_id: str, entry) -> None:
    """统一读取循环：PTY 输出 → 活跃 WS（实时）或 历史缓冲（全量保留）。

    - connected 时：输出经 WebSocket 发给前端，同时写入历史缓冲
    - 断开期间：输出写入 entry["buf"]（全量历史，上限 _BUF_MAX 保留尾部）
    - attach 时：WS handler 回放 entry["buf"] 完整历史（不清空）
    - 读到 EOF（bash 退出）→ 清理 PTY 记录（会话状态保留，可重新拉起）
    """
    master_fd = entry["master_fd"]
    loop = asyncio.get_running_loop()
    readable = asyncio.Event()

    def _on_readable() -> None:
        readable.set()

    # 事件驱动：fd 可读时由 loop 回调唤醒，避免同步 select.select() 阻塞事件循环。
    # 旧实现 `select.select(..., 0.1)` 是同步调用，空转时每个会话每轮都会阻塞整个
    # asyncio 事件循环最多 100ms（实测主服务出现 ~101ms 延迟尖峰）。
    use_reader = True
    try:
        loop.add_reader(master_fd, _on_readable)
    except (NotImplementedError, OSError, ValueError):
        use_reader = False  # 极少数环境不支持 add_reader → 回退为非阻塞轮询
    try:
        while True:
            if use_reader:
                await readable.wait()
                readable.clear()
            else:
                await asyncio.sleep(0.02)
                try:
                    r, _, _ = select.select([master_fd], [], [], 0)
                except OSError:
                    break
                if not r:
                    continue
            try:
                data = os.read(master_fd, 4096)
            except BlockingIOError:
                # master_fd 已置非阻塞：本次唤醒其实无数据可读（add_reader 是电平触发，
                # 可能为已被取走的数据置位）。EAGAIN 不是错误、更不是 EOF ——
                # 必须 continue 回去等待；绝不能 break（会误杀读循环，且旧代码的
                # `except OSError` 会把 BlockingIOError 当致命错误吞掉）。
                continue
            except OSError:
                break
            if not data:
                break  # EOF：bash 进程已退出
            entry["last_activity"] = time.time()
            # 全量历史：无论连接与否都记录，attach 时回放完整内容
            _append_buf(entry, data)
            if entry.get("connected") and entry.get("ws") is not None:
                try:
                    await entry["ws"].send_text(data.decode("utf-8", errors="replace"))
                except Exception:  # noqa: BLE001
                    # WS 已失效（旧连接关闭竞态）：降级为仅缓冲
                    entry["connected"] = False
    finally:
        if use_reader:
            try:
                loop.remove_reader(master_fd)
            except Exception:  # noqa: BLE001
                pass
    # EOF / fd 错误：进程结束，清理记录（不删除会话状态）
    logger.info(
        "[qwenpaw-web-terminal] PTY session %s exited (pid=%s)",
        session_id,
        entry.get("proc") is not None and entry["proc"].pid or "?",
    )
    _cleanup_pty(session_id, entry)


@router.websocket("/ws")
async def pty_ws(ws: WebSocket):
    """交互式终端：浏览器 <-> WebSocket <-> PTY(bash)，支持会话持久化。

    协议（文本帧）：
      - 普通文本   -> 写入 PTY（即用户输入）
      - \\x00resize:cols:rows -> 调整 PTY 窗口大小
      - \\x00ping   -> 回复 \\x00pong（心跳）

    生命周期：
      - 首次连接：spawn 新 bash；再次连接：若进程存活则 attach 原进程，
        并回放会话完整历史（前端 onopen 已清屏，全量回放不重复）
      - WS 断开（刷新/断网）：进程保留后台运行，输出写入缓冲；
        由管理面板 / kill 接口结束，或关闭标签时前端显式 DELETE
    """
    session_id = ws.query_params.get("session", "default")
    await ws.accept()
    if session_id not in _sessions:
        # 新会话：默认落在当前智能体工作区（依据 X-Agent-Id 请求头）
        _set_session_cwd(session_id, _request_agent_cwd(ws))
    entry = _attach_or_spawn(session_id)
    proc = entry["proc"]

    # 同一会话同一时刻只保留一个活跃 WS：踢掉旧连接（旧 handler 的 finally 不会误伤新连接）
    if entry.get("connected") and entry.get("ws") is not None and entry["ws"] is not ws:
        try:
            await entry["ws"].close()
        except Exception:  # noqa: BLE001
            pass
    entry["ws"] = ws
    entry["connected"] = True
    entry["last_activity"] = time.time()
    entry["last_seen"] = time.time()
    # 回放会话完整历史：不清空 buf（前端 onopen 已清屏，每次连接都全量回放；
    # 回放期间新输出仍会 append 进 buf，下次连接继续全量回放）
    if entry.get("buf"):
        try:
            await ws.send_text(
                entry["buf"].decode("utf-8", errors="replace")
            )
        except Exception:  # noqa: BLE001
            pass
    # 确保读取循环运行
    if entry.get("loop_task") is None or entry["loop_task"].done():
        entry["loop_task"] = asyncio.create_task(_pty_loop(session_id, entry))
    logger.info(
        "[qwenpaw-web-terminal] PTY session %s attached (pid=%s)", session_id, proc.pid
    )
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            text = msg.get("text")
            if text is None:
                # 兼容 binary 帧（部分输入法/粘贴场景会发 binary）
                raw = msg.get("bytes")
                if raw is None:
                    continue
                text = raw.decode("utf-8", errors="replace")
            if text.startswith("\x00resize:"):
                try:
                    _, cols, rows = text.split(":")
                    fcntl.ioctl(
                        entry["master_fd"],
                        termios.TIOCSWINSZ,
                        struct.pack("HHHH", int(rows), int(cols), 0, 0),
                    )
                except Exception:  # noqa: BLE001
                    pass
                continue
            if text == "\x00ping":
                entry["last_seen"] = time.time()  # 心跳：证明连接仍活跃
                try:
                    await ws.send_text("\x00pong")
                except Exception:  # noqa: BLE001
                    break
                continue
            entry["last_activity"] = time.time()
            entry["last_seen"] = time.time()
            if not await _pty_write(entry, text.encode("utf-8")):
                break
    except WebSocketDisconnect:
        pass
    finally:
        # 只清理当前连接的引用；进程保留后台运行（会话持久化）
        if entry.get("ws") is ws:
            entry["ws"] = None
            entry["connected"] = False
            entry["last_activity"] = time.time()
            logger.info(
                "[qwenpaw-web-terminal] PTY session %s detached (pid=%s) — 后台保留",
                session_id,
                proc.pid,
            )


# ============ SSE 降级传输（网关不支持 WebSocket 升级时使用） ============
def _sse_frame(data: bytes) -> str:
    """终端输出 → SSE data 帧。base64 编码：字节精确、可含任意控制字符/换行，
    前端用流式 TextDecoder 解码（跨 chunk 的多字节字符安全）。"""
    return "data: " + base64.b64encode(data).decode("ascii") + "\n\n"


@router.get("/stream")
async def pty_stream(request: Request, session: str = "default"):
    """SSE 下行通道：PTY 输出流（base64 data 帧）。

    - 复用与 WS 完全相同的会话/PTY/历史缓冲：首次连接 spawn，断线重连全量回放
    - 不占用 entry.ws/connected（与 WS 互不干扰；reaper 只管 WS 死连接）
    - 每 _SSE_KEEPALIVE 秒发注释帧 ': ping' 防中间网关空闲超时掐断
    - PTY 退出（bash 结束）时结束流 → 前端 EventSource 自动重连拉起新 PTY
    """
    session_id = session or "default"
    if session_id not in _sessions:
        _set_session_cwd(session_id, _request_agent_cwd(request))
    entry = _attach_or_spawn(session_id)
    if entry.get("loop_task") is None or entry["loop_task"].done():
        entry["loop_task"] = asyncio.create_task(_pty_loop(session_id, entry))
    entry["last_activity"] = time.time()
    logger.info(
        "[qwenpaw-web-terminal] PTY session %s attached via SSE (pid=%s)",
        session_id,
        entry["proc"].pid,
    )

    async def gen():
        ev = asyncio.Event()
        conn_events = entry.setdefault("sse_events", set())
        conn_events.add(ev)
        try:
            offset = 0
            # 全量回放（前端 onopen 已清屏，语义与 WS attach 一致）
            buf = entry.get("buf") or b""
            if buf:
                offset = len(buf)
                yield _sse_frame(bytes(buf))
            while True:
                if await request.is_disconnected():
                    break
                if _pty_store.get(session_id) is not entry:
                    break  # PTY 已退出清理：结束流，EventSource 自动重连重新拉起
                buf = entry.get("buf") or b""
                if offset > len(buf):  # 缓冲截断（超 _BUF_MAX 丢头部）：回退重发全量
                    offset = 0
                if len(buf) > offset:
                    data = bytes(buf[offset:])
                    offset = len(buf)
                    yield _sse_frame(data)
                    continue
                # 无新输出：事件驱动等待（由 _notify_sse 唤醒），超时发 keepalive 注释帧。
                # 旧实现每 _SSE_POLL(80ms) 轮询一次 buf —— 有延迟且空转耗 CPU。
                ev.clear()
                # clear 与检查之间不能有 await，否则可能漏掉刚到达的数据
                buf = entry.get("buf") or b""
                if offset > len(buf):
                    offset = 0
                if len(buf) > offset:
                    continue
                try:
                    await asyncio.wait_for(ev.wait(), timeout=_SSE_KEEPALIVE)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            conn_events.discard(ev)
        # 断开/结束：进程保留后台运行（会话持久化），不清理 entry

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class InputRequest(BaseModel):
    session_id: str = "default"
    data: str


@router.post("/input")
async def pty_input(req: InputRequest):
    """SSE 模式上行通道：键盘输入 / \\x00resize:c:r / \\x00ping（协议与 WS 一致）。"""
    sid = req.session_id or "default"
    entry = _attach_or_spawn(sid)
    if entry.get("loop_task") is None or entry["loop_task"].done():
        entry["loop_task"] = asyncio.create_task(_pty_loop(sid, entry))
    text = req.data
    if text.startswith("\x00resize:"):
        try:
            _, cols, rows = text.split(":")
            fcntl.ioctl(
                entry["master_fd"],
                termios.TIOCSWINSZ,
                struct.pack("HHHH", int(rows), int(cols), 0, 0),
            )
        except Exception:  # noqa: BLE001
            pass
        return {"ok": True}
    if text == "\x00ping":
        entry["last_seen"] = time.time()
        return {"ok": True, "pong": True}
    entry["last_activity"] = time.time()
    entry["last_seen"] = time.time()
    if not await _pty_write(entry, text.encode("utf-8")):
        return {"ok": False, "error": "pty write failed (session closed)"}
    return {"ok": True}


class WebTerminalPlugin:
    """Web 终端插件"""

    def __init__(self):
        self.name = "Web 终端"
        self.version = PLUGIN_VERSION
        self.id = "qwenpaw-web-terminal"
        self.router = router

    def register(self, api) -> None:
        """注册插件"""
        if hasattr(api, "register_http_router"):
            api.register_http_router(
                self.router,
                prefix="/qwenpaw-web-terminal",
                tags=["qwenpaw-web-terminal"],
            )
            logger.info("[qwenpaw-web-terminal] HTTP router registered at /api/qwenpaw-web-terminal")

        if hasattr(api, "register_startup_hook"):
            api.register_startup_hook("qwenpaw_web_terminal_startup", self._startup)

        if hasattr(api, "register_shutdown_hook"):
            api.register_shutdown_hook("qwenpaw_web_terminal_shutdown", self._shutdown)

    async def _startup(self) -> None:
        global _reaper_task, _lag_task
        if _reaper_task is None or _reaper_task.done():
            _reaper_task = asyncio.create_task(_reaper_loop())
        if _lag_task is None or _lag_task.done():
            _lag_task = asyncio.create_task(_lag_watchdog())
        logger.info(
            "[qwenpaw-web-terminal] Plugin v%s started - cwd=%s, sessions=%s",
            PLUGIN_VERSION,
            _DEFAULT_CWD,
            len(_sessions),
        )

    async def _shutdown(self) -> None:
        """主服务退出时清理所有遗留 PTY 进程，避免孤儿 bash。"""
        global _reaper_task, _lag_task
        if _reaper_task is not None:
            _reaper_task.cancel()
            _reaper_task = None
        if _lag_task is not None:
            _lag_task.cancel()
            _lag_task = None
        killed = 0
        for sid in list(_pty_store.keys()):
            if _kill_pty(sid):
                killed += 1
        logger.info("[qwenpaw-web-terminal] Plugin stopped, killed %s pty", killed)


# REQUIRED: 模块级 plugin 实例
plugin = WebTerminalPlugin()
