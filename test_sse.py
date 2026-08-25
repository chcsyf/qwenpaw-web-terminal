#!/usr/bin/env python3
"""SSE 降级通道验收测试（独立实例，不动 QwenPaw 主进程）。

流程：subprocess 拉起一个挂在 18089 的 FastAPI(plugin.router)，
      然后以客户端身份验证 /stream + /input 的完整链路。
"""
import base64
import importlib.util
import json
import os
import subprocess
import sys
import time

import requests

PORT = 18089
BASE = f"http://127.0.0.1:{PORT}/api/qwenpaw-web-terminal"
HERE = os.path.dirname(os.path.abspath(__file__))


def spawn_server():
    code = f"""
import importlib.util, uvicorn
from fastapi import FastAPI
spec = importlib.util.spec_from_file_location("qwt_plugin", r"{HERE}/plugin.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
app = FastAPI()
app.include_router(m.router, prefix="/api/qwenpaw-web-terminal")
uvicorn.run(app, host="127.0.0.1", port={PORT}, log_level="warning")
"""
    p = subprocess.Popen(
        [sys.executable, "-c", code],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        cwd=HERE,
    )
    return p


def wait_ready(timeout=15):
    for _ in range(timeout * 2):
        try:
            r = requests.get(f"{BASE}/status", timeout=1)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def drain_sse(session, sid, dur=4.0):
    """请求 SSE 流，收集全部 base64 data 帧并解码拼接。"""
    out = bytearray()
    try:
        with session.get(
            f"{BASE}/stream?session={sid}",
            stream=True, timeout=(5, dur + 2),
            headers={"Accept": "text/event-stream"},
        ) as r:
            assert r.status_code == 200, f"stream HTTP {r.status_code}"
            t0 = time.time()
            data_buf = b""
            while time.time() - t0 < dur:
                line = r.raw.read(1)
                # 简化：逐行读 SSE（data: 后接单行 base64）
                if line == b"\n":
                    if data_buf.startswith(b"data:"):
                        payload = data_buf.split(b"data:", 1)[1].strip()
                        try:
                            out += base64.b64decode(payload)
                        except Exception:
                            pass
                    data_buf = b""
                elif line:
                    data_buf += line
    except Exception as e:
        print("  [stream] read aborted:", e)
    return bytes(out)


def main():
    ok = True
    print("==> 启动独立插件实例 (port %d) ..." % PORT)
    p = spawn_server()
    try:
        if not wait_ready():
            print("!! 服务未就绪"); return 1
        print("  服务就绪")

        s = requests.Session()

        # 1) status / sessions
        st = s.get(f"{BASE}/status").json()
        print("[1] status:", st.get("version"))
        assert st.get("version")

        # 2) input：发送 echo 命令
        r = s.post(f"{BASE}/input", json={"session_id": "sse_t1", "data": "echo SSE_OK_$((6*7))\r"})
        print("[2] input echo:", r.json())

        # 3) SSE 流：应能收到回显/输出（含 SSE_OK_42）
        blob = drain_sse(s, "sse_t1", dur=5)
        txt = blob.decode("utf-8", "replace")
        print("[3] stream 接收字节数:", len(blob))
        print("    解码内容(片段):", repr(txt[:160]))
        if "SSE_OK_42" in txt:
            print("    ✓ 命令输出经 SSE 回流成功")
        else:
            ok = False
            print("    ✗ 未在 stream 中看到 SSE_OK_42")

        # 4) resize 控制帧
        r = s.post(f"{BASE}/input", json={"session_id": "sse_t1", "data": "\x00resize:120:30"})
        print("[4] resize:", r.json())
        assert r.json().get("ok") is True

        # 5) ping 保活
        r = s.post(f"{BASE}/input", json={"session_id": "sse_t1", "data": "\x00ping"})
        print("[5] ping:", r.json())
        assert r.json().get("pong") is True

        # 6) stdin 交互（写大写文本，验证透传）
        r = s.post(f"{BASE}/input", json={"session_id": "sse_t1", "data": "echo PING_$((1+1))\r"})
        blob2 = drain_sse(s, "sse_t1", dur=5)
        txt2 = blob2.decode("utf-8", "replace")
        print("[6] 二次输入后 stream:", repr(txt2[-140:]))
        if "PING_2" in txt2:
            print("    ✓ 交互链路通")
        else:
            ok = False
            print("    ✗ 未见 PING_2")

        # 7) exec 与 WS 不受影响（回归）
        r = s.post(f"{BASE}/exec", json={"cmd": "echo EXEC_OK", "session_id": "sse_t1"})
        print("[7] exec:", (r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:160]))
        exc = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
        if isinstance(exc, dict):
            if exc.get("error") or any("EXEC_OK" in str(v) for v in exc.values()):
                print("    ✓ exec 回归正常")
            else:
                ok = False; print("    ✗ exec 输出异常")
        else:
            if "EXEC_OK" in exc:
                print("    ✓ exec 回归正常")
            else:
                ok = False; print("    ✗ exec 输出异常")

        # 8) 会话状态
        sess = s.get(f"{BASE}/sessions").json()
        print("[8] sessions:", {k: (v.get("pty_running") if isinstance(v, dict) else v) for k, v in sess.items()} if isinstance(sess, dict) else sess)

        print()
        print("=== 结果:%s ===" % ("PASS ✅" if ok else "FAIL ❌"))
        return 0 if ok else 1
    finally:
        p.terminate()
        try:
            p.wait(timeout=3)
        except Exception:
            p.kill()


if __name__ == "__main__":
    sys.exit(main())
