# -*- coding: utf-8 -*-
"""evdemo 全栈一键启动器 (Python 原生驱动，无 bat 编码与语法问题)

用法：
    python start.py           # 一键启动后端、前端并打开浏览器
    python start.py --check   # 仅检查数据库与端口状态
"""
from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

# 确保控制台支持 UTF-8 打印
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"


def log(msg: str, color: str = "") -> None:
    colors = {
        "green": "\033[92m",
        "yellow": "\033[93m",
        "red": "\033[91m",
        "cyan": "\033[96m",
        "bold": "\033[1m",
        "reset": "\033[0m",
    }
    prefix = colors.get(color, "")
    suffix = colors["reset"] if color else ""
    print(f"{prefix}{msg}{suffix}", flush=True)


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0


def kill_process_on_port(port: int) -> None:
    """根据端口号精准查杀对应进程 (Windows)。"""
    if not is_port_in_use(port):
        return
    try:
        out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True)
        pids = set()
        for line in out.strip().splitlines():
            parts = line.split()
            if len(parts) >= 5 and f":{port}" in parts[1]:
                pid = parts[-1]
                if pid.isdigit() and pid != "0":
                    pids.add(int(pid))
        for pid in pids:
            try:
                subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                log(f"[*] 已释放端口 {port} (PID {pid})", "cyan")
            except Exception:
                pass
    except Exception:
        pass


def check_database() -> bool:
    """运行 init_db.py --check 确认 PG 活着。"""
    cmd = [sys.executable, str(BACKEND_DIR / "init_db.py"), "--check"]
    res = subprocess.run(cmd, cwd=str(BACKEND_DIR), capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if res.returncode != 0:
        log("[!] PostgreSQL 数据库连接失败！", "red")
        if res.stdout:
            print(res.stdout.strip())
        if res.stderr:
            print(res.stderr.strip())
        log("请检查 backend/.env 中的 PG 配置或确认本地 PostgreSQL 服务已启动。", "yellow")
        return False
    return True


def wait_for_http(url: str, timeout_sec: float = 25.0) -> bool:
    start = time.time()
    while time.time() - start < timeout_sec:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "evdemo-launcher"})
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.4)


def main() -> None:
    log("=" * 60, "cyan")
    log("       🚀 evdemo 评测平台 · Python 原生一键启动器", "cyan")
    log("=" * 60, "cyan")

    # 1. 检查命令行参数
    if "--check" in sys.argv:
        ok = check_database()
        sys.exit(0 if ok else 1)

    # 2. 清理旧端口占用
    log("\n[1/4] 检查并释放端口 8000 与 3000...", "yellow")
    kill_process_on_port(8000)
    kill_process_on_port(3000)
    time.sleep(0.5)

    # 3. 校验数据库
    log("\n[2/4] 自检 PostgreSQL 数据库连接...", "yellow")
    if not check_database():
        sys.exit(1)
    log("[+] 数据库连接正常", "green")

    # 4. 启动后端
    log("\n[3/4] 启动后端 FastAPI (http://127.0.0.1:8000)...", "yellow")
    backend_cmd = [sys.executable, "run.py", "--reload"]
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=str(BACKEND_DIR),
        creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0,
    )

    log("[*] 等待后端服务就绪 (/api/health)...", "cyan")
    if not wait_for_http("http://127.0.0.1:8000/api/health", timeout_sec=25):
        log("[!] 后端在 25 秒内未能正常响应，请查看弹出的后端命令行窗口报错！", "red")
        backend_proc.terminate()
        sys.exit(1)
    log("[+] 后端已就绪！(http://127.0.0.1:8000)", "green")

    # 5. 启动前端
    log("\n[4/4] 启动前端 Next.js (http://localhost:3000)...", "yellow")
    pnpm_cmd = "pnpm.cmd" if sys.platform == "win32" else "pnpm"
    frontend_proc = subprocess.Popen(
        [pnpm_cmd, "dev"],
        cwd=str(ROOT_DIR),
        creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0,
    )

    log("[*] 等待前端页面就绪...", "cyan")
    frontend_ok = wait_for_http("http://localhost:3000", timeout_sec=30)
    if frontend_ok:
        log("[+] 前端已就绪！", "green")
    else:
        log("[*] 前端编译较慢，已继续唤起浏览器...", "yellow")

    # 6. 打开浏览器
    try:
        webbrowser.open("http://localhost:3000")
    except Exception:
        pass

    log("\n" + "=" * 60, "cyan")
    log("  🎉 全栈服务已全部启动成功！", "green")
    log("  - 前端界面: http://localhost:3000", "bold")
    log("  - 登录入口: http://localhost:3000/login", "bold")
    log("  - 后端文档: http://127.0.0.1:8000/docs", "bold")
    log("  提示：在此终端按 Ctrl+C，可同时一键停止后端与前端服务。", "yellow")
    log("=" * 60 + "\n", "cyan")

    # 7. 优雅看护子进程：Ctrl+C 时统一关闭
    def shutdown(sig, frame):
        log("\n[*] 正在关闭前端与后端服务...", "yellow")
        kill_process_on_port(8000)
        kill_process_on_port(3000)
        try:
            backend_proc.terminate()
        except Exception:
            pass
        try:
            frontend_proc.terminate()
        except Exception:
            pass
        log("[+] 所有服务已停止，退出完毕。", "green")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            if backend_proc.poll() is not None:
                log("[!] 后端进程已退出", "red")
                break
            if frontend_proc.poll() is not None:
                log("[!] 前端进程已退出", "red")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown(None, None)


if __name__ == "__main__":
    main()
