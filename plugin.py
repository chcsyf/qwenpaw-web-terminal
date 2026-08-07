"""
Web 终端插件 v0.1.0 - QwenPaw
浏览器终端窗口：
  - GET    /api/qwenpaw-web-terminal/status            插件状态、版本、cwd（支持 ?session_id=）
  - GET    /api/qwenpaw-web-terminal/sessions          会话列表（含 PTY 运行状态，供管理面板）
  - POST   /api/qwenpaw-web-terminal/sessions          创建会话 {id, cwd?}
  - POST   /api/qwenpaw-web-terminal/sessions/{sid}/kill  结束该会话的 PTY 进程（保留会话状态）
  - DELETE /api/qwenpaw-web-terminal/sessions/{sid}    删除会话（并强制结束该会话活跃 PTY）
  - POST   /api/qwenpaw-web-terminal/exec              单条命令执行（sh -c，cd 会话持久）
  - WS     /api/qwenpaw-web-terminal/ws?session=x      交互式 PTY（bash，OSC 7 上报 cwd）

v0.1.0 新增（会话持久化）：
  - WS 意外断开（刷新/断网）不再 kill PTY 进程，进程转入后台保留，输出写入历史缓冲；
    重新连接同会话自动 attach 并回放完整历史。正常关闭标签由前端显式 DELETE/kill 结束。
  - GET /sessions 返回每个会话的 PTY 状态（运行/已连接/后台运行/缓冲大小），
    配合前端「会话管理」面板进行打开、结束、删除、清理空闲。

安全提醒：exec 与 PTY 均以 QwenPaw 进程身份执行宿主机 shell 命令，
属于高危能力，仅建议在可信环境（本地/内网）使用。
"""
import asyncio
import fcntl
import logging
import os
import pty
import select
import signal
import struct
import subprocess
import termios
import time
from pathlib import Path

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

logger = logging.getLogger(__name__)

PLUGIN_VERSION = "0.1.4"

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


# ============ 交互式 PTY（WebSocket + 会话持久化） ============
def _append_buf(entry, data: bytes) -> None:
    """写入会话历史缓冲（保留尾部 _BUF_MAX 字节，作为全量历史滚动窗口）。"""
    entry["buf"] = (entry.get("buf", b"") + data)[-_BUF_MAX:]


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
    if proc is not None:
        try:
            proc.wait(timeout=1)
        except Exception:  # noqa: BLE001
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass


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
    while True:
        try:
            r, _, _ = select.select([master_fd], [], [], 0.1)
        except OSError:
            break
        if r:
            try:
                data = os.read(master_fd, 4096)
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
        await asyncio.sleep(0.02)
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
            try:
                os.write(entry["master_fd"], text.encode("utf-8"))
            except OSError:
                break
    except WebSocketDisconnect:
        pass
    finally:
        # 只清理当前连接的引用；进程保留后台运行（会话持久化，与文档 v0.1.0 一致）
        if entry.get("ws") is ws:
            entry["ws"] = None
            entry["connected"] = False
            entry["last_activity"] = time.time()
            logger.info(
                "[qwenpaw-web-terminal] PTY session %s detached (pid=%s) — 后台保留",
                session_id,
                proc.pid,
            )


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
        global _reaper_task
        if _reaper_task is None or _reaper_task.done():
            _reaper_task = asyncio.create_task(_reaper_loop())
        logger.info(
            "[qwenpaw-web-terminal] Plugin v%s started - cwd=%s, sessions=%s",
            PLUGIN_VERSION,
            _DEFAULT_CWD,
            len(_sessions),
        )

    async def _shutdown(self) -> None:
        """主服务退出时清理所有遗留 PTY 进程，避免孤儿 bash。"""
        global _reaper_task
        if _reaper_task is not None:
            _reaper_task.cancel()
            _reaper_task = None
        killed = 0
        for sid in list(_pty_store.keys()):
            if _kill_pty(sid):
                killed += 1
        logger.info("[qwenpaw-web-terminal] Plugin stopped, killed %s pty", killed)


# REQUIRED: 模块级 plugin 实例
plugin = WebTerminalPlugin()
