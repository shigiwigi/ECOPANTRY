"""Audit log viewer (`audit.view`: administrators and inspectors). Read-only; the log is append-only."""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.api.v1.pagination import Ordering, PageParamsDep, paginate, sort_dependency
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.audit import AuditEvent
from app.schemas.audit import AuditEventOut
from app.schemas.errors import ErrorResponse
from app.schemas.pagination import Page
from app.services.records import employee_refs

router = APIRouter(
    tags=["audit"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks `audit.view`"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.AUDIT_VIEW))]
Sort = sort_dependency({"occurred_at": AuditEvent.occurred_at}, default="-occurred_at", tiebreaker=AuditEvent.id)


@router.get("/audit", response_model=Page[AuditEventOut], summary="Audit events, newest first")
def list_audit(
    _: Viewer,
    db: SessionDep,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(Sort)],
    actor_id: Annotated[uuid.UUID | None, Query(description="Only events by this employee.")] = None,
    action: Annotated[str | None, Query(max_length=64, description="Exact event type, e.g. `waste.recorded`.")] = None,
    target_type: Annotated[str | None, Query(max_length=32)] = None,
    date_from: Annotated[date | None, Query(description="First day (UTC), inclusive.")] = None,
    date_to: Annotated[date | None, Query(description="Last day (UTC), inclusive.")] = None,
) -> Page[AuditEventOut]:
    statement = select(AuditEvent)
    if actor_id:
        statement = statement.where(AuditEvent.actor_employee_id == actor_id)
    if action:
        statement = statement.where(AuditEvent.action == action)
    if target_type:
        statement = statement.where(AuditEvent.target_type == target_type)
    if date_from:
        statement = statement.where(AuditEvent.occurred_at >= datetime.combine(date_from, time.min, tzinfo=UTC))
    if date_to:
        statement = statement.where(
            AuditEvent.occurred_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC)
        )
    items, total = paginate(db, statement, page, order)
    people = employee_refs(db, (e.actor_employee_id for e in items if e.actor_employee_id))
    return Page.of(
        [AuditEventOut.from_event(e, people.get(e.actor_employee_id) if e.actor_employee_id else None) for e in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )
