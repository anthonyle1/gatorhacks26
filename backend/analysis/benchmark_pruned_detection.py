"""Opt-in live evaluation: python -m analysis.benchmark_pruned_detection.

Uses Groq credits. Outputs only case identities, outcomes, and timings.
"""
import asyncio
import json
from pathlib import Path
from time import perf_counter

from app.config import settings
from .pruned_detection import detect


async def main():
    if not settings.groq_api_key:
        raise SystemExit("Set GROQ_API_KEY in the root .env before running live evaluation.")
    examples = json.loads((Path(__file__).resolve().parents[1] / "tests/fixtures/pruned_detection_examples.json").read_text(encoding="utf-8"))
    topics = [{"id": "topic_celebrity", "name": "Celebrity Relationship Drama",
               "description": "Speculation, rumors, breakups, dating, and controversies about public figures' romantic relationships.",
               "descendants": [], "ancestors": [], "aliases": []}]
    passed = 0
    for case in examples:
        started = perf_counter()
        result = await detect({key: case[key] for key in ("title", "caption", "comments")}, topics)
        correct = result.status == case["expected"]
        passed += correct
        print(json.dumps({"case": case["id"], "expected": case["expected"], "actual": result.status,
                          "notification": result.status == "MATCH" and result.confidence >= settings.detection_confidence_threshold,
                          "passed": correct, "duration_ms": round((perf_counter() - started) * 1000)}))
    print(f"{passed}/{len(examples)} expected outcomes; confidence is uncalibrated.")
    return 0 if passed == len(examples) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
