# -*- coding: utf-8 -*-
"""PostgreSQL 初始化脚本：建立评测平台所需的表结构。
运行：python init_db.py
"""
from __future__ import annotations

import sys

from app.config import pg_settings
from app.responses import ServiceError

try:
    import psycopg
except ImportError:
    print("[!] psycopg 未安装，请先执行 pip install -r requirements.txt")
    sys.exit(1)


def init_db() -> None:
    """创建所有需要的表。"""
    cfg = pg_settings()
    if not cfg.ready:
        print("[!] PostgreSQL 配置不完整（host / user / db）")
        sys.exit(1)

    conninfo = (
        f"host={cfg.host} port={cfg.port} user={cfg.user} "
        f"password={cfg.pwd} dbname={cfg.db} connect_timeout=5"
    )

    try:
        with psycopg.connect(conninfo) as conn:
            with conn.cursor() as cur:
                print("[*] 创建 llm_calls 表...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS llm_calls (
                        id BIGSERIAL PRIMARY KEY,
                        call_id VARCHAR(64) NOT NULL UNIQUE,
                        
                        -- 调用上下文
                        scene VARCHAR(50),
                        model VARCHAR(100),
                        temperature REAL,
                        
                        -- 输入与输出
                        prompt_tokens INT,
                        completion_tokens INT,
                        total_tokens INT,
                        
                        -- 计时与状态
                        latency_ms INT,
                        status VARCHAR(20),
                        error_message TEXT,
                        
                        -- 记录存储
                        prompt_hash VARCHAR(64),
                        prompt_key VARCHAR(256),
                        response_key VARCHAR(256),
                        
                        -- 时间戳
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_llm_calls_created_at ON llm_calls(created_at);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_llm_calls_model ON llm_calls(model);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_llm_calls_status ON llm_calls(status);")

                print("[*] 创建 judge_results 表（评分记录）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS judge_results (
                        id BIGSERIAL PRIMARY KEY,
                        
                        -- 关联
                        run_id VARCHAR(64),
                        case_id VARCHAR(64),
                        turn_no INT,
                        judge_dim VARCHAR(100),
                        
                        -- 调用信息
                        llm_call_id BIGINT REFERENCES llm_calls(id),
                        
                        -- 分数与结论
                        score INT,
                        pass BOOLEAN,
                        evidence TEXT,
                        reason TEXT,
                        
                        -- 时间戳
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_judge_results_run_id ON judge_results(run_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_judge_results_case_id ON judge_results(case_id);")

                conn.commit()
                print("[+] 初始化完成")

    except psycopg.Error as exc:
        print(f"[!] PostgreSQL 错误：{exc}")
        sys.exit(1)


if __name__ == "__main__":
    init_db()
