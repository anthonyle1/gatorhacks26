import asyncio
import logging
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from app.config import settings
from .analyzer import ModelUnavailableError, get_analyzer
from .ollama_client import OllamaClient, OllamaError
from .video_assessment import AssessmentResult, VideoEvidence, assess_video
from .taxonomy import CONTENT_SIGNALS, SUBCATEGORIES, TAXONOMY_VERSION, NEGATIVE_CONTENT_SIGNALS, POSITIVE_CONTENT_SIGNALS
from app.youtube import YouTubeError, fetch_video_comments, parse_comments
from app.services.analysis_storage import save_roberta_analysis

router = APIRouter(prefix="/analysis", tags=["analysis"])
logger = logging.getLogger(__name__)


@router.get("/taxonomy")
def get_taxonomy():
    """Return stable topic IDs for future preference controls."""
    return {"version": TAXONOMY_VERSION,
            "categories": {parent: [f"{parent}.{child}" for child in children]
                           for parent, children in SUBCATEGORIES.items()},
            "content_signals": CONTENT_SIGNALS,
            "signal_groups": {"negative": NEGATIVE_CONTENT_SIGNALS, "positive": POSITIVE_CONTENT_SIGNALS}}


class CommentAnalysisRequest(BaseModel):
    youtube_response: dict[str, Any]
    negative_threshold: float = Field(default=0.5, gt=0, le=1)


class PromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=32000)
    system: str | None = Field(default=None, max_length=8000)


@router.post("/video-assessment", response_model=AssessmentResult)
def assess_video_metadata(body: VideoEvidence):
    """Return the same validated assessment used by the console command."""
    try:
        return assess_video(body.title, body.caption, body.sentiment_balance, comments=body.comments)
    except OllamaError as exc:
        # Log the sanitized application error, never metadata or model output.
        logger.warning("Video assessment unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.post("/prompt")
def prompt_model(body: PromptRequest):
    """Send a prompt to the configured local Ollama model."""
    try:
        return OllamaClient().prompt(body.prompt, body.system)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.get("/ollama/status")
def ollama_status():
    """Check connectivity and installation; does not load or prompt the model."""
    try:
        return OllamaClient().status()
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


def _analyze(response: dict, threshold: float) -> dict:
    try:
        comments = parse_comments(response)
        if len(comments) > 1000:
            raise ValueError("Submit at most 1000 comments including replies per request.")
        return get_analyzer().analyze(comments, threshold)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.post("/comments")
def analyze_comments(body: CommentAnalysisRequest):
    """Analyze a parsed comments.list or commentThreads.list response."""
    if not isinstance(body.youtube_response.get("items"), list):
        raise HTTPException(status_code=422, detail="YouTube response must contain an items array.")
    if len(body.youtube_response["items"]) > 1000:
        raise HTTPException(status_code=422, detail="Submit at most 1000 items per request.")
    return _analyze(body.youtube_response, body.negative_threshold)


@router.get("/videos/{video_id}")
async def analyze_video(
    video_id: Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{11}$")],
    max_comments: Annotated[int, Query(ge=1, le=1000)] = 100,
    negative_threshold: Annotated[float, Query(gt=0, le=1)] = 0.5,
):
    """Analyze video comments and save results to MongoDB."""

    if not settings.youtube_api_key:
        raise HTTPException(status_code=503, detail="YOUTUBE_API_KEY is not configured.")
    try:
        response = await run_in_threadpool(fetch_video_comments, video_id, settings.youtube_api_key, max_comments)
    except YouTubeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    result = await run_in_threadpool(_analyze, response, negative_threshold)
    result["sample"] = {
        "video_id": video_id, "order": "time", "includes_replies": False,
        "max_comments": max_comments, "has_more": bool(response.get("nextPageToken"))
    }
    try:
        async with asyncio.timeout(5):
            await save_roberta_analysis(video_id, result)
        result["storage"] = {"status": "saved"}
    except (PyMongoError, TimeoutError) as exc:
        # Preserve computed results while making persistence failure explicit.
        # Driver error text can contain infrastructure details; log only its type.
        logger.warning("Analysis storage unavailable (%s)", type(exc).__name__)
        result["storage"] = {
            "status": "unavailable",
            "detail": "Analysis completed, but saving to MongoDB could not be confirmed. Check database connectivity.",
        }
    return result
