"""Legacy MongoDB-backed Reel evidence; local extension reviews use snapshots."""

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from app.database import db
from app.youtube import Comment
from app.services.analysis_storage import save_roberta_analysis
from analysis.analyzer import get_analyzer, ModelUnavailableError

router = APIRouter(prefix="/instagram", tags=["Instagram"])


class InstagramComments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    video_id: str = Field(min_length=1, max_length=120)
    platform: Literal["instagram"] = "instagram"
    title: str = Field(default="", max_length=1000)
    caption: str = Field(default="", max_length=16000)
    comments: list[Annotated[str, Field(min_length=1, max_length=3000)]] = Field(max_length=100)


def instagram_analysis_id(video_id: str) -> str:
    """Keep cached Instagram sentiment separate from YouTube video identities."""
    return f"instagram:{video_id}"


async def analyze_instagram_comments(video_id: str, comments: list[str]):
    result = await run_in_threadpool(get_analyzer().analyze,
        [Comment(id=f"{video_id}:{index}", text=text) for index, text in enumerate(comments)])
    await save_roberta_analysis(instagram_analysis_id(video_id), result)
    return result


@router.post("/comments")
async def receive_instagram_comments(data: InstagramComments):
    comments = list(dict.fromkeys(text.strip() for text in data.comments if text.strip()))
    if data.comments and not comments:
        raise HTTPException(422, "No valid comments provided")
    collection = db.instagram_evidence
    previous = await collection.find_one({"video_id": data.video_id}) or {}
    evidence = {"metadata": {"title": data.title, "caption": data.caption}, "platform": "instagram",
                "comments": comments, "received_at": datetime.now(timezone.utc)}
    if previous.get("comments") == comments and previous.get("model_results"):
        evidence["model_results"] = previous["model_results"]
    else:
        try:
            result = await analyze_instagram_comments(data.video_id, comments)
            evidence["model_results"] = {"roberta": {"summary": result["summary"],
                "comments": [{"text": row["text"][:300], "sentiment": row["sentiment"], "confidence": row["confidence"]}
                             for row in result["comments"][:12]]}}
        except ModelUnavailableError:
            evidence["model_results"] = {}
    await collection.update_one({"video_id": data.video_id}, {"$set": evidence}, upsert=True)
    return {"success": True, "saved": True, "video_id": data.video_id, "comment_count": len(comments),
            "analysis_id": instagram_analysis_id(data.video_id),
            "sentiment_available": bool(evidence["model_results"])}


@router.get("/comments/{video_id}")
async def get_instagram_comments(video_id: str):
    document = await db.instagram_evidence.find_one({"video_id": video_id}, {"_id": 0})
    if document is None:
        document = await db.instagram_comments.find_one({"video_id": video_id}, {"_id": 0})
    if document is None:
        raise HTTPException(404, "Instagram comments not found")
    return document
