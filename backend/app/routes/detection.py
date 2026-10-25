"""Single-local-user detection API, independent of session ingestion."""

import asyncio
import logging
from time import perf_counter
from typing import Annotated, Literal

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from analysis.pruned_detection import Match, detect, uncertain
from analysis.topic_store import TopicStore
from app.config import settings
from app.services.local_sessions import LOCAL_USER

router = APIRouter(prefix="/detection", tags=["Pruned-topic detection"])
logger = logging.getLogger(__name__)


class DetectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    platform: Literal["youtube", "instagram"]
    video_id: str = Field(min_length=1, max_length=120, pattern=r"^[\w-]+$")
    request_id: str = Field(min_length=1, max_length=120)
    blacklist_version: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=1000)
    caption: str = Field(default="", max_length=16000)
    comments: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(default_factory=list, max_length=10)


class DetectionResponse(Match):
    video_id: str
    platform: str
    request_id: str
    blacklist_version: str
    matched_topic_name: str | None
    notify: bool
    provider: Literal["groq"] = "groq"


@router.get("/state")
def detection_state():
    state = TopicStore().blacklist(LOCAL_USER)
    return {"blacklist_version": state["version"], "topic_count": len(state["topics"]),
            "configured": bool(settings.groq_api_key)}


@router.get("/topics")
def detection_topics():
    """Show the same canonical topic snapshot supplied to the detector prompt."""
    state = TopicStore().blacklist(LOCAL_USER)
    return {"blacklist_version": state["version"], "topics": state["topics"],
            "configured": bool(settings.groq_api_key)}


async def youtube_comments(video_id):
    if not settings.youtube_api_key or not settings.detection_comment_timeout_seconds:
        return []
    from app.youtube import fetch_video_comments, parse_comments
    try:
        async with asyncio.timeout(settings.detection_comment_timeout_seconds):
            data = await run_in_threadpool(fetch_video_comments, video_id, settings.youtube_api_key, 10, order="relevance")
            return [comment.text[:300] for comment in parse_comments(data)[:10]]
    except (TimeoutError, RuntimeError, ValueError, TypeError, KeyError):
        return []


@router.post("/check", response_model=DetectionResponse)
async def check_video(body: DetectionRequest):
    started = perf_counter()
    store = TopicStore()
    state = await run_in_threadpool(store.blacklist, LOCAL_USER)
    result = uncertain("Pruning preferences changed.")
    if state["version"] == body.blacklist_version:
        evidence = {"title": body.title, "caption": body.caption[:4000], "comments": body.comments}
        if state["topics"] and settings.groq_api_key and body.platform == "youtube" and not evidence["comments"]:
            evidence["comments"] = await youtube_comments(body.video_id)
        result = await detect(evidence, state["topics"])
    latest = await run_in_threadpool(store.blacklist, LOCAL_USER)
    if latest["version"] != state["version"]:
        result = uncertain("Pruning preferences changed.")
    topic = next((topic for topic in latest["topics"] if topic["id"] == result.matched_topic_id), None)
    notify = bool(topic and result.status == "MATCH" and result.confidence >= settings.detection_confidence_threshold
                  and latest["version"] == body.blacklist_version)
    logger.info("pruned_detection outcome=%s total_ms=%d", result.status, (perf_counter() - started) * 1000)
    return {**result.model_dump(), "video_id": body.video_id, "platform": body.platform,
            "request_id": body.request_id, "blacklist_version": latest["version"],
            "matched_topic_name": topic["name"] if topic else None, "notify": notify}
