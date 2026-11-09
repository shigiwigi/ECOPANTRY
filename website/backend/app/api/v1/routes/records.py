"""Waste and pH records.

Viewing needs `waste.view` / `ph.view` (every role); recording needs `waste.record` / `ph.record`
(administrators and storekeepers, never inspectors). Records are attributed to the signed-in
employee and audited. pH is experimental and carries no verdict.
"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select

from app.api.v1.pagination import Ordering, PageParamsDep, paginate, sort_dependency
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.ph import PhRecord
from app.models.waste import WasteRecord
from app.schemas.errors import ErrorResponse
from app.schemas.pagination import Page
from app.schemas.records import (
    PhRecordCreate,
    PhRecordOut,
    WasteCategory,
    WasteRecordCreate,
    WasteRecordOut,
    WasteSummaryOut,
)
from app.services import records as service
from app.services.audit import ClientInfo

router = APIRouter(
    tags=["waste and pH"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

WasteViewer = Annotated[Principal, Depends(require_permission(Permission.WASTE_VIEW))]
WasteRecorder = Annotated[Principal, Depends(require_permission(Permission.WASTE_RECORD))]
PhViewer = Annotated[Principal, Depends(require_permission(Permission.PH_VIEW))]
PhRecorder = Annotated[Principal, Depends(require_permission(Permission.PH_RECORD))]

INVALID: dict[int | str, dict[str, object]] = {400: {"model": ErrorResponse, "description": "Invalid value"}}

# Newest first, always.
WasteSort = sort_dependency({"recorded_at": WasteRecord.recorded_at}, default="-recorded_at", tiebreaker=WasteRecord.id)
PhSort = sort_dependency({"recorded_at": PhRecord.recorded_at}, default="-recorded_at", tiebreaker=PhRecord.id)


@router.post(
    "/waste/records",
    response_model=WasteRecordOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record waste",
    responses=INVALID,
)
def create_waste(body: WasteRecordCreate, request: Request, principal: WasteRecorder, db: SessionDep) -> WasteRecordOut:
    record = service.create_waste_record(
        db, body.model_dump(), by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return WasteRecordOut.from_record(record, service.EmployeeRef(id=principal.employee.id, full_name=principal.employee.full_name))


@router.get("/waste/records", response_model=Page[WasteRecordOut], summary="List waste records, newest first")
def list_waste(
    _: WasteViewer,
    db: SessionDep,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(WasteSort)],
    category: WasteCategory | None = None,
    date_from: Annotated[date | None, Query(description="First day (UTC), inclusive.")] = None,
    date_to: Annotated[date | None, Query(description="Last day (UTC), inclusive.")] = None,
    employee_id: uuid.UUID | None = None,
) -> Page[WasteRecordOut]:
    statement = service.waste_filters(
        select(WasteRecord), category=category, date_from=date_from, date_to=date_to, employee_id=employee_id
    )
    items, total = paginate(db, statement, page, order)
    people = service.employee_refs(db, (r.employee_id for r in items))
    return Page.of(
        [WasteRecordOut.from_record(r, people[r.employee_id]) for r in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/waste/summary", response_model=WasteSummaryOut, summary="Waste totals by category for a date range")
def waste_summary(
    _: WasteViewer,
    db: SessionDep,
    date_from: Annotated[date | None, Query(description="First day (UTC), inclusive.")] = None,
    date_to: Annotated[date | None, Query(description="Last day (UTC), inclusive.")] = None,
) -> WasteSummaryOut:
    return service.waste_summary(db, date_from=date_from, date_to=date_to)


@router.post(
    "/ph/records",
    response_model=PhRecordOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record a pH measurement (experimental, never a verdict)",
    responses=INVALID,
)
def create_ph(body: PhRecordCreate, request: Request, principal: PhRecorder, db: SessionDep) -> PhRecordOut:
    record = service.create_ph_record(db, body.model_dump(), by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return PhRecordOut.from_record(record, service.EmployeeRef(id=principal.employee.id, full_name=principal.employee.full_name))


@router.get("/ph/records", response_model=Page[PhRecordOut], summary="List pH records, newest first (experimental)")
def list_ph(
    _: PhViewer, db: SessionDep, page: PageParamsDep, order: Annotated[Ordering, Depends(PhSort)]
) -> Page[PhRecordOut]:
    items, total = paginate(db, select(PhRecord), page, order)
    people = service.employee_refs(db, (r.operator_id for r in items))
    return Page.of(
        [PhRecordOut.from_record(r, people[r.operator_id]) for r in items],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )
