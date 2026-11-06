import secrets
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.core.config import BACKEND_DIR, Settings
from app.factory import create_app
from app.models.auth import Employee
from app.services import employees as employee_service

# Nothing listens on port 1, so connections are refused immediately.
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://unit_user:unit_password@127.0.0.1:1/ecopantry_unit"

# Long enough for the password rules; only ever used in throwaway test databases.
TEST_PASSWORD = "correct horse battery staple"


def make_settings(**overrides: object) -> Settings:
    """Settings that ignore the local .env file, for tests that must not depend on it."""
    values: dict[str, object] = {
        "environment": "test",
        "database_url": UNREACHABLE_DATABASE_URL,
        "database_connect_timeout": 1,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def alembic_config(database_url: str) -> Config:
    config = Config(BACKEND_DIR / "alembic.ini")
    config.attributes["database_url"] = database_url
    return config


@contextmanager
def scratch_database(server_url: str) -> Iterator[str]:
    """A throwaway `ecopantry_test_*` database on the dev PostgreSQL server, dropped afterwards.

    Tests never write to the development database itself.
    """
    url = make_url(server_url)
    name = f"ecopantry_test_{secrets.token_hex(4)}"
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
        yield url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


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


# --- a migrated throwaway database for auth and API tests -------------------


@pytest.fixture(scope="session")
def migrated_database_url(database_settings: Settings) -> Iterator[str]:
    with scratch_database(database_settings.database_url.get_secret_value()) as url:
        command.upgrade(alembic_config(url), "head")
        yield url


@pytest.fixture
def auth_settings(migrated_database_url: str) -> Settings:
    return make_settings(database_url=migrated_database_url, database_connect_timeout=5)


@pytest.fixture
def auth_app(auth_settings: Settings) -> Iterator[FastAPI]:
    application = create_app(auth_settings)
    yield application
    # Each test starts with no accounts or catalogue entries. Roles and permissions (migration seed) stay.
    with application.state.database.engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE audit_events, auth_sessions, catalogue_products, catalogue_categories, "
                "sensor_readings, rfid_scans, rfid_cards, device_live_usage, devices, employees "
                "RESTART IDENTITY"
            )
        )
    application.state.database.dispose()


@pytest.fixture
def db(auth_app: FastAPI) -> Iterator[Session]:
    with auth_app.state.database.session_factory() as session:
        yield session


@pytest.fixture
def api(auth_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(auth_app) as test_client:
        yield test_client


@pytest.fixture
def make_employee(db: Session):  # type: ignore[no-untyped-def]
    counter = iter(range(1, 1000))

    def factory(role: RoleCode = RoleCode.STOREKEEPER, *, email: str | None = None, active: bool = True) -> Employee:
        number = next(counter)
        employee = employee_service.create_employee(
            db,
            email=email or f"{role.value}{number}@example.test",
            full_name=f"Test {role.value.title()} {number}",
            role=role,
            password=TEST_PASSWORD,
            created_by=None,
            actor_type="cli",
        )
        if not active:
            employee.status = "disabled"
            employee.deactivated_at = employee.created_at
        db.commit()
        return employee

    return factory


def sign_in(client: TestClient, email: str, password: str = TEST_PASSWORD) -> str:
    """Sign in and return the CSRF token. The client keeps the session cookie."""
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return str(response.json()["csrf_token"])
