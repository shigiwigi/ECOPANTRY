import secrets
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from app.core.config import BACKEND_DIR, Settings

from .conftest import UNREACHABLE_DATABASE_URL


def alembic_config(database_url: str) -> Config:
    config = Config(BACKEND_DIR / "alembic.ini")
    config.attributes["database_url"] = database_url
    return config


def test_migration_history_has_a_single_head() -> None:
    script = ScriptDirectory.from_config(alembic_config(UNREACHABLE_DATABASE_URL))

    assert len(script.get_heads()) == 1


def test_migrations_render_as_sql_offline(capsys: pytest.CaptureFixture[str]) -> None:
    # Offline mode needs no database; it proves env.py and every revision load.
    command.upgrade(alembic_config(UNREACHABLE_DATABASE_URL), "head", sql=True)

    assert "CREATE TABLE alembic_version" in capsys.readouterr().out


@pytest.fixture
def scratch_database(database_settings: Settings) -> Iterator[str]:
    """A throwaway database on the dev PostgreSQL server, so tests never touch real data."""
    server_url = make_url(database_settings.database_url.get_secret_value())
    name = f"ecopantry_test_{secrets.token_hex(4)}"
    admin = create_engine(server_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
        yield server_url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.mark.integration
def test_migrations_upgrade_and_downgrade_on_postgres(scratch_database: str) -> None:
    config = alembic_config(scratch_database)
    head = ScriptDirectory.from_config(config).get_current_head()
    engine = create_engine(scratch_database)
    try:
        command.upgrade(config, "head")
        with engine.connect() as connection:
            version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        assert version == head

        command.downgrade(config, "base")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM alembic_version")).scalar_one() == 0
            assert set(inspect(connection).get_table_names()) == {"alembic_version"}
    finally:
        engine.dispose()
