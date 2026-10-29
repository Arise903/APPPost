"""Atomic file persistence and release review metadata."""
import hashlib
import json
import os
import tempfile
from pathlib import Path


def atomic_write(path, text, encoding="utf-8"):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def review_path(path):
    return path.with_name("." + path.stem + ".review.json")


def revision(path):
    digest = hashlib.sha256(path.read_bytes())
    for extra in (review_path(path), path.with_name("." + path.stem + ".permstate.json")):
        digest.update(b"\x00")
        if extra.exists():
            digest.update(extra.read_bytes())
    return digest.hexdigest()


def load_review(path):
    extra = review_path(path)
    if not extra.exists():
        return {"release": {}, "items": {}, "history": []}
    return json.loads(extra.read_text(encoding="utf-8"))


def save_review(path, value):
    if not isinstance(value, dict) or not isinstance(value.get("release", {}), dict) or not isinstance(value.get("items", {}), dict):
        raise ValueError("发布记录格式无效")
    for item in value.get("items", {}).values():
        if not isinstance(item, dict) or any(not isinstance(v, str) for v in item.values()):
            raise ValueError("备注和证据必须为文本")
    subscriptions = value.get('subscriptions', [])
    if not isinstance(subscriptions, list) or len(subscriptions) > 100 or any(not isinstance(p, dict) or any(not isinstance(v, str) or len(v) > 4000 for v in p.values()) for p in subscriptions):
        raise ValueError('订阅商品配置无效')
    target = review_path(path)
    if target.exists():
        atomic_write(target.with_name(target.name + ".previous"), target.read_text(encoding="utf-8"))
    atomic_write(target, json.dumps(value, ensure_ascii=False, indent=2))
