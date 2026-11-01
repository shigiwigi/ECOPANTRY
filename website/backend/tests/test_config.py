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
