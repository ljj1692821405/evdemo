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
                print("[+] 基础表初始化完成")

                # ========== Week 1-2 评测平台表结构 ==========
                print("[*] 创建 eval_flow_configs 表（流程配置）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_flow_configs (
                        flow_id VARCHAR(100) PRIMARY KEY,
                        name VARCHAR(200) NOT NULL,
                        description TEXT,
                        version VARCHAR(50) DEFAULT '1.0',
                        org_id VARCHAR(100) DEFAULT 'default',
                        status VARCHAR(20) DEFAULT 'active',
                        
                        -- JSON 配置字段
                        input_schema JSONB,
                        simulation_config JSONB,
                        output_schema JSONB,
                        
                        -- 元信息
                        created_by VARCHAR(100) DEFAULT 'system',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_configs_org_id ON eval_flow_configs(org_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_configs_status ON eval_flow_configs(status);")
                cur.execute("ALTER TABLE eval_flow_configs ADD COLUMN IF NOT EXISTS product_line_id VARCHAR(100) DEFAULT '';")
                cur.execute("ALTER TABLE eval_flow_configs ADD COLUMN IF NOT EXISTS agent_id VARCHAR(100) DEFAULT '';")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_configs_scope ON eval_flow_configs(org_id, product_line_id, agent_id);")
                # 裁判配置：为空表示不评判
                cur.execute("ALTER TABLE eval_flow_configs ADD COLUMN IF NOT EXISTS judge_config JSONB DEFAULT '{}'::jsonb;")

                print("[*] 创建 eval_flow_versions 表（流程版本快照）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_flow_versions (
                        id BIGSERIAL PRIMARY KEY,
                        flow_id VARCHAR(100) NOT NULL,
                        version VARCHAR(50) NOT NULL,
                        org_id VARCHAR(100) DEFAULT 'default',
                        product_line_id VARCHAR(100) DEFAULT '',
                        agent_id VARCHAR(100) DEFAULT '',
                        name VARCHAR(200),
                        description TEXT,
                        input_schema JSONB,
                        simulation_config JSONB,
                        output_schema JSONB,
                        judge_config JSONB,
                        created_by VARCHAR(100) DEFAULT 'system',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (flow_id, version)
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_id ON eval_flow_versions(flow_id);")
                cur.execute("ALTER TABLE eval_flow_versions ADD COLUMN IF NOT EXISTS judge_config JSONB DEFAULT '{}'::jsonb;")

                print("[*] 创建 eval_tasks 表（评测任务）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_tasks (
                        task_id VARCHAR(100) PRIMARY KEY,
                        flow_id VARCHAR(100) REFERENCES eval_flow_configs(flow_id),
                        org_id VARCHAR(100) DEFAULT 'default',
                        status VARCHAR(20) DEFAULT 'pending',
                        
                        -- 进度统计
                        total_cases INT DEFAULT 0,
                        completed_cases INT DEFAULT 0,
                        failed_cases INT DEFAULT 0,
                        
                        -- 输入数据
                        input_data JSONB,
                        
                        -- 元信息
                        created_by VARCHAR(100) DEFAULT 'system',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_flow_id ON eval_tasks(flow_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON eval_tasks(org_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON eval_tasks(status);")
                cur.execute("ALTER TABLE eval_tasks ADD COLUMN IF NOT EXISTS product_line_id VARCHAR(100) DEFAULT '';")
                cur.execute("ALTER TABLE eval_tasks ADD COLUMN IF NOT EXISTS agent_id VARCHAR(100) DEFAULT '';")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_scope ON eval_tasks(org_id, product_line_id, agent_id);")

                print("[*] 创建 eval_results 表（评测结果）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_results (
                        id BIGSERIAL PRIMARY KEY,
                        task_id VARCHAR(100) REFERENCES eval_tasks(task_id),
                        flow_id VARCHAR(100) REFERENCES eval_flow_configs(flow_id),
                        org_id VARCHAR(100) DEFAULT 'default',
                        
                        -- 输入输出
                        input_data JSONB,
                        raw_output JSONB,
                        processed_output JSONB,
                        
                        -- 执行状态
                        status VARCHAR(20) DEFAULT 'pending',
                        latency_ms INT DEFAULT 0,
                        error_message TEXT,
                        
                        -- 时间戳
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_results_task_id ON eval_results(task_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_results_flow_id ON eval_results(flow_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_results_org_id ON eval_results(org_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_results_status ON eval_results(status);")
                cur.execute("ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS product_line_id VARCHAR(100) DEFAULT '';")
                cur.execute("ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS agent_id VARCHAR(100) DEFAULT '';")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_results_scope ON eval_results(org_id, product_line_id, agent_id);")

                print("[*] 创建 eval_datasets 表（数据集）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_datasets (
                        id VARCHAR(100) PRIMARY KEY,
                        name VARCHAR(200) NOT NULL,
                        agent_id VARCHAR(100) DEFAULT 'ag_skill',
                        version VARCHAR(20) DEFAULT 'v1',
                        tags JSONB DEFAULT '[]'::jsonb,
                        default_gt BOOLEAN DEFAULT FALSE,
                        status VARCHAR(20) DEFAULT 'active',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_datasets_agent_id ON eval_datasets(agent_id);")
                cur.execute("ALTER TABLE eval_datasets ADD COLUMN IF NOT EXISTS org_id VARCHAR(100) DEFAULT 'default';")
                cur.execute("ALTER TABLE eval_datasets ADD COLUMN IF NOT EXISTS product_line_id VARCHAR(100) DEFAULT '';")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_datasets_scope ON eval_datasets(org_id, product_line_id, agent_id);")

                print("[*] 创建 eval_cases 表（Case）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_cases (
                        id VARCHAR(100) PRIMARY KEY,
                        dataset_id VARCHAR(100) NOT NULL,
                        agent_id VARCHAR(100) DEFAULT 'ag_skill',
                        query JSONB DEFAULT '[]'::jsonb,
                        tags JSONB DEFAULT '[]'::jsonb,
                        workspace_size VARCHAR(50) DEFAULT '—',
                        gt_source VARCHAR(20) DEFAULT 'missing',
                        gt_keys JSONB DEFAULT '[]'::jsonb,
                        valid BOOLEAN DEFAULT TRUE,
                        invalid_reason TEXT,
                        raw JSONB DEFAULT '{}'::jsonb,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_cases_dataset_id ON eval_cases(dataset_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_cases_agent_id ON eval_cases(agent_id);")
                cur.execute("ALTER TABLE eval_cases ADD COLUMN IF NOT EXISTS org_id VARCHAR(100) DEFAULT 'default';")
                cur.execute("ALTER TABLE eval_cases ADD COLUMN IF NOT EXISTS product_line_id VARCHAR(100) DEFAULT '';")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_cases_scope ON eval_cases(org_id, product_line_id, agent_id);")

                print("[*] 创建 eval_users 表（登录用户）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_users (
                        id BIGSERIAL PRIMARY KEY,
                        -- 飞书身份：open_id 在单个应用内唯一且稳定，作为天然主键
                        open_id VARCHAR(100) NOT NULL UNIQUE,
                        union_id VARCHAR(100),
                        user_id VARCHAR(100),
                        name VARCHAR(200),
                        en_name VARCHAR(200),
                        avatar_url TEXT,
                        email VARCHAR(200),
                        mobile VARCHAR(50),
                        tenant_key VARCHAR(100),
                        -- 本地角色，登录后按需扩展权限
                        role VARCHAR(50) DEFAULT 'member',
                        org_id VARCHAR(100) DEFAULT 'default',
                        first_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        login_count INT DEFAULT 1,
                        raw JSONB DEFAULT '{}'::jsonb
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_users_union_id ON eval_users(union_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_users_last_login ON eval_users(last_login_at DESC);")

                print("[*] 创建 eval_sessions 表（登录会话）...")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS eval_sessions (
                        -- 存 token 的 sha256，不存明文：库被拖也难以直接冒用
                        token_hash VARCHAR(64) PRIMARY KEY,
                        open_id VARCHAR(100) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        expires_at TIMESTAMP NOT NULL,
                        revoked BOOLEAN DEFAULT FALSE,
                        ip VARCHAR(64),
                        user_agent TEXT
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_open_id ON eval_sessions(open_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON eval_sessions(expires_at);")

                conn.commit()
                print("[+] 评测平台表结构初始化完成")
                print("[+] 所有表初始化完成")


    except psycopg.Error as exc:
        print(f"[!] PostgreSQL 错误：{exc}")
        sys.exit(1)


if __name__ == "__main__":
    import sys
    if "--check" in sys.argv:
        # 仅检查连接
        cfg = pg_settings()
        conninfo = f"host={cfg.host} port={cfg.port} user={cfg.user} password={cfg.pwd} dbname={cfg.db} connect_timeout=5"
        try:
            with psycopg.connect(conninfo) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT version();")
                    ver = cur.fetchone()[0]
                    print(f"[+] PostgreSQL 连接成功")
                    print(f"[*] 版本: {ver}")
        except psycopg.Error as exc:
            print(f"[!] PostgreSQL 错误：{exc}")
            sys.exit(1)
    else:
        init_db()

