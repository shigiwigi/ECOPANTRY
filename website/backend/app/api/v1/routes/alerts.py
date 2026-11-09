"""Alerts raised by thresholds on sensor readings, and the thresholds themselves.

Alerts are opened and resolved by the backend when a live station uploads a
reading (`app/services/alerts.py`); people can only acknowledge them. Reading
needs `alerts.view` (every role), acknowledging `alerts.acknowledge`, changing
thresholds `thresholds.manage` (administrators). Portal only: no email or SMS.
"""

import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v1.pagination import Ordering, PageParamsDep, paginate, sort_dependency
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.alerts import Alert, Threshold
from app.models.devices import Device
from app.schemas.alerts import (
    AlertMetric,
    AlertOut,
    AlertStatusFilter,
    AlertSummaryOut,
    ThresholdCreate,
    ThresholdOut,
    ThresholdUpdate,
)
from app.schemas.errors import ErrorResponse
from app.schemas.pagination import Page
from app.services import alerts as service
from app.services.audit import ClientInfo

router = APIRouter(
    tags=["alerts"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.ALERTS_VIEW))]
Acknowledger = Annotated[Principal, Depends(require_permission(Permission.ALERTS_ACKNOWLEDGE))]
Manager = Annotated[Principal, Depends(require_permission(Permission.THRESHOLDS_MANAGE))]
NOT_FOUND: dict[int | str, dict[str, object]] = {404: {"model": ErrorResponse, "description": "No such entry"}}
INVALID: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorResponse, "description": "Invalid threshold (`invalid_threshold`)"}
}

AlertSort = sort_dependency({"opened_at": Alert.opened_at}, default="-opened_at", tiebreaker=Alert.id)


@router.get("/alerts", response_model=Page[AlertOut], summary="List alerts, newest first")
def list_alerts(
    _: Viewer,
    db: SessionDep,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(AlertSort)],
    status_: Annotated[
        AlertStatusFilter | None, Query(alias="status", description="`active` means open or acknowledged.")
    ] = None,
    device_id: Annotated[uuid.UUID | None, Query(description="Only this station.")] = None,
    metric: AlertMetric | None = None,
) -> Page[AlertOut]:
    items, total = paginate(db, service.alerts_query(status=status_, device_id=device_id, metric=metric), page, order)
    names = service.employee_names(db, items)
    return Page.of([AlertOut.from_alert(a, names) for a in items], total=total, limit=page.limit, offset=page.offset)


@router.get("/alerts/summary", response_model=AlertSummaryOut, summary="Counts of unresolved alerts for the dashboard")
def alert_summary(_: Viewer, db: SessionDep) -> AlertSummaryOut:
    rows = db.execute(
        select(Alert.status, Alert.severity, func.count())
        .where(Alert.status != "resolved")
        .group_by(Alert.status, Alert.severity)
    ).all()
    by_severity = {"info": 0, "warning": 0, "critical": 0}
    counts = {"open": 0, "acknowledged": 0}
    for alert_status, severity, n in rows:
        counts[alert_status] += n
        by_severity[severity] += n
    return AlertSummaryOut(**counts, unresolved=sum(counts.values()), by_severity=by_severity)


@router.post(
    "/alerts/{alert_id}/acknowledge",
    response_model=AlertOut,
    summary="Acknowledge an alert (it stays unresolved until the reading recovers)",
    responses={**NOT_FOUND, 409: {"model": ErrorResponse, "description": "The alert is already resolved"}},
)
def acknowledge_alert(alert_id: uuid.UUID, request: Request, principal: Acknowledger, db: SessionDep) -> AlertOut:
    alert = service.acknowledge(
        db, service.get_alert(db, alert_id), by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return AlertOut.from_alert(alert, service.employee_names(db, [alert]))


# --- thresholds -------------------------------------------------------------


def _outs(db: Session, thresholds: Sequence[Threshold]) -> list[ThresholdOut]:
    names = {d.id: d.name for d in db.scalars(select(Device))}
    return [ThresholdOut.from_threshold(t, names.get(t.device_id) if t.device_id else None) for t in thresholds]


@router.get("/thresholds", response_model=list[ThresholdOut], summary="List alert thresholds")
def list_thresholds(_: Viewer, db: SessionDep) -> list[ThresholdOut]:
    return _outs(db, service.list_thresholds(db))


@router.post(
    "/thresholds",
    response_model=ThresholdOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a threshold",
    responses=INVALID,
)
def create_threshold(body: ThresholdCreate, request: Request, principal: Manager, db: SessionDep) -> ThresholdOut:
    threshold = service.create_threshold(
        db, body.model_dump(), by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return _outs(db, [threshold])[0]


@router.patch(
    "/thresholds/{threshold_id}",
    response_model=ThresholdOut,
    summary="Change a threshold. Only the fields sent change.",
    responses={**INVALID, **NOT_FOUND},
)
def update_threshold(
    threshold_id: uuid.UUID, body: ThresholdUpdate, request: Request, principal: Manager, db: SessionDep
) -> ThresholdOut:
    threshold = service.get_threshold(db, threshold_id)
    changes = body.model_dump(include=body.model_fields_set)
    for required in ("label", "metric", "severity"):
        if required in changes and changes[required] is None:
            raise service.InvalidThresholdError(f"The {required} can't be empty.")
    service.update_threshold(db, threshold, changes, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return _outs(db, [threshold])[0]


@router.post(
    "/thresholds/{threshold_id}/enable", response_model=ThresholdOut, summary="Turn a threshold on", responses=NOT_FOUND
)
def enable_threshold(threshold_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> ThresholdOut:
    threshold = service.set_threshold_enabled(
        db, service.get_threshold(db, threshold_id), True, by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return _outs(db, [threshold])[0]


@router.post(
    "/thresholds/{threshold_id}/disable",
    response_model=ThresholdOut,
    summary="Turn a threshold off (alerts already open stay until a reading clears them)",
    responses=NOT_FOUND,
)
def disable_threshold(threshold_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> ThresholdOut:
    threshold = service.set_threshold_enabled(
        db, service.get_threshold(db, threshold_id), False, by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return _outs(db, [threshold])[0]
