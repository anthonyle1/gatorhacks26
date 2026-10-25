"""Daily and rolling activity, including encounters awaiting session review."""

from collections import Counter
from datetime import date, datetime, timedelta, timezone as utc_timezone
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


def record_activity(session_id, events, store=None):
    jobs = LocalSessions(store=store)
    with jobs.store.connection() as connection:
        for event in events:
            connection.execute("""INSERT INTO local_activity_events(session_id,event_id,payload)
                VALUES (?,?,?) ON CONFLICT(session_id,event_id) DO UPDATE SET payload=excluded.payload""",
                (session_id, event["event_id"], json.dumps(event)))
    return {"recorded": len(events)}


def _insights(video):
    analysis = video.get("analysis") or {}
    assessment = analysis.get("assessment")
    signals = (assessment or {}).get("content_signals") or []
    polarities = (assessment or {}).get("signal_polarities") or {}
    return {
        "warning_count": sum(polarities.get(s["id"]) == "negative" for s in signals) if assessment else None,
        "positive_insight_count": sum(polarities.get(s["id"]) == "positive" for s in signals) if assessment else None,
        "unrated_signal_count": sum(polarities.get(s["id"]) not in ("negative", "positive") for s in signals) if assessment else None,
        "comment_counts": (analysis.get("sentiment") or {}).get("counts"),
        "analysis_status": analysis.get("status", "pending"),
    }


def daily_records(timezone_name="America/New_York", store=None):
    """Merge live encounters with review checkpoints, preserving repeated watches."""
    timezone = ZoneInfo(timezone_name)
    jobs = LocalSessions(store=store)
    records = {}

    with jobs.store.connection() as connection:
        reviews = connection.execute(
            """
            SELECT id, payload, videos
            FROM local_review_jobs
            ORDER BY updated_at
            """
        ).fetchall()
        live = connection.execute("SELECT session_id,event_id,payload FROM local_activity_events").fetchall()

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

    # A saved review replaces its matching live event, including while analysis is running.
    inputs = [(row["session_id"], {"events": [json.loads(row["payload"])]}, []) for row in live]
    inputs.extend((row["id"], json.loads(row["payload"]), json.loads(row["videos"])) for row in reviews)

    for session_id, payload, videos in inputs:

        video_map = {
            (video.get("platform"), video.get("source_id")): video
            for video in videos
        }

        assignments = session_topics.get(session_id, {}).get(
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

            identity = (session_id, event["event_id"])
            records[identity] = {
                "event_id": event["event_id"],
                "session_id": session_id,
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
                **_insights(video),
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
                    "signal_polarities": assessment.get("signal_polarities", {}),
                } if assessment else None,
            }

    return list(records.values())


def summarize_day(day, records, timezone_name):
    videos = [item for item in records if day is None or item["date"] == day]
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
            "warning_count": sum(v.get("warning_count") or 0 for v in videos),
            "positive_insight_count": sum(v.get("positive_insight_count") or 0 for v in videos),
            "comment_counts": {label: sum((v.get("comment_counts") or {}).get(label, 0) for v in videos)
                               for label in ("positive", "neutral", "negative")},
            "uncertain_count": uncertain,
            "not_assessed_count": total - assessed,
            "warning_rate": round(negative / assessed, 3) if assessed else None,
        },
        "top_categories": category_details,
        "videos": sorted(
            videos, key=lambda v: v["watched_at"]
        ),
    }


def get_recent(timezone_name="America/New_York", store=None, now=None):
    now = now or datetime.now(utc_timezone.utc)
    since = now - timedelta(hours=24)
    records = [item for item in daily_records(timezone_name, store)
               if since <= datetime.fromisoformat(item["watched_at"].replace("Z", "+00:00")) <= now]
    result = summarize_day(None, records, timezone_name)
    result.update(date=now.astimezone(ZoneInfo(timezone_name)).date().isoformat(),
                  window_start=since.isoformat(), window_end=now.isoformat())
    return result


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
            "warning_count": summary["warning_count"],
            "positive_insight_count": summary["positive_insight_count"],
            "uncertain_count": summary["uncertain_count"],
            "not_assessed_count": summary["not_assessed_count"],
        })

    return {
        "month": month,
        "timezone": timezone_name,
        "days": days,
    }
