# -*- coding: utf-8 -*-
"""一键精准停止 evdemo 前后端服务 (8000, 3000)。"""
import socket
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0


def kill_port(port: int) -> None:
    if not is_port_in_use(port):
        print(f"[*] 端口 {port} 未被占用")
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
            subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"[+] 已安全终止端口 {port} 进程 (PID {pid})")
    except Exception as e:
        print(f"[!] 释放端口 {port} 遇到错误: {e}")


if __name__ == "__main__":
    print("正在安全停止 evdemo 相关端口服务...")
    kill_port(8000)
    kill_port(3000)
    print("[+] 停止完毕。")
