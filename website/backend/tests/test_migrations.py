from collections.abc import Iterator

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.core.config import Settings

from .conftest import UNREACHABLE_DATABASE_URL, alembic_config, scratch_database


def test_migration_history_has_a_single_head() -> None:
    script = ScriptDirectory.from_config(alembic_config(UNREACHABLE_DATABASE_URL))

    assert len(script.get_heads()) == 1


def test_migrations_render_as_sql_offline(capsys: pytest.CaptureFixture[str]) -> None:
    # Offline mode needs no database; it proves env.py and every revision load.
    command.upgrade(alembic_config(UNREACHABLE_DATABASE_URL), "head", sql=True)

    assert "CREATE TABLE alembic_version" in capsys.readouterr().out


@pytest.fixture
def empty_database(database_settings: Settings) -> Iterator[str]:
    with scratch_database(database_settings.database_url.get_secret_value()) as url:
        yield url


@pytest.mark.integration
def test_migrations_upgrade_and_downgrade_on_postgres(empty_database: str) -> None:
    config = alembic_config(empty_database)
    head = ScriptDirectory.from_config(config).get_current_head()
    engine = create_engine(empty_database)
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


AUTH_TABLES = {"roles", "permissions", "role_permissions", "employees", "auth_sessions", "audit_events"}


@pytest.mark.integration
def test_auth_migration_creates_tables_and_seeds_only_reference_data(empty_database: str) -> None:
    config = alembic_config(empty_database)
    engine = create_engine(empty_database)
    try:
        command.upgrade(config, "0001")
        with engine.connect() as connection:
            assert set(inspect(connection).get_table_names()) == {"alembic_version"}

        command.upgrade(config, "0002")
        with engine.connect() as connection:
            assert AUTH_TABLES <= set(inspect(connection).get_table_names())
            roles = connection.execute(text("SELECT code FROM roles ORDER BY code")).scalars().all()
            assert roles == ["admin", "inspector", "storekeeper"]
            # No accounts, sessions or audit events: the first administrator comes from the CLI.
            for table in ("employees", "auth_sessions", "audit_events"):
                assert connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0

        command.downgrade(config, "0001")
        with engine.connect() as connection:
            assert not AUTH_TABLES & set(inspect(connection).get_table_names())
            functions = connection.execute(
                text("SELECT count(*) FROM pg_proc WHERE proname = 'audit_events_append_only'")
            ).scalar_one()
            assert functions == 0
    finally:
        engine.dispose()


CATALOGUE_TABLES = {"catalogue_categories", "catalogue_products"}


@pytest.mark.integration
def test_catalogue_migration_adds_empty_tables_and_an_admin_only_permission(empty_database: str) -> None:
    config = alembic_config(empty_database)
    engine = create_engine(empty_database)
    holders = text(
        "SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id "
        "JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'catalogue.manage'"
    )
    try:
        command.upgrade(config, "0003")
        with engine.connect() as connection:
            assert CATALOGUE_TABLES <= set(inspect(connection).get_table_names())
            # No invented products or categories: the owners add them.
            for table in CATALOGUE_TABLES:
                assert connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0
            assert connection.execute(holders).scalars().all() == ["admin"]

        command.downgrade(config, "0002")
        with engine.connect() as connection:
            assert not CATALOGUE_TABLES & set(inspect(connection).get_table_names())
            assert connection.execute(holders).scalars().all() == []
            assert connection.execute(text("SELECT count(*) FROM permissions")).scalar_one() == 25
    finally:
        engine.dispose()


@pytest.mark.integration
def test_catalogue_constraints_reject_inconsistent_rows(migrated_database_url: str) -> None:
    from sqlalchemy.exc import IntegrityError

    engine = create_engine(migrated_database_url)
    insert = text(
        "INSERT INTO catalogue_products (id, slug, name, price, currency, is_published, published_at) "
        "VALUES (gen_random_uuid(), :slug, 'Loaf', :price, :currency, :published, :published_at)"
    )
    good = {"slug": "loaf", "price": None, "currency": None, "published": False, "published_at": None}
    try:
        bad_rows = [
            {**good, "slug": "Not A Slug"},
            {**good, "price": 3, "currency": None},  # price without currency
            {**good, "price": None, "currency": "EUR"},  # currency without price
            {**good, "price": -1, "currency": "EUR"},
            {**good, "price": 1, "currency": "eur"},
            {**good, "published": True, "published_at": None},  # published without a date
        ]
        for row in bad_rows:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(insert, row)
    finally:
        engine.dispose()


@pytest.mark.integration
def test_models_match_the_migrated_schema(migrated_database_url: str) -> None:
    """Same check as `alembic check`: autogenerate would find nothing to add."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.models import Base

    engine = create_engine(migrated_database_url)
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()


@pytest.mark.integration
def test_audit_events_are_append_only(migrated_database_url: str) -> None:
    from sqlalchemy.exc import DBAPIError

    engine = create_engine(migrated_database_url)
    try:
        with engine.begin() as connection:
            event_id = connection.execute(
                text("INSERT INTO audit_events (actor_type, action) VALUES ('cli', 'test.event') RETURNING id")
            ).scalar_one()
        for statement in (
            "UPDATE audit_events SET action = 'test.changed' WHERE id = :id",
            "DELETE FROM audit_events WHERE id = :id",
        ):
            with pytest.raises(DBAPIError, match="append-only"), engine.begin() as connection:
                connection.execute(text(statement), {"id": event_id})
        with engine.begin() as connection:
            assert connection.execute(text("SELECT action FROM audit_events WHERE id = :id"), {"id": event_id}).scalar_one() == "test.event"
            connection.execute(text("TRUNCATE audit_events"))
    finally:
        engine.dispose()


@pytest.mark.integration
def test_employee_constraints_reject_inconsistent_rows(migrated_database_url: str) -> None:
    from sqlalchemy.exc import IntegrityError

    engine = create_engine(migrated_database_url)
    insert = text(
        "INSERT INTO employees (id, email, full_name, role_id, status, password_hash, deactivated_at) "
        "VALUES (gen_random_uuid(), :email, 'Someone', (SELECT id FROM roles WHERE code = 'inspector'), "
        ":status, 'x', :deactivated_at)"
    )
    try:
        bad_rows = [
            {"email": "Mixed@Example.test", "status": "active", "deactivated_at": None},  # not normalized
            {"email": "a@example.test", "status": "suspended", "deactivated_at": None},  # unknown status
            {"email": "b@example.test", "status": "disabled", "deactivated_at": None},  # disabled without a date
        ]
        for row in bad_rows:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(insert, row)
    finally:
        engine.dispose()
