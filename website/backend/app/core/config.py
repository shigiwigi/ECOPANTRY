"""Application settings, read from environment variables and `website/backend/.env`."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

BACKEND_DIR = Path(__file__).resolve().parents[2]

API_V1_PREFIX = "/api/v1"

# Only PostgreSQL through psycopg 3 is supported. Plain postgres URLs are mapped to it.
_DRIVER = "postgresql+psycopg"
_POSTGRES_ALIASES = {"postgres", "postgresql", _DRIVER}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "EcoPantry API"
    environment: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Required. Kept secret so it never appears in logs or reprs.
    database_url: SecretStr
    database_pool_size: int = Field(default=5, ge=1)
    database_max_overflow: int = Field(default=10, ge=0)
    database_pool_timeout: int = Field(default=10, ge=1, description="Seconds to wait for a pooled connection.")
    database_connect_timeout: int = Field(default=5, ge=1, description="Seconds to wait for PostgreSQL to accept a connection.")

    @field_validator("database_url", mode="before")
    @classmethod
    def _require_postgres(cls, value: object) -> object:
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if not isinstance(raw, str):
            return value
        try:
            url = make_url(raw)
        except ArgumentError as exc:
            raise ValueError("DATABASE_URL is not a valid database URL.") from exc
        if url.drivername not in _POSTGRES_ALIASES:
            raise ValueError(f"DATABASE_URL must be a PostgreSQL URL ({_DRIVER}://...).")
        if not url.database:
            raise ValueError("DATABASE_URL must name a database.")
        return url.set(drivername=_DRIVER).render_as_string(hide_password=False)

    @property
    def docs_enabled(self) -> bool:
        return self.environment != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # database_url comes from the environment
