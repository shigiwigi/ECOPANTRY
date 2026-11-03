"""API server for the full-stack browser tests. Not for real use.

Started by `npm run test:e2e:fullstack` (website/frontend/playwright.fullstack.config.ts):

1. Creates a throwaway database `ecopantry_test_e2e` on the PostgreSQL server
   named by DATABASE_URL (replacing a leftover one from an earlier run). The
   development database itself is never touched.
2. Applies every migration.
3. Creates test accounts with the password in E2E_PASSWORD, which the
   Playwright config generates randomly for each run.
4. Serves the API on 127.0.0.1:E2E_API_PORT until stopped, then drops the database.
"""

import os
import signal
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import uvicorn  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.auth.permissions import RoleCode  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.db.session import Database  # noqa: E402
from app.factory import create_app  # noqa: E402
from app.services import employees  # noqa: E402

DATABASE_NAME = "ecopantry_test_e2e"

# (email, name, role, active). Mirrored in website/frontend/e2e/fullstack/accounts.ts.
ACCOUNTS = [
    ("admin@e2e.test", "E2E Administrator", RoleCode.ADMIN, True),
    ("storekeeper@e2e.test", "E2E Storekeeper", RoleCode.STOREKEEPER, True),
    ("inspector@e2e.test", "E2E Inspector", RoleCode.INSPECTOR, True),
    ("disabled@e2e.test", "E2E Deactivated", RoleCode.INSPECTOR, False),
]


def _recreate_database(server_url: str) -> str:
    assert DATABASE_NAME.startswith("ecopantry_test_")
    url = make_url(server_url)
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}" WITH (FORCE)'))
            connection.execute(text(f'CREATE DATABASE "{DATABASE_NAME}"'))
    finally:
        engine.dispose()
    return url.set(database=DATABASE_NAME).render_as_string(hide_password=False)


def _drop_database(server_url: str) -> None:
    engine = create_engine(make_url(server_url), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{DATABASE_NAME}" WITH (FORCE)'))
    finally:
        engine.dispose()


def _seed(settings: Settings, password: str) -> None:
    database = Database(settings)
    try:
        with database.session_factory() as db:
            for email, name, role, active in ACCOUNTS:
                employee = employees.create_employee(
                    db, email=email, full_name=name, role=role, password=password, created_by=None, actor_type="cli"
                )
                db.flush()
                if not active:
                    employees.deactivate_employee(db, employee, by=None, actor_type="cli")
            db.commit()
    finally:
        database.dispose()


def main() -> None:
    password = os.environ.get("E2E_PASSWORD")
    if not password:
        sys.exit("E2E_PASSWORD is not set. Run this through `npm run test:e2e:fullstack`.")
    port = int(os.environ.get("E2E_API_PORT", "8766"))

    server_url = Settings(environment="test").database_url.get_secret_value()  # type: ignore[call-arg]
    database_url = _recreate_database(server_url)
    try:
        config = Config(BACKEND_DIR / "alembic.ini")
        config.attributes["database_url"] = database_url
        command.upgrade(config, "head")

        settings = Settings(_env_file=None, environment="test", database_url=database_url)  # type: ignore[call-arg]
        _seed(settings, password)
        # uvicorn re-raises SIGTERM after shutting down. Turning it into SystemExit lets the
        # `finally` below drop the database instead of the process dying first.
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        uvicorn.run(create_app(settings), host="127.0.0.1", port=port, log_level="warning")
    finally:
        _drop_database(server_url)


if __name__ == "__main__":
    main()
