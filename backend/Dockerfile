# syntax=docker/dockerfile:1
# 后端镜像：FastAPI + psycopg（非异步驱动，无需编译依赖）
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Shanghai

WORKDIR /app

# 系统依赖：psycopg 需要 libpq；curl 用于健康检查
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

# 先只拷贝依赖清单，让 pip 层可被缓存
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 再拷贝源码
COPY . .

# 非 root 运行：容器逃逸时影响面更小
RUN useradd --create-home --shell /bin/bash eval \
    && chown -R eval:eval /app
USER eval

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# 生产不挂 --reload；worker 数按 CPU 由 compose 的 command 覆盖
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
