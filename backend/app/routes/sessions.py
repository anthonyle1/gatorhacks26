from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pymongo import UpdateOne

from app.database import db
from app.models.session import (SessionCreate, VideoEventBatch)
from app.services.analysis_jobs import (queue_video_analysis, process_video_analysis)
from app.services.session_analysis import process_session_analysis
from analysis.topic_store import TopicStore
from fastapi.concurrency import run_in_threadpool
from app.models.session_categories import CategoryEdit, TopicPreference

router = APIRouter(prefix="/sessions", tags=["Sessions"])


def utc_now():
    return datetime.now(timezone.utc)


@router.post("", status_code=201)
async def create_session(payload: SessionCreate):
    # Ensure that the user exists.
    user = await db.users.find_one({"user_id": payload.user_id})

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    session_id = str(uuid4())

    document = {
        "session_id": session_id,
        "user_id": payload.user_id,
        "platform": payload.platform,
        "started_at": utc_now(),
        "ended_at": None,
        "goal_minutes": payload.goal_minutes,
        "status": "active"
    }

    await db.sessions.insert_one(document)

    return {"session_id": session_id, "status": "active"}


@router.post("/{session_id}/events")
async def save_video_events(session_id: str, payload: VideoEventBatch, background_tasks: BackgroundTasks):
    session = await db.sessions.find_one({"session_id": session_id})

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["status"] != "active":
        raise HTTPException(status_code=409, detail="Session already completed")

    documents = []

    for event in payload.events:
        document = event.model_dump()
        document["session_id"] = session_id
        documents.append(document)

    ids = [doc["event_id"] for doc in documents]

    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Duplicate event IDs in request")

    # Never overwrite another session's event.
    existing = await db.video_events.find(
        {"event_id": {"$in": ids}},
        {"_id": 0, "event_id": 1, "session_id": 1}
    ).to_list(length=len(ids))

    if any(doc["session_id"] != session_id for doc in existing):
        raise HTTPException(status_code=409, detail="Event ID belongs to another session")

    operations = [
        UpdateOne({"event_id": doc["event_id"]}, {"$setOnInsert": doc}, upsert=True)
        for doc in documents
    ]

    result = await db.video_events.bulk_write(operations, ordered=True)

    # Queue analysis for newly encountered videos.
    video_ids = {event["video_id"] for event in documents if event.get("platform", "youtube") == "youtube"}

    queued_count = 0

    for video_id in video_ids: 
        is_new = await queue_video_analysis(video_id)
        if is_new:
            background_tasks.add_task(process_video_analysis, video_id)
            queued_count += 1

    return {
        "session_id": session_id,
        "saved_events": result.upserted_count,
        "already_existed": (len(documents) - result.upserted_count),
        "analyses_queued": queued_count
    }


@router.get("/{session_id}")
async def get_session(session_id: str):
    session = await db.sessions.find_one({"session_id": session_id}, {"_id": 0})

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    events = await db.video_events.find({"session_id": session_id},{"_id": 0}
    ).sort("sequence_number", 1).to_list(length=1000)

    return {"session": session, "video_events": events}


@router.patch("/{session_id}/finish")
async def finish_session(session_id: str, background_tasks: BackgroundTasks):
    session = await require_session(session_id)
    if session["status"] == "active":
        result = await db.sessions.update_one(
            {"session_id": session_id, "status": "active"},
            {"$set": {"ended_at": utc_now(), "status": "completed", "taxonomy_status": "pending"}})
    elif session.get("taxonomy_status") is None:
        result = await db.sessions.update_one(
            {"session_id": session_id, "status": "completed", "taxonomy_status": {"$exists": False}},
            {"$set": {"taxonomy_status": "pending"}})
    else:
        return {"session_id": session_id, "status": "completed", "taxonomy_status": session["taxonomy_status"]}
    if result.matched_count:
        background_tasks.add_task(process_session_analysis, session_id)
    return {"session_id": session_id, "status": "completed", "taxonomy_status": "pending"}


async def require_session(session_id, *, completed=False):
    session = await db.sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    if completed and session["status"] != "completed":
        raise HTTPException(409, "Finish the scrolling session before topic classification")
    return session


@router.get("/{session_id}/taxonomy")
async def session_taxonomy(session_id: str):
    session = await require_session(session_id, completed=True)
    result = await run_in_threadpool(TopicStore().view, session_id, session["user_id"])
    if result and session.get("taxonomy_status"):
        result["status"] = session["taxonomy_status"]
        if session.get("taxonomy_error"):
            result["detail"] = session["taxonomy_error"]
    return result or {"session_id": session_id, "status": session.get("taxonomy_status", "pending"),
                      "tree": [], "videos": [], "errors": [], "fallback_used": False,
                      "detail": session.get("taxonomy_error")}


@router.post("/{session_id}/taxonomy/retry", status_code=202)
async def retry_taxonomy(session_id: str, background_tasks: BackgroundTasks):
    await require_session(session_id, completed=True)
    result = await db.sessions.update_one(
        {"session_id": session_id, "taxonomy_status": {"$in": ["failed", "partial"]}},
        {"$set": {"taxonomy_status": "pending"}, "$unset": {"taxonomy_error": ""}})
    if not result.matched_count:
        raise HTTPException(409, "Only failed or partial session classifications can be retried")
    background_tasks.add_task(process_session_analysis, session_id)
    return {"session_id": session_id, "taxonomy_status": "pending"}


@router.patch("/{session_id}/taxonomy/preferences")
async def topic_preference(session_id: str, body: TopicPreference):
    session = await require_session(session_id, completed=True)
    store = TopicStore()
    try:
        await run_in_threadpool(store.set_preference, session["user_id"], body.category_id, body.reduce)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return await run_in_threadpool(store.view, session_id, session["user_id"])


@router.patch("/{session_id}/taxonomy/categories/{category_id}")
async def edit_topic(session_id: str, category_id: str, body: CategoryEdit):
    session = await require_session(session_id, completed=True)
    store = TopicStore()
    try:
        await run_in_threadpool(store.edit_category, session["user_id"], category_id, **body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return await run_in_threadpool(store.view, session_id, session["user_id"])
