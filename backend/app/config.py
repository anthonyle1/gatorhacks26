from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator

class Settings(BaseSettings):
    mongodb_uri: str = ""
    mongodb_db: str = "healthy_doomscrolling"
    youtube_api_key: str = ""

    @field_validator("mongodb_db", mode="before")
    @classmethod
    def default_database_name(cls, value):
        return value or "healthy_doomscrolling"

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()
