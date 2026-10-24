import logging

from fastapi.concurrency import run_in_threadpool

from app.config import settings
from app.database import db
from app.services.analysis_storage import save_roberta_analysis
from analysis.analyzer import get_analyzer
from app.youtube import fetch_video_comments, fetch_video_metadata, YouTubeError

logger = logging.getLogger(__name__)


async def queue_video_analysis(video_id: str):
    """
    Register a video for analysis if it has never
    been analyzed before.
    """
    result = await db.video_analyses.update_one(
        {"video_id": video_id},
        {"$setOnInsert": {"video_id": video_id, "analysis_status": "pending"}},
        upsert=True
    )

    return result.upserted_id is not None


async def process_video_analysis(video_id: str):
    """
    Claim a pending video, run RoBERTa,
    and store the results in MongoDB.
    """

    try:
        # A database failure while claiming a background job must be handled
        # here: the event-upload HTTP response may already have been sent.
        claimed = await db.video_analyses.find_one_and_update(
            {"video_id": video_id, "analysis_status": "pending"},
            {"$set": {"analysis_status": "processing"}}
        )
        if claimed is None:
            return
        if not settings.youtube_api_key:
            raise RuntimeError("YOUTUBE_API_KEY is not configured")

        metadata = await run_in_threadpool(fetch_video_metadata, video_id, settings.youtube_api_key)
        await db.video_analyses.update_one({"video_id": video_id}, {"$set": {"metadata": metadata, "platform": "youtube"}})

        # YouTube fetching is synchronous.
        try:
            response = await run_in_threadpool(fetch_video_comments, video_id, settings.youtube_api_key, 20)
        except YouTubeError:
            # Metadata can still support session topics when comments are disabled.
            response = {"items": []}

        # Model inference is also synchronous.
        result = await run_in_threadpool(get_analyzer().analyze_response, response)

        await save_roberta_analysis(video_id, result)

        logger.info("Analysis completed for video %s", video_id)

    except Exception:
        logger.exception("Analysis failed for video %s", video_id)

        try:
            await db.video_analyses.update_one(
                {"video_id": video_id},
                {"$set": {"analysis_status": "failed"}}
            )
        except Exception:
            logger.warning("Could not record failed analysis job status")
