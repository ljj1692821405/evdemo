# -*- coding: utf-8 -*-
"""
批量并发仿真执行引擎 (01_batch_simulate.py)

功能特性：
  1. 多 Case 线程池并发调度（默认 3 并发，平稳安全）；
  2. 单 Case 内部严格时序串行（保证状态机级联绝对自洽）；
  3. 断点续跑支持（已完成的 Case 自动跳过，支持随时中断和恢复）；
  4. 线程安全日志记录（控制台独立简报 + 全局 timing_log.txt 汇总）；
  5. 产物双输出：一手原始流 (raw_{case_id}.json) + 真实轨迹镜像 (sim_traj_{case_id}.json)。

使用方法：
  python 01_batch_simulate.py --case_dir ../数据集/cases_json_del_mock --workers 3 --limit 5
"""

import sys
import json
import time
import argparse
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

# Windows 终端/重定向默认 GBK，遇到 emoji 会 UnicodeEncodeError，强制 UTF-8 兜底
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 复用 01_simulate_single.py 中经过严苛验证的核心逻辑
# 注意：文件名以数字开头，不能写 `import 01_simulate_single`，必须走 import_module
from importlib import import_module
sim_mod = import_module("01_simulate_single")
run_simulation = sim_mod.run_simulation
OUTPUT_DIR = sim_mod.OUTPUT_DIR
TRAJ_DIR = OUTPUT_DIR / "sim_trajectories"

PRINT_LOCK = threading.Lock()


def safe_print(msg):
    with PRINT_LOCK:
        print(msg)


def execute_single_case(case_path, interval_sec=5, traj_dir=None, clarify_policy=None):
    case_path = Path(case_path)
    # 兼容 case_0301.json 与 review_0001.json
    case_id = case_path.stem
    if case_id.startswith("case_"):
        case_id = case_id.replace("case_", "")
    
    target_traj_dir = Path(traj_dir) if traj_dir else TRAJ_DIR
    target_out_dir = target_traj_dir.parent
    traj_path = target_traj_dir / f"sim_traj_{case_id}.json"

    # 1. 断点续跑检查
    if traj_path.exists():
        return {
            "case_id": case_id,
            "status": "skipped",
            "message": "已存在物证轨迹，自动跳过"
        }

    try:
        t0 = time.time()
        # 调用核心状态机仿真函数，传递 output_dir
        raw_output = run_simulation(str(case_path), interval_sec=interval_sec, output_dir=target_out_dir,
                                    clarify_policy=clarify_policy)
        elapsed = round(time.time() - t0, 1)
        return {
            "case_id": case_id,
            "status": "success",
            "elapsed_sec": elapsed,
            "raw_output": str(raw_output)
        }
    except Exception as e:
        return {
            "case_id": case_id,
            "status": "failed",
            "error": str(e)
        }


def run_batch(case_dir, workers=3, limit=None, interval_sec=5, output_dir=None, clarify_policy=None):
    case_dir = Path(case_dir)
    target_out = Path(output_dir) if output_dir else OUTPUT_DIR
    target_traj = target_out / "sim_trajectories"
    target_traj.mkdir(parents=True, exist_ok=True)

    # 递归搜索支持：若 case_dir 包含子目录（如 dim_*），使用 rglob 收集所有用例
    all_cases = sorted([
        f for f in case_dir.rglob("case_*.json") if not f.name.startswith("_")
    ] + [
        f for f in case_dir.rglob("review_*.json") if not f.name.startswith("_")
    ])
    if not all_cases:
        all_cases = sorted([f for f in case_dir.rglob("*.json") if not f.name.startswith("_") and f.name != "config.json"])

    if limit:
        all_cases = all_cases[:limit]

    total = len(all_cases)
    safe_print("=" * 80)
    safe_print(f"🚀 [BATCH] 启动多 Case 线程池并发仿真调度器")
    safe_print(f"  - 用例目录: {case_dir}")
    safe_print(f"  - 产物目录: {target_out}")
    safe_print(f"  - 候选用例总数: {total}")
    safe_print(f"  - 并发工作线程 (Workers): {workers}")
    safe_print(f"  - 轮内安全等待间隔: {interval_sec}s")
    safe_print("=" * 80 + "\n")

    results = []
    success_cnt = 0
    skip_cnt = 0
    fail_cnt = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(execute_single_case, cp, interval_sec, target_traj, clarify_policy): cp
            for cp in all_cases
        }


        for idx, fut in enumerate(as_completed(future_map), 1):
            cp = future_map[fut]
            res = fut.result()
            cid = res["case_id"]
            st = res["status"]

            if st == "success":
                success_cnt += 1
                safe_print(f"[{idx}/{total}] ✅ 用例 {cid} 执行完成 (耗时: {res.get('elapsed_sec')}s)")
            elif st == "skipped":
                skip_cnt += 1
                safe_print(f"[{idx}/{total}] ⏩ 用例 {cid} 跳过 (已存在)")
            else:
                fail_cnt += 1
                safe_print(f"[{idx}/{total}] ❌ 用例 {cid} 失败: {res.get('error')}")

            results.append(res)

    safe_print("\n" + "=" * 80)
    safe_print(f"🎉 [BATCH] 批量并发调度完成！总计: {total} | 成功: {success_cnt} | 跳过: {skip_cnt} | 失败: {fail_cnt}")
    safe_print(f"📁 产物目录: {OUTPUT_DIR}")
    safe_print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="批量并发仿真调度器")
    parser.add_argument("--case_dir", default=str(BASE_DIR / "01_data"), help="Case 目录（默认 01_data，递归包含各 dim_* 子目录）")
    parser.add_argument("--output_dir", default=None, help="仿真产物输出目录 (如 result)")
    parser.add_argument("--workers", type=int, default=3, help="并发线程数 (推荐 3~5)")
    parser.add_argument("--limit", type=int, default=None, help="最大执行用例数 (调试使用)")
    parser.add_argument("--interval", type=int, default=5, help="单 Case 内部轮间等待秒数")
    parser.add_argument("--clarify_policy", default="skip", choices=["skip", "auto_first", "answer_from_case"],
                        help="澄清卡策略：skip 只收卡（默认）；auto_first 自动选首项；answer_from_case 按用例 clarify_answers")
    args = parser.parse_args()

    run_batch(args.case_dir, workers=args.workers, limit=args.limit, interval_sec=args.interval,
              output_dir=args.output_dir, clarify_policy=args.clarify_policy)
