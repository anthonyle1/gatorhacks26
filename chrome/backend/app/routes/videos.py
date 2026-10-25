from fastapi import APIRouter, HTTPException
from app.services.analysis_storage import get_saved_analysis

router = APIRouter(prefix="/videos", tags=["Videos"])


@router.get("/{video_id}/stored-analysis")
async def get_video_analysis(video_id: str):
    """
    Retrieve previously saved analysis results.

    Does not run any ML models.
    """

    analysis = await get_saved_analysis(video_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="No saved analysis found for this video"
        )

    return analysis
