# -*- coding: utf-8 -*-
"""补充 eval_scorer_versions.rubric 字段：用于存储评分器的评分标准（维度/准则）。"""
import psycopg
from app.config import pg_settings

def migrate():
    cfg = pg_settings()
    if not cfg.ready:
        print("[!] PostgreSQL 配置未就绪")
        return

    conninfo = f"host={cfg.host} port={cfg.port} user={cfg.user} password={cfg.pwd} dbname={cfg.db}"
    try:
        with psycopg.connect(conninfo) as conn:
            with conn.cursor() as cur:
                # 检查字段是否已存在
                cur.execute("""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name='eval_scorer_versions' AND column_name='rubric'
                """)
                if cur.fetchone():
                    print("[*] rubric 字段已存在，跳过")
                    return

                # 补充 rubric 字段
                cur.execute("""
                    ALTER TABLE eval_scorer_versions 
                    ADD COLUMN rubric JSONB DEFAULT '{}'::jsonb
                """)
                conn.commit()
                print("[+] 已补充 eval_scorer_versions.rubric 字段")

    except psycopg.Error as exc:
        print(f"[!] 迁移失败：{exc}")

if __name__ == "__main__":
    migrate()
