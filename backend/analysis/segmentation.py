"""Integer sample contract: [start,end), media seconds = sample / sample_rate."""
import math


def target_duration(latency, overhead, real_time_factor, reserve, minimum=1.5):
    if not all(math.isfinite(x) and x >= 0 for x in (latency, overhead, reserve, minimum)) or not math.isfinite(real_time_factor) or real_time_factor <= 0:
        raise ValueError("Invalid latency budget")
    target = (latency - overhead - reserve) / real_time_factor
    if target < minimum:
        raise ValueError("Latency budget cannot preserve useful speech context")
    return target


def plan(duration, target=15., *, sample_rate=16000, mode="full", budget=60., minimum=1.5):
    if not all(math.isfinite(x) and x > 0 for x in (duration, target, budget, minimum)) or not isinstance(sample_rate, int) or sample_rate < 1:
        raise ValueError("Invalid segmentation parameters")
    if target < minimum or mode not in {"full", "sparse"}:
        raise ValueError("Invalid target or mode")
    samples = round(duration * sample_rate)
    n = max(1, math.ceil(duration / target))
    if samples < n:
        raise ValueError("Empty sample range")
    if n > 1 and duration / n < minimum:
        raise ValueError("Equal segments would be too short")
    if mode == "full":
        return [(i * samples // n, (i + 1) * samples // n) for i in range(n)]
    selected = min(samples, math.floor(budget * sample_rate))
    if selected < min(samples, math.ceil(minimum * sample_rate)):
        raise ValueError("Audio budget is too small")
    count = min(n, max(1, int(budget / minimum)))
    length = selected // count
    if count == 1:
        return [((samples - length) // 2, (samples + length) // 2)]
    return [(i * (samples - length) // (count - 1), i * (samples - length) // (count - 1) + length) for i in range(count)]


def coverage(intervals):
    """Return unique media duration and repeated duration separately."""
    merged, total = [], 0.
    for start, end in sorted(intervals):
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
            raise ValueError("Invalid captured interval")
        total += end - start
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    unique = sum(end - start for start, end in merged)
    return {"unique_seconds": unique, "repeat_seconds": total - unique}
