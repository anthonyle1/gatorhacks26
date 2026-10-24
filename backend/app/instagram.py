import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from analysis.analyzer import get_analyzer
from app.youtube import Comment
from app.database import db
from app.services.analysis_storage import save_roberta_analysis

router = APIRouter(prefix="/instagram", tags=["Instagram"])

logger = logging.getLogger(__name__)


class InstagramComments(BaseModel):
    video_id: str = Field(min_length=1, max_length=200)
    platform: Literal["instagram"]
    comments: list[str] = Field(min_length=1, max_length=10)


def instagram_analysis_id(video_id: str) -> str:
    """Prevent Instagram and YouTube video ID collisions."""
    return f"instagram:{video_id}"


async def analyze_instagram_comments(video_id: str, comments: list[str]):
    """
    Run the existing RoBERTa model on an Instagram
    comment sample and persist the result.
    """

    analysis_id = instagram_analysis_id(video_id)

    try:
        # The existing model expects Comment objects,
        # not plain strings.
        parsed_comments = [
            Comment(
                id=f"{video_id}:{index}",
                text=text
            )
            for index, text in enumerate(comments)
        ]

        # Inference is synchronous and CPU-intensive.
        # Run it in FastAPI's thread pool.
        result = await run_in_threadpool(get_analyzer().analyze, parsed_comments)

        await save_roberta_analysis(analysis_id, result)

        logger.info("Instagram RoBERTa analysis saved for %s", video_id)

    except Exception:
        logger.exception("Instagram sentiment analysis failed for %s", video_id)

        # Record failure without discarding raw comments.
        try:
            await db.video_analyses.update_one(
                {"video_id": analysis_id},
                {
                    "$set": {"analysis_status": "failed"},
                    "$setOnInsert": {"video_id": analysis_id}
                },
                upsert=True
            )
        except PyMongoError:
            logger.exception("Could not record Instagram analysis failure")


@router.post("/comments")
async def receive_instagram_comments(data: InstagramComments, background_tasks: BackgroundTasks):
    cleaned = []
    seen = set()

    for comment in data.comments:
        text = comment.strip()[:1000]

        if text and text not in seen:
            cleaned.append(text)
            seen.add(text)

    if not cleaned:
        raise HTTPException(status_code=422, detail="No valid comments provided")

    document = {"video_id": data.video_id, "platform": "instagram", "comments": cleaned,
        "comment_count": len(cleaned), "collected_at": datetime.now(timezone.utc)}

    try:
        previous = await db.instagram_comments.find_one(
            {"video_id": data.video_id}, {"_id": 0, "comments": 1})

        await db.instagram_comments.update_one(
            {"video_id": data.video_id},
            {"$set": document},
            upsert=True
        )

        analysis_id = instagram_analysis_id(data.video_id)

        saved_analysis = await db.video_analyses.find_one(
            {"video_id": analysis_id}, {"_id": 0, "model_results.roberta": 1})

    except PyMongoError:
        raise HTTPException(
            status_code=503, detail="Could not save Instagram comments"
        ) from None

    # Don't rerun the model if the sample is identical
    # and RoBERTa already has a saved result.
    unchanged = (
        previous is not None
        and previous.get("comments") == cleaned
    )

    already_analyzed = bool(
        saved_analysis and saved_analysis.get("model_results", {}).get("roberta")
    )

    should_analyze = (
        not unchanged or not already_analyzed
    )

    if should_analyze:
        background_tasks.add_task(
            analyze_instagram_comments, data.video_id, cleaned
        )

    return {
        "success": True, "video_id": data.video_id, "comment_count": len(cleaned),
        "saved": True, "analysis_id": analysis_id, "analysis_queued": should_analyze
    }


@router.get("/comments/{video_id}")
async def get_instagram_comments(video_id: str):
    document = await db.instagram_comments.find_one({"video_id": video_id}, {"_id": 0})

    if document is None:
        raise HTTPException( status_code=404, detail="Instagram comments not found")

    return document
