from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from app.database import db

router = APIRouter(prefix="/instagram", tags=["Instagram"])


class InstagramComments(BaseModel):
    video_id: str = Field(min_length=1, max_length=200)
    platform: Literal["instagram"]
    comments: list[str] = Field(min_length=1, max_length=10)


@router.post("/comments")
async def receive_instagram_comments(
    data: InstagramComments
):
    # Remove empty or duplicate comments.
    cleaned = []
    seen = set()

    for comment in data.comments:
        text = comment.strip()

        if not text: continue

        # Keep the stored sample bounded.
        text = text[:1000]

        if text not in seen:
            cleaned.append(text)
            seen.add(text)

    if not cleaned:
        raise HTTPException(status_code=422, detail="No valid comments provided")

    document = {"video_id": data.video_id, "platform": "instagram", "comments": cleaned,
        "comment_count": len(cleaned), "collected_at": datetime.now(timezone.utc)}

    try:
        await db.instagram_comments.update_one(
            {"video_id": data.video_id},
            {"$set": document},
            upsert=True
        )
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not save Instagram comments") from None

    return {"success": True, "video_id": data.video_id, "comment_count": len(cleaned), "saved": True
    }


@router.get("/comments/{video_id}")
async def get_instagram_comments(
    video_id: str
):
    document = await db.instagram_comments.find_one({"video_id": video_id}, {"_id": 0})

    if document is None:
        raise HTTPException(status_code=404, detail="Instagram comments not found")

    return document
