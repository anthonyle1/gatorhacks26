"""MongoDB-free session review endpoints for the extension."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.session import VideoEvent
from app.models.session_categories import CategoryEdit, TopicPreference
from app.services.local_sessions import LocalSessions, LOCAL_USER, process_local_session, prefetch_occurrence
from app.models.audio import Occurrence, AudioSegment, EvidenceManifest
from app.services.audio_ingestion import AudioIngestion
from app.config import settings

router = APIRouter(prefix="/local-sessions", tags=["Local session review"])


@router.get("/health")
def local_health():
    from analysis.transcription import installation_status
    jobs = LocalSessions()
    with jobs.store.connection() as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "ok", "storage": "local", "mongodb_required": False, "audio": {"enabled": settings.audio_enabled, "asr": installation_status()}}


@router.get("/metrics")
def pipeline_metrics():
    from analysis.metrics import snapshot
    from analysis.cache import get_cache
    cache = get_cache()
    return {"timings": snapshot(), "cache": {"hits": cache.hits, "misses": cache.misses}}


@router.delete("/taxonomy")
def reset_tree():
    try:
        LocalSessions().reset_tree()
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return {"status": "reset", "tree": [], "global_video_count": 0}


@router.get("/taxonomy")
def global_tree():
    """Read the shared topic tree without requiring a review session ID."""
    return LocalSessions().store.view("global-tree", LOCAL_USER) or {
        "tree": [], "tree_videos": [], "global_video_count": 0,
        "selected_category_ids": [], "tree_scope": "global",
    }


@router.patch("/taxonomy/preferences")
def global_preference(body: TopicPreference):
    jobs = LocalSessions()
    try:
        jobs.store.set_preference(LOCAL_USER, body.category_id, body.reduce)
    except ValueError as error:
        raise HTTPException(404, str(error)) from None
    return global_tree()


class ReelEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    video_id: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=1000)
    caption: str = Field(default="", max_length=16000)
    comments: list[Annotated[str, Field(min_length=1, max_length=3000)]] = Field(default_factory=list, max_length=100)


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[VideoEvent] = Field(max_length=5000)
    instagram: list[ReelEvidence] = Field(default_factory=list, max_length=1000)
    evidence_manifest: list[EvidenceManifest] = Field(default_factory=list, max_length=5000)

    @model_validator(mode="after")
    def unique_events(self):
        if len({event.event_id for event in self.events}) != len(self.events):
            raise ValueError("Duplicate event IDs")
        if len({item.occurrence_id for item in self.evidence_manifest}) != len(self.evidence_manifest):
            raise ValueError("Duplicate manifest occurrence")
        if any(len(event.video_id) > 120 or len(event.event_id) > 120 for event in self.events):
            raise ValueError("Event identities must be at most 120 characters")
        return self


def require(jobs, session_id):
    result = jobs.view(str(session_id))
    if not result:
        raise HTTPException(404, "Local session not found")
    return result


@router.post("/{session_id}/occurrences", status_code=201)
def register_occurrence(session_id: UUID, body: Occurrence, background_tasks: BackgroundTasks):
    if session_id != body.review_session_id:
        raise HTTPException(422, "Review session identity mismatch")
    try:
        result = AudioIngestion().register(body)
        background_tasks.add_task(prefetch_occurrence, body)
        return result
    except ValueError as error:
        raise HTTPException(409, str(error)) from None


@router.get("/{session_id}/evidence")
def live_evidence(session_id: UUID):
    return AudioIngestion().progress(str(session_id))


@router.get("/{session_id}/audio-status")
def audio_status(session_id: UUID):
    return AudioIngestion().audio_status(str(session_id))


@router.put("/{session_id}/segments/{segment_id}", status_code=202)
async def ingest_segment(session_id: UUID, segment_id: UUID, request: Request):
    import json
    from pydantic import ValidationError
    if not settings.audio_enabled:
        raise HTTPException(409, "Experimental audio is disabled")
    if request.headers.get("content-type", "").split(";")[0] != "audio/mpeg":
        raise HTTPException(415, "Expected audio/mpeg")
    try:
        header = request.headers.get("x-segment-metadata", "")
        if len(header) > 32000:
            raise ValueError("Segment metadata exceeds limit")
        metadata = AudioSegment.model_validate(json.loads(header))
        if metadata.segment_id != segment_id:
            raise ValueError("Segment identity mismatch")
        audio = AudioIngestion()
        state = await run_in_threadpool(audio.audio_status, str(session_id))
        if not state["enabled"]:
            raise HTTPException(409, {"code": "AUDIO_DISABLED", "message": state["disabled_reason"]})
        with audio.store.connection() as c:
            owner = c.execute("SELECT review_id FROM audio_occurrences WHERE id=?", (str(metadata.occurrence_id),)).fetchone()
        if not owner or owner[0] != str(session_id):
            raise ValueError("Register occurrence in this review before upload")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > settings.audio_max_upload_bytes:
                raise HTTPException(413, "Audio upload exceeds limit")
        status = await run_in_threadpool(audio.accept, metadata, bytes(raw))
        return {"segment_id": str(segment_id), "processing_state": status}
    except (ValueError, ValidationError, KeyError):
        raise HTTPException(409, "Invalid or conflicting segment evidence") from None
    except (ImportError, RuntimeError):
        if settings.audio_disable_on_failure:
            await run_in_threadpool(AudioIngestion().disable_audio, str(session_id), "Audio decoder is unavailable; continuing with metadata and comments.")
        raise HTTPException(503, "Audio decoder unavailable; install audio requirements") from None


@router.post("/{session_id}/finish", status_code=202)
async def finish(session_id: UUID, body: Snapshot, background_tasks: BackgroundTasks):
    import asyncio
    from time import monotonic
    jobs = LocalSessions()
    # Give expected uploads and accepted inference the same bounded cutoff window.
    ids = [str(segment) for entry in body.evidence_manifest for segment in entry.segment_ids]
    deadline = monotonic() + settings.audio_finalize_wait_seconds
    def processing():
        if not ids:
            return False
        with jobs.store.connection() as c:
            for identity in ids:
                row = c.execute("SELECT status FROM audio_segments WHERE id=?", (identity,)).fetchone()
                if row is None or row[0] in {"queued", "processing"}:
                    return True
            return False
    while ids and monotonic() < deadline and await run_in_threadpool(processing):
        await asyncio.sleep(.1)
    try:
        await run_in_threadpool(jobs.enqueue, str(session_id), body.model_dump(mode="json"))
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    background_tasks.add_task(process_local_session, str(session_id))
    return {"session_id": str(session_id), "status": jobs.get(str(session_id))["status"], "storage": "local"}


@router.get("/{session_id}/taxonomy")
def review(session_id: UUID):
    return require(LocalSessions(), session_id)


@router.post("/{session_id}/taxonomy/retry", status_code=202)
def retry(session_id: UUID, background_tasks: BackgroundTasks):
    jobs = LocalSessions()
    require(jobs, session_id)
    if not jobs.retry(str(session_id)):
        raise HTTPException(409, "Only failed or partial reviews can be retried")
    background_tasks.add_task(process_local_session, str(session_id))
    return {"session_id": str(session_id), "status": "pending"}


@router.patch("/{session_id}/taxonomy/preferences")
def preference(session_id: UUID, body: TopicPreference):
    jobs = LocalSessions()
    require(jobs, session_id)
    try:
        jobs.store.set_preference(LOCAL_USER, body.category_id, body.reduce)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return jobs.view(str(session_id))


@router.patch("/{session_id}/taxonomy/categories/{category_id}")
def edit(session_id: UUID, category_id: str, body: CategoryEdit):
    jobs = LocalSessions()
    require(jobs, session_id)
    try:
        jobs.store.edit_category(LOCAL_USER, category_id, **body.model_dump())
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return jobs.view(str(session_id))
