"""SQLAlchemy engine and session management."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings


class Database:
    """Owns the connection pool for one application instance.

    Creating it does not connect; connections are opened on first use and
    checked with a ping before reuse, so a restarted PostgreSQL is recovered from.
    """

    def __init__(self, settings: Settings) -> None:
        self.engine: Engine = create_engine(
            settings.database_url.get_secret_value(),
            pool_pre_ping=True,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_timeout=settings.database_pool_timeout,
            connect_args={
                "connect_timeout": settings.database_connect_timeout,
                "application_name": "ecopantry-api",
            },
        )
        self.session_factory: sessionmaker[Session] = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )

    def ping(self) -> None:
        """Run a trivial query. Raises a SQLAlchemy error if PostgreSQL can't be reached."""
        with self.engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    def dispose(self) -> None:
        self.engine.dispose()


def get_database(request: Request) -> Database:
    database: Database = request.app.state.database
    return database


def get_session(database: Annotated[Database, Depends(get_database)]) -> Iterator[Session]:
    """One session per request. Commit explicitly; anything uncommitted is rolled back on close."""
    with database.session_factory() as session:
        yield session


DatabaseDep = Annotated[Database, Depends(get_database)]
SessionDep = Annotated[Session, Depends(get_session)]
