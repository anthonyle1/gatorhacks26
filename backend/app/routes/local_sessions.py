"""MongoDB-free session review endpoints for the extension."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.session import VideoEvent
from app.models.session_categories import CategoryEdit, TopicPreference
from app.services.local_sessions import LocalSessions, LOCAL_USER, process_local_session

router = APIRouter(prefix="/local-sessions", tags=["Local session review"])


@router.get("/health")
def local_health():
    jobs = LocalSessions()
    with jobs.store.connection() as connection:
        connection.execute("SELECT 1").fetchone()
    return {"status": "ok", "storage": "local", "mongodb_required": False}


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

    @model_validator(mode="after")
    def unique_events(self):
        if len({event.event_id for event in self.events}) != len(self.events):
            raise ValueError("Duplicate event IDs")
        if any(len(event.video_id) > 120 or len(event.event_id) > 120 for event in self.events):
            raise ValueError("Event identities must be at most 120 characters")
        return self


def require(jobs, session_id):
    result = jobs.view(str(session_id))
    if not result:
        raise HTTPException(404, "Local session not found")
    return result


@router.post("/{session_id}/finish", status_code=202)
def finish(session_id: UUID, body: Snapshot, background_tasks: BackgroundTasks):
    jobs = LocalSessions()
    try:
        jobs.enqueue(str(session_id), body.model_dump(mode="json"))
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
