"""
Web 终端插件 v0.0.1 - QwenPaw
浏览器终端窗口：
  - GET    /api/qwenpaw-web-terminal/status            插件状态、版本、cwd（支持 ?session_id=）
  - GET    /api/qwenpaw-web-terminal/sessions          会话列表（多会话）
  - POST   /api/qwenpaw-web-terminal/sessions          创建会话 {id}
  - DELETE /api/qwenpaw-web-terminal/sessions/{sid}    删除会话（并强制结束该会话活跃 PTY）
  - POST   /api/qwenpaw-web-terminal/exec              单条命令执行（sh -c，cd 会话持久）
  - WS     /api/qwenpaw-web-terminal/ws?session=x      交互式 PTY（bash，OSC 7 上报 cwd）

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
from pathlib import Path

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

logger = logging.getLogger(__name__)

PLUGIN_VERSION = "0.0.1"

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

_sessions: dict = {}  # session_id -> {"cwd": str}
_active_pty: dict = {}  # session_id -> [{"ws": WebSocket, "proc": Popen}] 活跃 PTY 跟踪
_exec_timeout = 60.0


def _session_cwd(session_id: str = "default") -> str:
    return _sessions.setdefault(session_id, {"cwd": _DEFAULT_CWD})["cwd"]


def _set_session_cwd(session_id: str, cwd: str) -> None:
    _sessions.setdefault(session_id, {})["cwd"] = cwd


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
        "supports": ["exec", "pty_websocket", "sessions"],
    }


@router.get("/sessions")
async def list_sessions():
    """列出所有会话及其 cwd"""
    return {
        "ok": True,
        "sessions": [
            {"id": sid, "cwd": info["cwd"]}
            for sid, info in sorted(_sessions.items())
        ],
    }


@router.post("/sessions")
async def create_session(req: SessionRequest, request: Request):
    """创建（或重置）一个会话，可指定初始 cwd；未指定时默认当前智能体工作区
    （依据 X-Agent-Id 请求头）。"""
    sid = (req.id or "default").strip()
    if not sid:
        return {"ok": False, "error": "会话 id 不能为空"}
    target = req.cwd.strip() or _request_agent_cwd(request)
    target = os.path.expanduser(target)
    if not os.path.isabs(target):
        target = str((Path(_DEFAULT_CWD) / target).resolve())
    if not Path(target).is_dir():
        return {"ok": False, "error": f"目录不存在: {target}"}
    _set_session_cwd(sid, target)
    return {"ok": True, "id": sid, "cwd": _session_cwd(sid)}


@router.delete("/sessions/{sid}")
async def delete_session(sid: str):
    """删除会话状态；若该会话有活跃 PTY（WS 未正常关闭的兜底场景），
    直接 killpg 强制结束对应 bash 进程组。"""
    existed = sid in _sessions
    _sessions.pop(sid, None)
    killed = 0
    for entry in list(_active_pty.get(sid, [])):
        proc = entry.get("proc")
        if proc is not None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                killed += 1
            except Exception:  # noqa: BLE001
                pass
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

    return {
        "ok": True,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "exit_code": proc.returncode,
        "cwd": cwd,
    }


# ============ 交互式 PTY（WebSocket） ============
def _spawn_pty(cwd: str):
    """创建交互式 bash PTY 子进程，返回 (master_fd, proc)。

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
    return master_fd, proc


async def _pty_reader(ws: WebSocket, master_fd: int):
    """后台任务：master 输出 → WebSocket 文本帧。"""
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
                break
            await ws.send_text(data.decode("utf-8", errors="replace"))
        await asyncio.sleep(0.02)


@router.websocket("/ws")
async def pty_ws(ws: WebSocket):
    """交互式终端：浏览器 <-> WebSocket <-> PTY(bash)。

    协议（文本帧）：
      - 普通文本   -> 写入 PTY（即用户输入）
      - \\x00resize:cols:rows -> 调整 PTY 窗口大小
      - \\x00ping   -> 回复 \\x00pong（心跳）
    """
    session_id = ws.query_params.get("session", "default")
    await ws.accept()
    if session_id not in _sessions:
        # 新会话：默认落在当前智能体工作区（依据 X-Agent-Id 请求头）
        _set_session_cwd(session_id, _request_agent_cwd(ws))
    cwd = _sessions[session_id]["cwd"]
    master_fd, proc = _spawn_pty(cwd)
    # 默认窗口 80x24
    try:
        fcntl.ioctl(
            master_fd,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", 24, 80, 0, 0),
        )
    except OSError:
        pass

    reader_task = asyncio.create_task(_pty_reader(ws, master_fd))
    _entry = {"ws": ws, "proc": proc}
    _active_pty.setdefault(session_id, []).append(_entry)
    logger.info("[qwenpaw-web-terminal] PTY session %s started (pid=%s)", session_id, proc.pid)
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
                        master_fd,
                        termios.TIOCSWINSZ,
                        struct.pack("HHHH", int(rows), int(cols), 0, 0),
                    )
                except Exception:  # noqa: BLE001
                    pass
                continue
            if text == "\x00ping":
                try:
                    await ws.send_text("\x00pong")
                except Exception:  # noqa: BLE001
                    break
                continue
            try:
                os.write(master_fd, text.encode("utf-8"))
            except OSError:
                break
    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        try:
            await reader_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        # 清理子进程（整个进程组）。
        # 注意：交互式 bash 默认忽略 SIGTERM，必须用 SIGKILL 才能确保回收。
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:  # noqa: BLE001
            pass
        # 移除活跃 PTY 跟踪条目
        _entries = _active_pty.get(session_id, [])
        if _entry in _entries:
            _entries.remove(_entry)
        if not _entries:
            _active_pty.pop(session_id, None)
        try:
            proc.wait(timeout=1)
        except Exception:  # noqa: BLE001
            proc.kill()
        try:
            os.close(master_fd)
        except OSError:
            pass
        logger.info("[qwenpaw-web-terminal] PTY session %s closed", session_id)


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
        logger.info(
            "[qwenpaw-web-terminal] Plugin v%s started - cwd=%s, sessions=%s",
            PLUGIN_VERSION,
            _DEFAULT_CWD,
            len(_sessions),
        )

    async def _shutdown(self) -> None:
        logger.info("[qwenpaw-web-terminal] Plugin stopped")


# REQUIRED: 模块级 plugin 实例
plugin = WebTerminalPlugin()
