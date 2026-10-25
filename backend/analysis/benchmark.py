"""Run from backend: python -m analysis.benchmark --mode decode path/to/*.mp3.

ASR runs require --mode asr and locally available pinned model weights. This
command never treats synthetic audio as an accuracy or supported-language test.
"""
import argparse
import glob
import json
import math
import platform
import statistics
from pathlib import Path
from time import perf_counter, process_time

from .metrics import snapshot
from .transcription import decode_mp3, transcribe
from .versions import versions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--mode", choices=["decode", "asr"], default="decode")
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 2 <= args.iterations <= 100:
        parser.error("Use 2 to 100 iterations to separate cold and warm execution")
    paths = sorted({path for pattern in args.paths for path in glob.glob(pattern)})
    if not paths:
        parser.error("No matching audio fixtures")
    results = []
    for path in paths:
        raw = Path(path).read_bytes()
        times, cpu = [], []
        for _ in range(args.iterations):
            start, cpu_start = perf_counter(), process_time()
            result = transcribe(raw) if args.mode == "asr" else decode_mp3(raw)
            cpu.append(process_time() - cpu_start)
            times.append(perf_counter() - start)
        warm = sorted(times[1:])
        results.append({"fixture": Path(path).name, "uploaded_bytes": len(raw), "cold_seconds": times[0],
            "warm_median_seconds": statistics.median(warm), "warm_p95_seconds": warm[math.ceil(.95*len(warm))-1],
            "cpu_seconds": cpu, "decoded_seconds": len(result)/16000 if args.mode == "decode" else None,
            "usability": result["exclusion_reason"] if args.mode == "asr" else None})
    report = {"mode": args.mode, "hardware": {"platform": platform.platform(), "cpu": platform.processor()},
              "versions": versions("transcription"), "results": results, "stages": snapshot()}
    encoded = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
