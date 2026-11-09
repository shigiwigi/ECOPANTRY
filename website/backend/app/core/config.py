"""Application settings, read from environment variables and `website/backend/.env`."""

from datetime import timedelta
from functools import lru_cache
from pathlib import Path
import json
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

BACKEND_DIR = Path(__file__).resolve().parents[2]

API_V1_PREFIX = "/api/v1"

# Only PostgreSQL through psycopg 3 is supported. Plain postgres URLs are mapped to it.
_DRIVER = "postgresql+psycopg"
_POSTGRES_ALIASES = {"postgres", "postgresql", _DRIVER}

# Firebase project IDs: lower-case letters, digits and hyphens.
_FIREBASE_PROJECT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{3,38}[a-z0-9]$")


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

    # Browser origins allowed to call the API with the session cookie (CORS with credentials).
    # Exact origins only (scheme://host[:port]); never "*". Production sets the Firebase Hosting
    # origins in render.yaml. In .env: comma-separated, or a JSON list.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    # Firebase project whose ID tokens POST /auth/google accepts. Not a secret. Set it empty to
    # turn Google sign-in off (the endpoint then answers 503); password sign-in is unaffected.
    firebase_project_id: str | None = "ecopantry-a7342"

    # Sensor stations (see docs/HARDWARE_INTEGRATION.md). A station only uploads during a live
    # session, so an idle station sends nothing and Render and Neon can sleep.
    live_session_minutes: int = Field(default=15, ge=1, le=240, description="Session length after an authorised card tap.")
    device_boot_session_minutes: int = Field(default=5, ge=1, le=60, description="Session length after the station powers on.")
    device_daily_live_minutes: int = Field(default=240, ge=1, le=24 * 60, description="Live time a station may use per UTC day.")
    device_report_interval_seconds: int = Field(default=3, ge=2, le=3600, description="How often a live station uploads.")
    device_min_report_interval_seconds: int = Field(default=2, ge=1, le=3600, description="Uploads closer together get 429.")

    @model_validator(mode="after")
    def _production_cookies_are_secure(self) -> "Settings":
        if self.environment == "production" and self.session_cookie_secure is False:
            raise ValueError("SESSION_COOKIE_SECURE can't be false in production; sessions need HTTPS.")
        return self

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [part.strip() for part in text.split(",") if part.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _exact_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            parts = urlsplit(origin)
            if (
                "*" in origin
                or parts.scheme not in ("http", "https")
                or not parts.hostname
                or parts.path
                or parts.query
                or parts.fragment
                or parts.username
            ):
                raise ValueError(f"CORS_ORIGINS must be exact origins like https://example.com, not {origin!r}.")
        return origins

    @field_validator("firebase_project_id", mode="before")
    @classmethod
    def _empty_project_is_none(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            if not _FIREBASE_PROJECT_ID.match(value):
                raise ValueError("FIREBASE_PROJECT_ID must be a Firebase project ID such as my-project-1234.")
        return value

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
    def google_sign_in_enabled(self) -> bool:
        return self.firebase_project_id is not None

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
