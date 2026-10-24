from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Literal


class SessionCreate(BaseModel):
    user_id: str = Field(min_length=1)
    platform: str = "youtube_shorts"
    goal_minutes: int = Field(default=15, ge=1, le=240)


class VideoEvent(BaseModel):
    event_id: str = Field(min_length=1)
    video_id: str = Field(min_length=1)
    sequence_number: int = Field(ge=1)
    started_at: datetime
    ended_at: datetime | None = None
    dwell_seconds: float | None = Field(default=None, ge=0)
    interest_match: int | None = Field(
        default=None, ge=1, le=5
    )
    platform: Literal["youtube", "instagram"] = "youtube"

    @field_validator("started_at", "ended_at")
    @classmethod
    def require_timezone(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError("Datetime must include a timezone")
        return value


class VideoEventBatch(BaseModel):
    events: list[VideoEvent] = Field(
        min_length=1, max_length=100
    )
