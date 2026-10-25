import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from analysis.topic_store import TopicStore
from app.services.local_sessions import LocalSessions
from app.services.daily_insights import get_day, get_month


def test_daily_insights_from_saved_session(tmp_path):
    store = TopicStore(tmp_path / "daily_test.sqlite3")
    jobs = LocalSessions(store=store)
    session_id = str(uuid4())

    events = [
        {
            "event_id": "evt-1",
            "video_id": "demo123",
            "platform": "youtube",
            "title": "Example cooking video",
            "sequence_number": 1,
            "started_at": "2026-10-24T14:00:00+00:00",
            "ended_at": "2026-10-24T14:01:00+00:00",
            "dwell_seconds": 60,
        },
        {
            "event_id": "evt-2",
            "video_id": "demo456",
            "platform": "youtube",
            "title": "Example discussion video",
            "sequence_number": 2,
            "started_at": "2026-10-24T15:00:00+00:00",
            "ended_at": "2026-10-24T15:00:30+00:00",
            "dwell_seconds": 30,
        },
    ]

    videos = [
        {
            "video_id": "youtube:demo123",
            "source_id": "demo123",
            "platform": "youtube",
            "title": "Example cooking video",
            "analysis": {
                "assessment": {
                    "negative_for_user": "no",
                    "reason": "A cooking demonstration.",
                    "context_summary": "Making a meal.",
                    "content_signals": [],
                }
            },
        },
        {
            "video_id": "youtube:demo456",
            "source_id": "demo456",
            "platform": "youtube",
            "title": "Example discussion video",
            "analysis": {
                "assessment": {
                    "negative_for_user": "yes",
                    "reason": "Potentially hostile discussion.",
                    "context_summary": "A heated discussion.",
                    "content_signals": [],
                }
            },
        },
    ]

    with store.connection() as connection:
        connection.execute(
            """
            INSERT INTO local_review_jobs
                (id, payload, status, videos, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                session_id,
                json.dumps({"events": events, "instagram": []}),
                "complete",
                json.dumps(videos),
                datetime.now(timezone.utc).isoformat(),
            ),
        )

    day = get_day(
        "2026-10-24",
        "America/New_York",
        store=store,
    )

    assert day["summary"]["videos_watched"] == 2
    assert day["summary"]["watch_seconds"] == 90
    assert day["summary"]["negative_count"] == 1
    assert day["summary"]["assessed_videos"] == 2
    assert day["summary"]["not_assessed_count"] == 0

    month = get_month(
        "2026-10",
        "America/New_York",
        store=store,
    )

    assert len(month["days"]) == 1
    assert month["days"][0]["videos_watched"] == 2


def test_empty_date(tmp_path):
    store = TopicStore(tmp_path / "empty.sqlite3")
    day = get_day("2026-10-24", store=store)

    assert day["summary"]["videos_watched"] == 0
    assert day["summary"]["warning_rate"] is None
    assert day["videos"] == []


def test_invalid_date(tmp_path):
    store = TopicStore(tmp_path / "invalid.sqlite3")

    with pytest.raises(ValueError):
        get_day("not-a-date", store=store)
