"""One summary for the portal dashboard.

Needs `dashboard.view` (every role). Each figure is included only when the role also holds the
permission that guards it elsewhere (`inventory.view`, `expiry.view`, `alerts.view`,
`employees.view`), otherwise it is null, so the dashboard never reveals a count the role can't open.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1.routes.expiry import Today
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal, utcnow
from app.db.session import SessionDep
from app.schemas.dashboard import DashboardSummaryOut
from app.schemas.errors import ErrorResponse
from app.services import dashboard as service
from app.services.expiry import DEFAULT_WINDOW_DAYS

router = APIRouter(
    tags=["dashboard"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.DASHBOARD_VIEW))]


@router.get("/dashboard/summary", response_model=DashboardSummaryOut, summary="Counts for the dashboard, per role")
def dashboard_summary(principal: Viewer, db: SessionDep, today: Today) -> DashboardSummaryOut:
    can = principal.has
    near = expired = None
    if can(Permission.EXPIRY_VIEW):
        near, expired = service.expiry_counts(db, today=today, days=DEFAULT_WINDOW_DAYS)
    opened = acknowledged = top = None
    if can(Permission.ALERTS_VIEW):
        opened, acknowledged = service.alert_counts(db)
        top = service.top_open_alert(db)
    return DashboardSummaryOut(
        low_stock_ingredients=service.low_stock_count(db, today=today) if can(Permission.INVENTORY_VIEW) else None,
        near_expiry_batches=near,
        expired_batches=expired,
        expiry_window_days=DEFAULT_WINDOW_DAYS,
        open_alerts=opened,
        acknowledged_alerts=acknowledged,
        top_alert=top,
        active_staff=service.active_staff_count(db) if can(Permission.EMPLOYEES_VIEW) else None,
        today=today,
        server_time=utcnow(),
    )
