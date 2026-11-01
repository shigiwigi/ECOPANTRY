from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.factory import create_app

# Nothing listens on port 1, so connections are refused immediately.
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://unit_user:unit_password@127.0.0.1:1/ecopantry_unit"


def make_settings(**overrides: object) -> Settings:
    """Settings that ignore the local .env file, for tests that must not depend on it."""
    values: dict[str, object] = {
        "environment": "test",
        "database_url": UNREACHABLE_DATABASE_URL,
        "database_connect_timeout": 1,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@pytest.fixture
def app() -> FastAPI:
    """An app whose database is unreachable. Fine for anything that doesn't need PostgreSQL."""
    return create_app(make_settings())


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def database_settings() -> Settings:
    """Settings for the real PostgreSQL from compose.yaml (DATABASE_URL from the environment or .env)."""
    try:
        return Settings(environment="test")  # type: ignore[call-arg]
    except ValidationError as exc:
        pytest.fail(
            "Integration tests need DATABASE_URL (see website/backend/README.md), "
            f"or skip them with: pytest -m 'not integration'\n{exc}"
        )


@pytest.fixture
def database_client(database_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(database_settings)) as test_client:
        yield test_client
