"""Capture and processing are separate contracts; all clocks have explicit units."""
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator


class Occurrence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    occurrence_id: UUID
    review_session_id: UUID
    video_session_id: str = Field(pattern=r"^(yt|ig)_[A-Za-z0-9_-]{1,120}$")
    platform: Literal["youtube", "instagram"]
    source_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,120}$")
    tab_id: int = Field(ge=0)
    generation: int = Field(ge=0)
    started_at: datetime
    duration: float | None = Field(default=None, gt=0, le=86400, allow_inf_nan=False)
    capture_state: Literal["disabled", "unavailable", "capturing"] = "disabled"
    plan_version: int = Field(default=1, ge=1)

    @field_validator("started_at")
    @classmethod
    def timezone(cls, value):
        if value.utcoffset() is None:
            raise ValueError("Wall clock requires timezone")
        return value

    @model_validator(mode="after")
    def identity(self):
        if self.video_session_id != ("yt_" if self.platform == "youtube" else "ig_") + self.source_id:
            raise ValueError("Video session identity does not match platform/source")
        return self


class CaptureInterval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio_start: float = Field(ge=0, allow_inf_nan=False)
    audio_end: float = Field(gt=0, allow_inf_nan=False)
    media_start: float = Field(ge=0, allow_inf_nan=False)
    media_end: float = Field(gt=0, allow_inf_nan=False)
    wall_start: datetime
    wall_end: datetime
    playback_rate: float = Field(gt=0, le=16, allow_inf_nan=False)
    certain: bool = True

    @model_validator(mode="after")
    def clocks(self):
        if self.wall_start.utcoffset() is None or self.wall_end.utcoffset() is None:
            raise ValueError("Wall clocks require timezone")
        if self.audio_end <= self.audio_start or self.media_end <= self.media_start or self.wall_end <= self.wall_start:
            raise ValueError("Intervals must be positive")
        if (self.wall_end-self.wall_start).total_seconds() + .35 < self.audio_end-self.audio_start:
            raise ValueError("Decoded interval cannot exceed its wall-clock capture")
        if abs((self.media_end-self.media_start) - (self.audio_end-self.audio_start)*self.playback_rate) > .35:
            raise ValueError("Media interval disagrees with capture rate")
        return self


class AudioSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    segment_id: UUID
    occurrence_id: UUID
    index: int = Field(ge=0, le=10000)
    plan_version: int = Field(default=1, ge=1)
    planned_start: float = Field(ge=0, allow_inf_nan=False)
    planned_end: float = Field(gt=0, allow_inf_nan=False)
    intervals: list[CaptureInterval] = Field(min_length=1, max_length=128)
    gaps: list[Literal["pause", "buffering", "seek", "interruption", "navigation", "unknown"]] = Field(default_factory=list, max_length=128)
    encoder_delay_seconds: float = Field(default=0, ge=0, le=.2, allow_inf_nan=False)
    capture_state: Literal["captured", "partial", "uncertain"] = "captured"

    @model_validator(mode="after")
    def ordered(self):
        if self.planned_end <= self.planned_start:
            raise ValueError("Invalid plan interval")
        last = 0.
        for interval in self.intervals:
            if interval.audio_start < last:
                raise ValueError("Decoded audio intervals overlap")
            last = interval.audio_end
        return self


class EvidenceManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    occurrence_id: UUID
    segment_ids: list[UUID] = Field(default_factory=list, max_length=1000)
    capture_state: Literal["disabled", "unavailable", "captured", "partial", "uncertain"] = "unavailable"
