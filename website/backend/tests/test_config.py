import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.factory import create_app

from .conftest import make_settings


@pytest.mark.parametrize(
    "url",
    [
        "postgres://u:p@localhost:5432/ecopantry",
        "postgresql://u:p@localhost:5432/ecopantry",
        "postgresql+psycopg://u:p@localhost:5432/ecopantry",
    ],
)
def test_postgres_urls_use_the_psycopg_driver(url: str) -> None:
    settings = make_settings(database_url=url)

    assert settings.database_url.get_secret_value() == "postgresql+psycopg://u:p@localhost:5432/ecopantry"


@pytest.mark.parametrize(
    "url",
    [
        "sqlite:///./ecopantry.db",
        "mysql+pymysql://u:p@localhost/ecopantry",
        "postgresql+psycopg://u:p@localhost:5432",
        "not a url",
    ],
)
def test_non_postgres_or_incomplete_urls_are_rejected(url: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(database_url=url)


def test_database_url_is_required() -> None:
    with pytest.raises(ValidationError):
        make_settings(database_url=None)


def test_database_password_is_not_in_repr() -> None:
    settings = make_settings(database_url="postgresql://u:topsecret@localhost:5432/ecopantry")

    assert "topsecret" not in repr(settings)
    assert "topsecret" not in str(settings.model_dump())


def test_api_docs_are_served_outside_production() -> None:
    client = TestClient(create_app(make_settings(environment="development")))

    assert client.get("/api/v1/openapi.json").status_code == 200
    assert client.get("/api/v1/docs").status_code == 200


def test_api_docs_are_disabled_in_production() -> None:
    client = TestClient(create_app(make_settings(environment="production")))

    assert client.get("/api/v1/openapi.json").status_code == 404
    assert client.get("/api/v1/docs").status_code == 404


def test_session_cookie_is_plain_http_in_development_and_secure_in_production() -> None:
    development = make_settings(environment="development")
    production = make_settings(environment="production")

    assert development.cookie_secure is False
    assert development.session_cookie_name == "ecopantry_session"
    assert production.cookie_secure is True
    assert production.session_cookie_name == "__Host-ecopantry_session"


def test_production_refuses_insecure_session_cookies() -> None:
    with pytest.raises(ValidationError, match="SESSION_COOKIE_SECURE"):
        make_settings(environment="production", session_cookie_secure=False)


def test_secure_cookies_can_be_turned_on_outside_production() -> None:
    settings = make_settings(environment="development", session_cookie_secure=True)

    assert settings.cookie_secure is True
    assert settings.session_cookie_name == "__Host-ecopantry_session"


def test_api_responses_are_not_cached(client: TestClient) -> None:
    assert client.get("/api/v1/health").headers["cache-control"] == "no-store"
    assert client.get("/api/v1/does-not-exist").headers["cache-control"] == "no-store"
