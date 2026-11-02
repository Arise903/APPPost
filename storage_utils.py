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
    from release_policy import validate_review_record
    validate_review_record(value)
    target = review_path(path)
    if target.exists():
        atomic_write(target.with_name(target.name + ".previous"), target.read_text(encoding="utf-8"))
    atomic_write(target, json.dumps(value, ensure_ascii=False, indent=2))
