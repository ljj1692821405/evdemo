# -*- coding: utf-8 -*-
"""补充 eval_scorer_versions 缺失字段：rubric(JSONB) + published_at(TIMESTAMP) + published_by(VARCHAR)。"""
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
                # 检查并补充 rubric
                cur.execute("""
                    SELECT column_name FROM information_schema.columns 
                    WHERE table_name='eval_scorer_versions' AND column_name='rubric'
                """)
                if not cur.fetchone():
                    cur.execute("ALTER TABLE eval_scorer_versions ADD COLUMN rubric JSONB DEFAULT '{}'::jsonb")
                    print("[+] 已补充 rubric 字段")
                else:
                    print("[*] rubric 字段已存在")

                # 检查并补充 published_at
                cur.execute("""
                    SELECT column_name FROM information_schema.columns 
                    WHERE table_name='eval_scorer_versions' AND column_name='published_at'
                """)
                if not cur.fetchone():
                    cur.execute("ALTER TABLE eval_scorer_versions ADD COLUMN published_at TIMESTAMP")
                    print("[+] 已补充 published_at 字段")
                else:
                    print("[*] published_at 字段已存在")

                # 检查并补充 published_by
                cur.execute("""
                    SELECT column_name FROM information_schema.columns 
                    WHERE table_name='eval_scorer_versions' AND column_name='published_by'
                """)
                if not cur.fetchone():
                    cur.execute("ALTER TABLE eval_scorer_versions ADD COLUMN published_by VARCHAR(100) DEFAULT 'system'")
                    print("[+] 已补充 published_by 字段")
                else:
                    print("[*] published_by 字段已存在")

                conn.commit()
                print("[+] 字段补充完成")

    except psycopg.Error as exc:
        print(f"[!] 迁移失败：{exc}")

if __name__ == "__main__":
    migrate()
