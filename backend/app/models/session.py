from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class SessionCreate(BaseModel):
    user_id: str = Field(min_length=1)
    platform: str = "youtube_shorts"
    goal_minutes: int = Field(default=15, ge=1, le=240)


class VideoEvent(BaseModel):
    event_id: str = Field(min_length=1)
    video_id: str = Field(min_length=1)
    platform: Literal["youtube", "instagram"] = "youtube"
    video_session_id: str | None = Field(default=None, max_length=123)
    occurrence_id: str | None = Field(default=None, max_length=120)
    title: str = Field(default="", max_length=1000)
    caption: str = Field(default="", max_length=16000)
    sequence_number: int = Field(ge=1)
    started_at: datetime
    ended_at: datetime | None = None
    dwell_seconds: float | None = Field(default=None, ge=0)
    interest_match: int | None = Field(
        default=None, ge=1, le=5
    )

    @field_validator("started_at", "ended_at")
    @classmethod
    def require_timezone(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError("Datetime must include a timezone")
        return value

    @model_validator(mode="after")
    def video_identity(self):
        expected = ("yt_" if self.platform == "youtube" else "ig_") + self.video_id
        if self.video_session_id is not None and self.video_session_id != expected:
            raise ValueError("Video session ID does not match source/platform")
        return self


class VideoEventBatch(BaseModel):
    events: list[VideoEvent] = Field(
        min_length=1, max_length=100
    )
