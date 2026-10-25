"""Read-only daily insights from saved local session reviews."""

from collections import Counter, defaultdict
from datetime import date, datetime
import json
from zoneinfo import ZoneInfo

from app.services.local_sessions import LocalSessions, LOCAL_USER


def _date(value, timezone):
    if not value:
        return None
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return timestamp.astimezone(timezone).date().isoformat()


def _assessment(video):
    return (video.get("analysis") or {}).get("assessment") or {}


def daily_records(timezone_name="America/New_York", store=None):
    """Collect completed review events, preserving repeated watches."""
    timezone = ZoneInfo(timezone_name)
    jobs = LocalSessions(store=store)
    records = []

    with jobs.store.connection() as connection:
        reviews = connection.execute(
            """
            SELECT id, payload, videos
            FROM local_review_jobs
            WHERE status IN ('complete', 'partial')
            ORDER BY updated_at
            """
        ).fetchall()

        category_rows = connection.execute(
            """
            SELECT id, name
            FROM categories
            WHERE user_id = ? AND merged_into IS NULL
            """,
            (LOCAL_USER,),
        ).fetchall()

        topic_rows = connection.execute(
            """
            SELECT session_id, result
            FROM session_topics
            WHERE user_id = ?
            """,
            (LOCAL_USER,),
        ).fetchall()

    category_names = {row["id"]: row["name"] for row in category_rows}
    session_topics = {
        row["session_id"]: json.loads(row["result"])
        for row in topic_rows
    }

    for review in reviews:
        payload = json.loads(review["payload"])
        videos = json.loads(review["videos"])

        video_map = {
            (video.get("platform"), video.get("source_id")): video
            for video in videos
        }

        assignments = session_topics.get(review["id"], {}).get(
            "assignments", {}
        )

        for event in payload.get("events", []):
            day = _date(event.get("started_at"), timezone)
            if day is None:
                continue

            platform = event["platform"]
            source_id = event["video_id"]
            key = f"{platform}:{source_id}"
            video = video_map.get((platform, source_id), {})
            assessment = _assessment(video)

            category_ids = assignments.get(key, [])

            # Limit each encounter to one category for daily totals.
            category_id = category_ids[0] if category_ids else None

            records.append({
                "date": day,
                "video_id": source_id,
                "platform": platform,
                "title": (
                    video.get("title")
                    or event.get("title")
                    or source_id
                ),
                "watched_at": event["started_at"],
                "dwell_seconds": event.get("dwell_seconds") or 0,
                "category_id": category_id,
                "category_name": category_names.get(
                    category_id, "Uncategorized"
                ),
                "assessment": {
                    "negative_for_user": assessment.get(
                        "negative_for_user", "unavailable"
                    ),
                    "reason": assessment.get("reason", ""),
                    "context_summary": assessment.get(
                        "context_summary", ""
                    ),
                    "content_signals": assessment.get(
                        "content_signals", []
                    ),
                } if assessment else None,
            })

    return records


def summarize_day(day, records, timezone_name):
    videos = [item for item in records if item["date"] == day]
    total = len(videos)
    categories = Counter(item["category_name"] for item in videos)
    negative = 0
    uncertain = 0
    assessed = 0

    for video in videos:
        assessment = video["assessment"]
        status = (
            assessment.get("negative_for_user")
            if assessment else "unavailable"
        )
        if status in ("yes", "no", "uncertain"):
            assessed += 1
        if status == "yes":
            negative += 1
        elif status == "uncertain":
            uncertain += 1

    category_details = []
    for name, count in categories.most_common():
        related = [v for v in videos if v["category_name"] == name]
        category_details.append({
            "id": related[0]["category_id"] or "uncategorized",
            "name": name,
            "video_count": count,
            "percentage": round(count * 100 / total, 1) if total else 0,
            "negative_count": sum(
                bool(v["assessment"])
                and v["assessment"].get("negative_for_user") == "yes"
                for v in related
            ),
        })

    return {
        "date": day,
        "timezone": timezone_name,
        "summary": {
            "videos_watched": total,
            "watch_seconds": round(sum(v["dwell_seconds"] for v in videos), 1),
            "assessed_videos": assessed,
            "negative_count": negative,
            "uncertain_count": uncertain,
            "not_assessed_count": total - assessed,
            "warning_rate": round(negative / assessed, 3) if assessed else None,
        },
        "top_categories": category_details,
        "videos": sorted(
            videos, key=lambda v: v["watched_at"]
        ),
    }


def get_day(day, timezone_name="America/New_York", store=None):
    date.fromisoformat(day)
    records = daily_records(timezone_name, store)
    return summarize_day(day, records, timezone_name)


def get_month(month, timezone_name="America/New_York", store=None):
    datetime.strptime(month, "%Y-%m")
    records = daily_records(timezone_name, store)
    dates = sorted({
        item["date"]
        for item in records
        if item["date"].startswith(month + "-")
    })

    days = []
    for day in dates:
        summary = summarize_day(day, records, timezone_name)["summary"]
        days.append({
            "date": day,
            "videos_watched": summary["videos_watched"],
            "negative_count": summary["negative_count"],
            "uncertain_count": summary["uncertain_count"],
            "not_assessed_count": summary["not_assessed_count"],
        })

    return {
        "month": month,
        "timezone": timezone_name,
        "days": days,
    }
