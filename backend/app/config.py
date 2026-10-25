from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator, Field
from typing import Literal
from app.environment import ENV_FILE

class Settings(BaseSettings):
    mongodb_uri: str = ""
    mongodb_db: str = "healthy_doomscrolling"
    youtube_api_key: str = ""
    redis_url: str = ""
    groq_api_key: str = ""
    groq_detection_model: str = "openai/gpt-oss-20b"
    detection_timeout_seconds: float = Field(default=6, gt=0, le=30)
    detection_comment_timeout_seconds: float = Field(default=0.75, ge=0, le=3)
    detection_confidence_threshold: float = Field(default=0.85, ge=0, le=1)
    analysis_cache_enabled: bool = True
    analysis_cache_ttl: int = Field(default=3600, ge=1, le=86400)
    roberta_revision: str = "3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7"
    audio_enabled: bool = True
    audio_disable_on_failure: bool = True
    audio_max_upload_bytes: int = Field(default=2_000_000, ge=1024, le=10_000_000)
    audio_max_seconds: float = Field(default=35, gt=0, le=120)
    audio_max_pending: int = Field(default=100, ge=1, le=1000)
    audio_expiry_seconds: int = Field(default=3600, ge=60, le=86400)
    audio_finalize_wait_seconds: float = Field(default=10, ge=0, le=60)
    asr_model: str = "base.en"
    asr_revision: str = "3d3d5dee26484f91867d81cb899cfcf72b96be6c"
    asr_min_speech_seconds: float = Field(default=1.5, gt=0, le=30)
    assessment_provider: Literal["navigator", "ollama", "gemma"] = "navigator"
    topic_provider: Literal["navigator", "ollama", "gemma"] = "navigator"
    navigator_toolkit_api_key: str = ""
    navigator_base_url: str = "https://api.ai.it.ufl.edu/v1"
    navigator_model: str = "gemma-4-31b-it"
    navigator_topic_model: str = ""
    navigator_response_format: Literal["auto", "json_schema", "json_object", "text"] = "auto"
    navigator_timeout: float = Field(default=45, gt=0, le=120)
    navigator_concurrency: int = Field(default=2, ge=1, le=8)
    gemma_endpoint: str = "https://api.together.xyz/v1/chat/completions"
    gemma_model: str = "google/gemma-4-31B-it"
    gemma_api_key: str = ""
    gemma_timeout: float = Field(default=45, gt=0, le=120)
    gemma_concurrency: int = Field(default=2, ge=1, le=8)
    review_video_workers: int = Field(default=2, ge=1, le=4)

    @field_validator("mongodb_db", mode="before")
    @classmethod
    def default_database_name(cls, value):
        return value or "healthy_doomscrolling"

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        extra="ignore"
    )

settings = Settings()
