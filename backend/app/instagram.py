"""Persist bounded Reel evidence and sentiment for later session classification."""

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from app.database import db
from app.youtube import Comment
from analysis.analyzer import get_analyzer, ModelUnavailableError

router = APIRouter(prefix="/instagram", tags=["Instagram"])


class InstagramComments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    video_id: str = Field(min_length=1, max_length=120)
    platform: Literal["instagram"] = "instagram"
    title: str = Field(default="", max_length=1000)
    caption: str = Field(default="", max_length=16000)
    comments: list[Annotated[str, Field(min_length=1, max_length=3000)]] = Field(max_length=100)


@router.post("/comments")
async def receive_instagram_comments(data: InstagramComments):
    collection = db.instagram_evidence
    previous = await collection.find_one({"video_id": data.video_id}) or {}
    evidence = {"metadata": {"title": data.title, "caption": data.caption},
                "comments": data.comments, "received_at": datetime.now(timezone.utc)}
    if previous.get("comments") == data.comments and previous.get("model_results"):
        evidence["model_results"] = previous["model_results"]
    else:
        try:
            result = await run_in_threadpool(get_analyzer().analyze,
                [Comment(id=None, text=text) for text in data.comments])
            evidence["model_results"] = {"roberta": {"summary": result["summary"],
                "comments": [{"text": row["text"][:300], "sentiment": row["sentiment"], "confidence": row["confidence"]}
                             for row in result["comments"][:12]]}}
        except ModelUnavailableError:
            # Raw evidence still supports later review; no invented sentiment.
            evidence["model_results"] = {}
    await collection.update_one({"video_id": data.video_id}, {"$set": evidence}, upsert=True)
    return {"success": True, "video_id": data.video_id, "comment_count": len(data.comments),
            "sentiment_available": bool(evidence["model_results"])}
