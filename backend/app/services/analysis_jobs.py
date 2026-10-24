import logging

from fastapi.concurrency import run_in_threadpool

from app.config import settings
from app.database import db
from app.services.analysis_storage import save_roberta_analysis
from analysis.analyzer import get_analyzer
from app.youtube import fetch_video_comments

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

    # Only one worker should claim this pending job.
    claimed = await db.video_analyses.find_one_and_update(
        {"video_id": video_id, "analysis_status": "pending"},
        {"$set": {"analysis_status": "processing"}}
    )

    if claimed is None:
        return

    try:
        if not settings.youtube_api_key:
            raise RuntimeError("YOUTUBE_API_KEY is not configured")

        # YouTube fetching is synchronous.
        response = await run_in_threadpool(
            fetch_video_comments, video_id, settings.youtube_api_key, 20
        )

        # Model inference is also synchronous.
        result = await run_in_threadpool(get_analyzer().analyze_response, response)

        # No comments means there's no sentiment to assess.
        if result["summary"]["total_comments"] == 0:
            await db.video_analyses.update_one(
                {"video_id": video_id},
                {"$set": {"analysis_status": "unavailable"}}
            )
            return

        await save_roberta_analysis(video_id, result)

        logger.info("Analysis completed for video %s", video_id)

    except Exception:
        logger.exception("Analysis failed for video %s", video_id)

        await db.video_analyses.update_one(
            {"video_id": video_id},
            {"$set": {"analysis_status": "failed"}}
        )
