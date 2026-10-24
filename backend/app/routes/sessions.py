from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pymongo import UpdateOne

from app.database import db
from app.models.session import (
    SessionCreate,
    VideoEventBatch
)

router = APIRouter(
    prefix="/sessions",
    tags=["Sessions"]
)


def utc_now():
    return datetime.now(timezone.utc)


@router.post("", status_code=201)
async def create_session(payload: SessionCreate):
    # Ensure that the user exists.
    user = await db.users.find_one({
        "user_id": payload.user_id
    })

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

    return {
        "session_id": session_id,
        "status": "active"
    }


@router.post("/{session_id}/events")
async def save_video_events(
    session_id: str,
    payload: VideoEventBatch
):
    session = await db.sessions.find_one({
        "session_id": session_id
    })

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Session not found"
        )

    if session["status"] != "active":
        raise HTTPException(
            status_code=409,
            detail="Session already completed"
        )

    documents = []

    for event in payload.events:
        document = event.model_dump()
        document["session_id"] = session_id
        documents.append(document)

    ids = [doc["event_id"] for doc in documents]

    if len(ids) != len(set(ids)):
        raise HTTPException(
            status_code=422,
            detail="Duplicate event IDs in request"
        )

    # Never overwrite another session's event.
    existing = await db.video_events.find(
        {"event_id": {"$in": ids}},
        {"_id": 0, "event_id": 1, "session_id": 1}
    ).to_list(length=len(ids))

    if any(
        doc["session_id"] != session_id
        for doc in existing
    ):
        raise HTTPException(
            status_code=409,
            detail="Event ID belongs to another session"
        )

    operations = [
        UpdateOne(
            {"event_id": doc["event_id"]},
            {"$setOnInsert": doc},
            upsert=True
        )
        for doc in documents
    ]

    result = await db.video_events.bulk_write(
        operations,
        ordered=True
    )

    return {
        "session_id": session_id,
        "saved_events": result.upserted_count,
        "already_existed": (
            len(documents) - result.upserted_count
        )
    }


@router.get("/{session_id}")
async def get_session(session_id: str):
    session = await db.sessions.find_one(
        {"session_id": session_id},
        {"_id": 0}
    )

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Session not found"
        )

    events = await db.video_events.find(
        {"session_id": session_id},
        {"_id": 0}
    ).sort(
        "sequence_number", 1
    ).to_list(length=1000)

    return {
        "session": session,
        "video_events": events
    }


@router.patch("/{session_id}/finish")
async def finish_session(session_id: str):
    result = await db.sessions.update_one(
        {
            "session_id": session_id,
            "status": "active"
        },
        {
            "$set": {
                "ended_at": utc_now(),
                "status": "completed"
            }
        }
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Active session not found"
        )

    return {
        "session_id": session_id,
        "status": "completed"
    }
