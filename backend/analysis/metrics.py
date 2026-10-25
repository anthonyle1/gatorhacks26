"""Bounded timing samples; contains no source text or credentials."""
from collections import defaultdict, deque
from contextlib import contextmanager
from threading import Lock
from time import perf_counter
import math
from statistics import median

_samples = defaultdict(lambda: deque(maxlen=1000))
_lock = Lock()


def record(stage, seconds):
    with _lock:
        _samples[stage].append(max(0, seconds))


@contextmanager
def measure(stage):
    start = perf_counter()
    try:
        yield
    finally:
        with _lock:
            _samples[stage].append(perf_counter() - start)


def snapshot():
    with _lock:
        return {key: {"count": len(values), "median_seconds": median(values),
                      "p95_seconds": sorted(values)[math.ceil(len(values)*.95)-1]}
                for key, values in _samples.items() if values}
