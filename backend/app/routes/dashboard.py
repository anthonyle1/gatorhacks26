from fastapi import APIRouter, HTTPException, Query

from app.database import db

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"]
)


def get_platform(event: dict, session: dict) -> str:
    """Determine the platform for newer and older events."""
    platform = event.get("platform")

    if platform in ("youtube", "instagram"): return platform

    session_platform = session.get("platform", "")

    if session_platform == "instagram_reels": return "instagram"

    return "youtube"


def get_analysis_id(video_id: str, platform: str) -> str:
    """Instagram analyses use namespaced IDs."""
    if platform == "instagram": return f"instagram:{video_id}"

    return video_id


async def load_user_history(user_id: str) -> list[dict]:
    """
    Load a user's sessions, video events, and
    available cached analysis results.
    """

    sessions = await db.sessions.find({"user_id": user_id}, {"_id": 0}).to_list(length=None)

    if not sessions: return []

    session_map = {session["session_id"]: session for session in sessions}

    session_ids = list(session_map.keys())

    events = await db.video_events.find({"session_id": {"$in": session_ids}},{"_id": 0}
    ).sort("started_at", -1).to_list(length=None)

    if not events: return []

    analysis_ids = set()

    for event in events:
        session = session_map[event["session_id"]]
        platform = get_platform(event, session)

        analysis_ids.add(get_analysis_id(event["video_id"], platform))

    analyses = await db.video_analyses.find({"video_id": {"$in": list(analysis_ids)}}, {"_id": 0}).to_list(length=None)

    analysis_map = {analysis["video_id"]: analysis for analysis in analyses}

    history = []

    for event in events:
        session = session_map[event["session_id"]]
        platform = get_platform(event, session)

        analysis_id = get_analysis_id(event["video_id"], platform)

        analysis = analysis_map.get(analysis_id)

        history.append({
            "event_id": event["event_id"],
            "session_id": event["session_id"],
            "video_id": event["video_id"],
            "platform": platform,
            "started_at": event.get("started_at"),
            "ended_at": event.get("ended_at"),
            "dwell_seconds": event.get("dwell_seconds"),
            "interest_match": event.get("interest_match"),
            "analysis": analysis
        })

    return history


@router.get("/{user_id}")
async def get_dashboard(user_id: str):
    """Return a user's aggregate scrolling statistics."""

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    sessions = await db.sessions.find({"user_id": user_id}, {"_id": 0}).to_list(length=None)

    history = await load_user_history(user_id)

    total_videos = len(history)

    total_watch_seconds = sum(event["dwell_seconds"] or 0 for event in history)

    platform_breakdown = {
        "youtube": sum(event["platform"] == "youtube" for event in history),
        "instagram": sum(event["platform"] == "instagram" for event in history)
    }

    # Count analysis status per unique video,
    # not once per viewing event.
    unique_analyses = {}

    for event in history:
        analysis_id = get_analysis_id(event["video_id"], event["platform"])

        unique_analyses[analysis_id] = event["analysis"]

    analysis_status = {
        "complete": 0,
        "pending": 0,
        "processing": 0,
        "failed": 0,
        "unavailable": 0,
        "not_analyzed": 0
    }

    sentiments = []

    for analysis in unique_analyses.values():
        if analysis is None:
            analysis_status["not_analyzed"] += 1
            continue

        status = analysis.get("analysis_status", "not_analyzed")

        if status not in analysis_status: status = "not_analyzed"

        analysis_status[status] += 1

        roberta = analysis.get("model_results", {}).get("roberta")

        if roberta and roberta.get("sentiment"): sentiments.append(roberta["sentiment"])

    average_sentiment = None

    if sentiments:
        count = len(sentiments)

        average_sentiment = {
            "positive_ratio": sum(item["positive_ratio"] for item in sentiments) / count,
            "neutral_ratio": sum(item["neutral_ratio"]for item in sentiments) / count,
            "negative_ratio": sum(item["negative_ratio"] for item in sentiments) / count
        }

    return {
        "user_id": user_id,
        "total_watch_seconds": round(
            total_watch_seconds, 2
        ),
        "total_watch_minutes": round(
            total_watch_seconds / 60, 2
        ),
        "total_videos": total_videos,
        "unique_videos": len(unique_analyses),
        "session_count": len(sessions),
        "average_dwell_seconds": round(
            total_watch_seconds / total_videos, 2
        ) if total_videos else 0,
        "platform_breakdown": platform_breakdown,
        "analysis_status": analysis_status,
        "average_sentiment": average_sentiment
    }


@router.get("/{user_id}/history")
async def get_dashboard_history(user_id: str, limit: int = Query(default=50, ge=1, le=500)):
    """Return recent viewing events and their saved analysis."""

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    history = await load_user_history(user_id)

    return {
        "user_id": user_id,
        "total_events": len(history),
        "limit": limit,
        "history": history[:limit]
    }
