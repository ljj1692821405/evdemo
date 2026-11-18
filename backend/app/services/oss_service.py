# -*- coding: utf-8 -*-
"""阿里云 OSS 服务层：连通性探测、列举、上传、预签名。"""
from __future__ import annotations

import time
from typing import Any

from ..config import oss_settings
from ..responses import ServiceError

try:
    import oss2
except ImportError:  # pragma: no cover
    oss2 = None  # type: ignore[assignment]


def _require_sdk() -> None:
    if oss2 is None:
        raise ServiceError("未安装 oss2，请执行 pip install -r requirements.txt", 500)


def _bucket(endpoint: str | None = None):
    cfg = oss_settings()
    if not cfg.ready:
        raise ServiceError("OSS bucket / AK / SK / endpoint 未配置完整", 500)
    _require_sdk()
    auth = oss2.Auth(cfg.ak, cfg.sk)
    # oss2 默认连接超时 60s，内网 endpoint 不可达时会长时间阻塞，这里收紧到 5s
    return oss2.Bucket(auth, endpoint or cfg.endpoint, cfg.bucket, connect_timeout=5)


def probe() -> dict[str, Any]:
    """
    分层探测：内网 endpoint 优先，失败后自动回退公网域名。
    返回每轮尝试的明细，便于判断是网络可达性问题还是凭证问题。
    """
    cfg = oss_settings()
    result: dict[str, Any] = {
        "bucket": cfg.bucket,
        "attempts": [],
    }
    if not cfg.ready:
        result["ok"] = False
        result["error"] = "bucket / AK / SK / endpoint 未配置完整"
        return result

    _require_sdk()
    candidates: list[tuple[str, str]] = [("配置 endpoint", cfg.endpoint)]
    public = cfg.public_endpoint
    if public and public != cfg.endpoint:
        candidates.append(("公网 endpoint（回退）", public))

    for label, endpoint in candidates:
        started = time.perf_counter()
        try:
            bucket = _bucket(endpoint)
            # 以 ListObjects 作为鉴权+连通校验：业务只需对象级权限，不要求 oss:GetBucketInfo
            objects = [obj.key for obj in bucket.list_objects(max_keys=5).object_list]
            # 地域信息需要 oss:GetBucketInfo，没有该权限时不影响探测结论
            try:
                region = bucket.get_bucket_info().location or ""
            except oss2.exceptions.OssError:
                region = ""
            result["attempts"].append({
                "label": label,
                "endpoint": endpoint,
                "ok": True,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "region": region,
                "sample_keys": objects,
            })
            result["ok"] = True
            result["endpoint"] = endpoint
            result["latency_ms"] = int((time.perf_counter() - started) * 1000)
            result["sample_keys"] = objects
            return result
        except Exception as exc:  # oss2 抛的异常类型较杂，统一收敛
            result["attempts"].append({
                "label": label,
                "endpoint": endpoint,
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "latency_ms": int((time.perf_counter() - started) * 1000),
            })

    result["ok"] = False
    result["error"] = "所有 endpoint 均不可用，详见 attempts"
    return result


def list_objects(prefix: str = "", max_keys: int = 100) -> list[dict[str, Any]]:
    bucket = _bucket()
    out: list[dict[str, Any]] = []
    for obj in oss2.ObjectIterator(bucket, prefix=prefix, max_keys=max_keys):
        out.append({
            "key": obj.key,
            "size": obj.size,
            "last_modified": obj.last_modified,
            "etag": obj.etag,
        })
        if len(out) >= max_keys:
            break
    return out


def put_object(key: str, content: bytes, content_type: str = "application/octet-stream") -> str:
    bucket = _bucket()
    try:
        bucket.put_object(key, content, headers={"Content-Type": content_type})
    except Exception as exc:
        raise ServiceError(f"OSS 上传失败：{type(exc).__name__}: {exc}", 502) from exc
    return key


def sign_url(key: str, expires_sec: int = 900) -> str:
    bucket = _bucket()
    try:
        return bucket.sign_url("GET", key, expires_sec, slash_safe=True)
    except Exception as exc:
        raise ServiceError(f"生成预签名 URL 失败：{type(exc).__name__}: {exc}", 502) from exc
