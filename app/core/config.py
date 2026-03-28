"""Application settings."""

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="NICE_API_MANAGER_",
        extra="ignore",
    )

    app_name: str = "NiceApiManager API"
    app_env: str = "development"
    api_v1_prefix: str = "/api"
    database_url: str = "sqlite:///./data/niceapimanager.db"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])
    request_timeout: float = 20.0
    sync_verify_ssl: bool = True
    scheduler_timezone: str = "Asia/Shanghai"
    auth_password: str = "change-this-password"
    auth_secret_key: str = "change-this-secret-key"
    auth_session_days: int = 30

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str] | None) -> list[str]:
        """Support both JSON arrays and comma-separated origin lists."""
        if isinstance(value, list):
            return value
        if not value:
            return ["*"]
        return [item.strip() for item in value.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings instance."""
    return Settings()
