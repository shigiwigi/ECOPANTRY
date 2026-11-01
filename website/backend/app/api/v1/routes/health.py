"""Liveness and readiness checks. Public, and expose no data."""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import __version__
from app.db.session import SessionDep
from app.schemas.health import HealthResponse, ReadinessResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=HealthResponse, summary="Liveness: the API process is running")
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="ecopantry-api", version=__version__)


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness: the API can reach PostgreSQL",
    responses={503: {"model": ReadinessResponse, "description": "PostgreSQL is unreachable"}},
)
def readiness(session: SessionDep) -> ReadinessResponse | JSONResponse:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        # Logged here; the response never includes hosts, users or driver messages.
        logger.warning("Readiness check failed: database unreachable", exc_info=True)
        body = ReadinessResponse(status="unavailable", database="unreachable")
        return JSONResponse(status_code=503, content=body.model_dump())
    return ReadinessResponse(status="ready", database="ok")
