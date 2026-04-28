"""
inference_window — Redis-backed rolling window of recent predictions per
active decision system.

Spec reference: TASK-10 Layer 3

Storage:
    Key:   inference_window:{decision_system_id}
    Type:  Redis sorted set (ZSET)
    Score: prediction timestamp (Unix seconds)
    Member: f"{score}:{uuid}" so duplicates are distinct

Auto-trim: keep at most 1000 entries by trimming on every insert
(ZREMRANGEBYRANK 0 -1001).

The Layer 3 Celery beat task (see workers/inference_health_monitor.py)
reads the window every 5 minutes and runs InferenceHealthChecker.

When Redis is unavailable, falls back to an in-process dict — only
useful for local dev without Redis. Production must have Redis (which
already exists for Celery + EventStore).
"""
from __future__ import annotations

import json
import time
import uuid
from collections import defaultdict, deque
from typing import Optional

import numpy as np

from app.core.config import settings


_MAX_WINDOW_SIZE = 1000


class _InProcessFallback:
    """Used only when Redis is unavailable. Maintains a per-system
    deque of (score, timestamp) tuples capped at 1000."""

    def __init__(self):
        self._windows: dict[str, deque] = defaultdict(lambda: deque(maxlen=_MAX_WINDOW_SIZE))

    def push(self, decision_system_id: str, score: float):
        self._windows[decision_system_id].append((float(score), time.time()))

    def fetch(self, decision_system_id: str) -> np.ndarray:
        return np.array([s for s, _ in self._windows.get(decision_system_id, [])])

    def list_active_systems(self) -> list[str]:
        return [sid for sid, w in self._windows.items() if len(w) > 0]


class _RedisWindow:
    """Redis-backed rolling window. Same API as the fallback."""

    def __init__(self, redis_url: str):
        import redis
        self._r = redis.from_url(redis_url, decode_responses=True)
        self._prefix = "inference_window:"

    def _key(self, decision_system_id: str) -> str:
        return self._prefix + decision_system_id

    def push(self, decision_system_id: str, score: float):
        key = self._key(decision_system_id)
        # Member must be unique so duplicates aren't deduped
        member = f"{score}:{uuid.uuid4().hex[:8]}"
        ts = time.time()
        try:
            pipe = self._r.pipeline()
            pipe.zadd(key, {member: ts})
            # Keep only the most-recent N entries
            pipe.zremrangebyrank(key, 0, -(_MAX_WINDOW_SIZE + 1))
            # Expire the key if no traffic for 24h (keeps Redis tidy)
            pipe.expire(key, 86400)
            pipe.execute()
        except Exception:
            # Don't break inference if window write fails
            pass

    def fetch(self, decision_system_id: str) -> np.ndarray:
        key = self._key(decision_system_id)
        try:
            members = self._r.zrange(key, 0, -1, withscores=False)
            scores = [float(m.split(":")[0]) for m in members]
            return np.array(scores)
        except Exception:
            return np.array([])

    def list_active_systems(self) -> list[str]:
        try:
            keys = list(self._r.scan_iter(match=self._prefix + "*", count=100))
            return [k[len(self._prefix):] for k in keys]
        except Exception:
            return []


def _create_window():
    if settings.REDIS_URL:
        try:
            return _RedisWindow(settings.REDIS_URL)
        except Exception:
            pass
    return _InProcessFallback()


# Module-level singleton — instantiated once per process
_window = _create_window()


def push_prediction(decision_system_id: str, score: float):
    """Append a prediction to the rolling window. No-ops on Redis errors
    so inference never fails because of monitoring infrastructure."""
    if not decision_system_id:
        return
    _window.push(decision_system_id, score)


def fetch_window(decision_system_id: str) -> np.ndarray:
    """Return the current window of prediction scores (newest last)."""
    return _window.fetch(decision_system_id)


def list_active_systems() -> list[str]:
    """Return all decision system IDs that currently have predictions in
    the window. Used by the Celery beat task to know which systems to
    evaluate."""
    return _window.list_active_systems()
