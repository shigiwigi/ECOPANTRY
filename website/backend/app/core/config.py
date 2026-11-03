"""Application settings, read from environment variables and `website/backend/.env`."""

from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
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

    # Staff sessions. Defaults cover one shift; see docs/AUTH_DESIGN.md.
    session_idle_timeout_minutes: int = Field(default=60, ge=1, le=24 * 60)
    session_absolute_timeout_hours: int = Field(default=12, ge=1, le=7 * 24)
    # None means "Secure only in production". Production refuses False (see below).
    session_cookie_secure: bool | None = None
    login_max_failed_attempts: int = Field(default=5, ge=1, le=100)
    login_lockout_minutes: int = Field(default=15, ge=1, le=24 * 60)

    @model_validator(mode="after")
    def _production_cookies_are_secure(self) -> "Settings":
        if self.environment == "production" and self.session_cookie_secure is False:
            raise ValueError("SESSION_COOKIE_SECURE can't be false in production; sessions need HTTPS.")
        return self

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

    @property
    def cookie_secure(self) -> bool:
        if self.session_cookie_secure is None:
            return self.environment == "production"
        return self.session_cookie_secure

    @property
    def session_cookie_name(self) -> str:
        # The __Host- prefix makes browsers reject the cookie unless it is Secure, host-only and Path=/.
        return "__Host-ecopantry_session" if self.cookie_secure else "ecopantry_session"

    @property
    def session_idle_timeout(self) -> timedelta:
        return timedelta(minutes=self.session_idle_timeout_minutes)

    @property
    def session_absolute_timeout(self) -> timedelta:
        return timedelta(hours=self.session_absolute_timeout_hours)

    @property
    def login_lockout(self) -> timedelta:
        return timedelta(minutes=self.login_lockout_minutes)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # database_url comes from the environment
