"""Application factory. Tests build apps with their own settings through `create_app`."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.api.v1.router import api_router
from app.core.config import API_V1_PREFIX, Settings, get_settings
from app.core.errors import register_exception_handlers
from app.db.session import Database
from app.schemas.errors import ErrorResponse


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.getLogger("app").setLevel(settings.log_level)

    database = Database(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        database.dispose()

    docs = settings.docs_enabled
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
        # Under the versioned prefix so the Vite dev proxy forwards them too.
        openapi_url=f"{API_V1_PREFIX}/openapi.json" if docs else None,
        docs_url=f"{API_V1_PREFIX}/docs" if docs else None,
        redoc_url=None,
        responses={
            422: {"model": ErrorResponse, "description": "Invalid request"},
            500: {"model": ErrorResponse, "description": "Unexpected server error"},
        },
    )
    app.state.settings = settings
    app.state.database = database

    register_exception_handlers(app)
    app.include_router(api_router, prefix=API_V1_PREFIX)
    return app
