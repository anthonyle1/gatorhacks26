"""Read-only API for Prune's isolated synthetic demo dataset."""

import json
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException

from analysis.topic_store import TopicStore

router = APIRouter(prefix="/demo", tags=["Synthetic demo"])

BASE = Path(__file__).resolve().parents[2]
DB = BASE / ".cache" / "demo_topics.sqlite3"
DATA = BASE / "data" / "demo"
USER = "demo_extension"


def store():
    if not DB.is_file():
        raise HTTPException(
            404, "Demo database missing. Run python demo_data.py reset"
        )
    return TopicStore(path=DB)


def read_data(filename):
    store()
    path = DATA / filename
    if not path.is_file():
        raise HTTPException(404, f"Missing demo file: {filename}")
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(500, "Invalid demo data") from None
    if not isinstance(result, list):
        raise HTTPException(500, "Invalid demo data format")
    return result


def validate_timezone(value):
    try:
        return ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        raise HTTPException(422, "Invalid timezone") from None


def demo_records(timezone_name):
    tz = validate_timezone(timezone_name)
    videos = {
        video["video_id"]: video
        for video in read_data("videos.json")
    }
    assessments = {
        assessment["video_id"]: assessment
        for assessment in read_data("assessments.json")
    }
    sessions = read_data("sessions.json")

    records = []

    for session_index, session in enumerate(sessions):
        for video_id in session.get("video_ids", []):
            video = videos.get(video_id)
            if video is None:
                continue

            watched_at = video.get("viewed_at")
            if not watched_at:
                continue

            try:
                timestamp = datetime.fromisoformat(
                    watched_at.replace("Z", "+00:00")
                )
                if timestamp.tzinfo is None:
                    raise ValueError("Missing timestamp timezone")
                # Spread the synthetic sessions across historical days.
                # This changes the demo display only, never real history.
                timestamp -= timedelta(days=len(sessions) - 1 - session_index)
                day = timestamp.astimezone(tz).date().isoformat()
                watched_at = timestamp.isoformat()
            except ValueError:
                continue

            raw_assessment = assessments.get(video_id)
            assessment = None

            if raw_assessment:
                assessment = {
                    "negative_for_user": raw_assessment.get(
                        "negative_for_user", "unavailable"
                    ),
                    "reason": raw_assessment.get("reason", ""),
                    "context_summary": raw_assessment.get(
                        "context_summary", ""
                    ),
                    "content_signals": raw_assessment.get(
                        "content_signals", []
                    ),
                }

            category = (
                video.get("demo_subtopic")
                or video.get("demo_topic")
                or "Uncategorized"
            )

            records.append({
                "date": day,
                "video_id": video_id,
                "platform": "youtube",
                "title": video.get("title") or video_id,
                "watched_at": watched_at,
                "dwell_seconds": video.get(
                    "watch_duration_seconds", 0
                ),
                "category_id": None,
                "category_name": category,
                "assessment": assessment,
            })

    return records


def summarize_day(day, records, timezone_name):
    videos = [r for r in records if r["date"] == day]
    total = len(videos)
    counts = Counter(v["category_name"] for v in videos)

    assessed = 0
    negative = 0
    uncertain = 0

    for video in videos:
        assessment = video["assessment"] or {}
        status = assessment.get(
            "negative_for_user", "unavailable"
        )

        if status in ("yes", "no", "uncertain"):
            assessed += 1
        if status == "yes":
            negative += 1
        elif status == "uncertain":
            uncertain += 1

    categories = []

    for name, count in counts.most_common():
        related = [
            v for v in videos
            if v["category_name"] == name
        ]

        categories.append({
            "id": name,
            "name": name,
            "video_count": count,
            "percentage": round(
                count * 100 / total, 1
            ) if total else 0,
            "negative_count": sum(
                1 for video in related
                if (video["assessment"] or {}).get(
                    "negative_for_user"
                ) == "yes"
            ),
        })

    return {
        "date": day,
        "timezone": timezone_name,
        "summary": {
            "videos_watched": total,
            "watch_seconds": round(sum(
                v["dwell_seconds"] for v in videos
            ), 1),
            "assessed_videos": assessed,
            "negative_count": negative,
            "uncertain_count": uncertain,
            "not_assessed_count": total - assessed,
            "warning_rate": round(
                negative / assessed, 3
            ) if assessed else None,
        },
        "top_categories": categories,
        "videos": sorted(
            videos, key=lambda v: v["watched_at"]
        ),
    }


@router.get("/taxonomy")
def demo_taxonomy():
    return store().view("global-tree", USER) or {
        "tree": [],
        "tree_videos": [],
        "global_video_count": 0,
        "selected_category_ids": [],
        "tree_scope": "global",
        "synthetic": True,
    }


@router.get("/sessions")
def demo_sessions():
    with store().connection() as conn:
        rows = conn.execute(
            "SELECT id, status FROM local_review_jobs ORDER BY id"
        ).fetchall()

    return {
        "synthetic": True,
        "sessions": [dict(row) for row in rows],
    }


@router.get("/sessions/{session_id}/taxonomy")
def demo_session_taxonomy(session_id: str):
    database = store()

    with database.connection() as conn:
        row = conn.execute(
            "SELECT videos, status FROM local_review_jobs WHERE id=?",
            (session_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(404, "Demo session not found")

    result = database.view(session_id, USER)
    if result is None:
        raise HTTPException(404, "Demo taxonomy not found")

    videos = json.loads(row["videos"])

    result.update(
        videos=videos,
        status=row["status"],
        synthetic=True,
        storage="demo",
        analyzed_count=len(videos),
        local_analysis_count=len(videos),
    )
    return result


@router.get("/daily")
def demo_daily_month(
    month: str,
    timezone: str = "America/New_York",
):
    try:
        datetime.strptime(month, "%Y-%m")
        if len(month) != 7:
            raise ValueError("Invalid month")
    except ValueError:
        raise HTTPException(422, "Invalid month") from None

    records = demo_records(timezone)
    days = []

    for day in sorted({
        r["date"]
        for r in records
        if r["date"].startswith(month + "-")
    }):
        summary = summarize_day(
            day, records, timezone
        )["summary"]

        days.append({
            "date": day,
            "videos_watched": summary["videos_watched"],
            "negative_count": summary["negative_count"],
            "uncertain_count": summary["uncertain_count"],
            "not_assessed_count": summary["not_assessed_count"],
        })

    return {
        "month": month,
        "timezone": timezone,
        "days": days,
        "synthetic": True,
    }


@router.get("/daily/{day}")
def demo_daily_detail(
    day: str,
    timezone: str = "America/New_York",
):
    try:
        date.fromisoformat(day)
    except ValueError:
        raise HTTPException(422, "Invalid date") from None

    records = demo_records(timezone)
    result = summarize_day(day, records, timezone)
    result["synthetic"] = True
    return result
