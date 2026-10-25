import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from analysis.topic_store import TopicStore
from app.services.local_sessions import LocalSessions
from app.services.daily_insights import get_day, get_month, get_recent, record_activity


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


def test_live_rolling_day_updates_and_preserves_separate_encounters(tmp_path):
    store = TopicStore(tmp_path / "live.sqlite3")
    now = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
    def event(identity, watched, seconds=5):
        return {"event_id": identity, "video_id": "repeat", "platform": "instagram",
                "started_at": watched, "dwell_seconds": seconds, "title": "Live reel"}
    events = [event("old", "2026-10-24T11:59:59Z"), event("edge", "2026-10-24T12:00:00Z"),
              event("new", "2026-10-25T11:00:00Z"), event("future", "2026-10-25T12:00:01Z")]
    record_activity("session", events, store)
    record_activity("session", [event("new", "2026-10-25T11:00:00Z", 20)], store)
    result = get_recent(store=store, now=now)
    assert result["summary"]["videos_watched"] == 2
    assert result["summary"]["watch_seconds"] == 25
    assert result["summary"]["not_assessed_count"] == 2
    assert result["videos"][0]["warning_count"] is None
    assert result["videos"][0]["comment_counts"] is None
    assert get_day("2026-10-25", store=store)["summary"]["videos_watched"] == 2


def test_review_checkpoint_enriches_live_event_without_counting_it_twice(tmp_path):
    store = TopicStore(tmp_path / "checkpoints.sqlite3")
    session_id = str(uuid4())
    event = {"event_id": "one", "video_id": "abc", "platform": "youtube",
             "started_at": "2026-10-25T12:00:00Z", "dwell_seconds": 12}
    record_activity(session_id, [event], store)
    video = {"platform": "youtube", "source_id": "abc", "analysis": {
        "status": "processing", "sentiment": {"counts": {"positive": 7, "neutral": 3, "negative": 2}},
        "assessment": {"negative_for_user": "yes", "content_signals": [
            {"id": "harm", "evidence": "x"}, {"id": "help", "evidence": "y"},
            {"id": "other", "evidence": "z"}], "signal_polarities": {"harm": "negative", "help": "positive"}}}}
    with store.connection() as connection:
        connection.execute("INSERT INTO local_review_jobs(id,payload,status,videos,updated_at) VALUES (?,?,?,?,?)",
                           (session_id, json.dumps({"events": [event]}), "processing", json.dumps([video]), event["started_at"]))
    result = get_day("2026-10-25", store=store)
    assert result["summary"]["videos_watched"] == 1
    assert result["summary"]["warning_count"] == 1
    assert result["summary"]["positive_insight_count"] == 1
    assert result["videos"][0]["unrated_signal_count"] == 1
    assert result["videos"][0]["comment_counts"] == {"positive": 7, "neutral": 3, "negative": 2}


def test_invalid_date(tmp_path):
    store = TopicStore(tmp_path / "invalid.sqlite3")

    with pytest.raises(ValueError):
        get_day("not-a-date", store=store)


def test_live_activity_routes_validate_and_expose_new_encounters(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routes.local_sessions import router
    jobs = LocalSessions(TopicStore(tmp_path / "routes.sqlite3"))
    monkeypatch.setattr("app.services.daily_insights.LocalSessions", lambda store=None: jobs)
    app = FastAPI(); app.include_router(router)
    client = TestClient(app)
    event = {"event_id": "fresh", "video_id": "reel", "platform": "instagram",
             "sequence_number": 1, "started_at": datetime.now(timezone.utc).isoformat(), "dwell_seconds": 2}
    body = {"session_id": str(uuid4()), "events": [event]}
    assert client.put("/local-sessions/activity", json=body).status_code == 200
    recent = client.get("/local-sessions/activity/recent?timezone=America/New_York")
    assert recent.status_code == 200
    assert recent.json()["summary"]["videos_watched"] == 1
    assert client.get("/local-sessions/activity/recent?timezone=Invalid/Zone").status_code == 422
    body["events"][0]["started_at"] = "2026-10-25T12:00:00"
    assert client.put("/local-sessions/activity", json=body).status_code == 422
