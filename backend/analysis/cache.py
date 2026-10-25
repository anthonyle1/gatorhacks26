"""Optional TTL Redis plus bounded process cache. Never cache failed computations."""
from collections import OrderedDict
from functools import lru_cache
from threading import RLock
from contextlib import ExitStack
from time import monotonic
import json

from .versions import fingerprint


class EvidenceCache:
    def __init__(self, redis=None, capacity=2048, enabled=True):
        self.redis, self.capacity = redis, capacity
        self.enabled = enabled
        self.items = OrderedDict()
        # A serialized miss boundary also protects against duplicate CPU inference.
        self.lock = RLock()
        self.miss_locks = [RLock() for _ in range(64)]
        self.hits = self.misses = 0
        self.redis_retry_at = 0.

    def get_or_compute(self, identity, compute, ttl=3600, *, count_miss=True):
        if not self.enabled:
            return compute()
        key = "prune:v2:" + fingerprint(identity)
        with self.miss_locks[int(key[-8:], 16) % len(self.miss_locks)]:
            if self.redis is not None and monotonic() >= self.redis_retry_at:
                try:
                    raw = self.redis.get(key)
                    if raw is not None:
                        self.hits += 1
                        return json.loads(raw)
                except Exception:
                    self.redis_retry_at = monotonic() + 5
            with self.lock:
                cached = self.items.get(key)
                if cached and cached[0] > monotonic():
                    self.hits += 1
                    self.items.move_to_end(key)
                    return json.loads(cached[1])
            if count_miss:
                self.misses += 1
            value = compute()
            encoded = json.dumps(value, allow_nan=False)
            with self.lock:
                self.items[key] = (monotonic() + ttl, encoded)
                self.items.move_to_end(key)
                while len(self.items) > self.capacity:
                    self.items.popitem(last=False)
            if self.redis is not None and monotonic() >= self.redis_retry_at:
                try:
                    self.redis.setex(key, ttl, encoded)
                except Exception:
                    self.redis_retry_at = monotonic() + 5
            return value

    def many(self, identities, compute, ttl=3600):
        """Batch only missing normalized texts, while retaining per-evidence attribution."""
        if not self.enabled:
            return compute(list(range(len(identities))))
        with ExitStack() as locks:
            # Same lock order for batches prevents deadlocks; stripe count is bounded.
            for stripe in sorted({int(fingerprint(identity)[-8:], 16) % len(self.miss_locks) for identity in identities}):
                locks.enter_context(self.miss_locks[stripe])
            found, missing = {}, {}
            for index, identity in enumerate(identities):
                key = fingerprint(identity)
                if key in found or key in missing:
                    continue
                class Miss(Exception):
                    pass
                def absent():
                    raise Miss()
                try:
                    found[key] = self.get_or_compute(identity, absent, ttl, count_miss=False)
                except Miss:
                    missing.setdefault(key, (index, identity))
            if missing:
                results = compute([index for index, _ in missing.values()])
                if len(results) != len(missing):
                    raise RuntimeError("Inference batch size mismatch")
                for (key, (_, identity)), result in zip(missing.items(), results):
                    found[key] = self.get_or_compute(identity, lambda result=result: result, ttl)
            return [found[fingerprint(identity)] for identity in identities]


@lru_cache(maxsize=1)
def get_cache():
    from app.config import settings
    client = None
    if settings.redis_url:
        try:
            import redis
            client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=.2, socket_timeout=.2)
        except ImportError:
            pass
    return EvidenceCache(client, enabled=settings.analysis_cache_enabled)
