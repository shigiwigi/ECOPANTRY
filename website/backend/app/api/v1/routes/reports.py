"""Stock, expiry, environment and waste reports (M13), as a JSON preview, CSV or PDF.

`GET /reports/{kind}` previews (needs `reports.view`); `?format=csv|pdf` downloads
(needs `reports.export`, administrators and inspectors) and writes a
`report.exported` audit event with the kind, format and filters only. Rendering
lives in `app/services/report_files.py`, the queries in `app/services/reports.py`.
Reads only, so no CSRF token is needed, but a session is.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from app.api.v1.routes.expiry import Today
from app.auth.dependencies import CurrentPrincipal
from app.auth.permissions import Permission
from app.core.errors import AppError, ForbiddenError
from app.db.session import SessionDep
from app.schemas.errors import ErrorResponse
from app.schemas.reports import ReportOut
from app.services import report_files
from app.services import reports as service
from app.services.audit import ClientInfo, record_event

router = APIRouter(
    prefix="/reports",
    tags=["reports"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission"},
    },
)

MEDIA_TYPES = {"csv": "text/csv; charset=utf-8", "pdf": "application/pdf"}


class InvalidRange(AppError):
    status_code = 422
    code = "validation_error"


def resolve_range(date_from: date | None, date_to: date | None, today: date) -> tuple[date, date]:
    end = date_to or today
    start = date_from or end - timedelta(days=service.DEFAULT_RANGE_DAYS - 1)
    if start > end:
        raise InvalidRange("The start date must not be after the end date.")
    if (end - start).days + 1 > service.MAX_RANGE_DAYS:
        raise InvalidRange(f"The date range can be at most {service.MAX_RANGE_DAYS} days.")
    return start, end


@router.get(
    "/{kind}",
    response_model=ReportOut,
    summary="A report: JSON preview, or a CSV / PDF download",
    responses={
        200: {"content": {"text/csv": {}, "application/pdf": {}}, "description": "JSON, or a file for `format=csv|pdf`"}
    },
)
def get_report(
    kind: service.ReportKind,
    request: Request,
    principal: CurrentPrincipal,
    db: SessionDep,
    today: Today,
    format: Annotated[service.ReportFormat, Query(description="`json` previews; `csv` and `pdf` download.")] = "json",
    date_from: Annotated[
        date | None, Query(description="Environment and waste: first day (UTC). Default: 6 days before the end.")
    ] = None,
    date_to: Annotated[date | None, Query(description="Environment and waste: last day (UTC). Default: today.")] = None,
    days: Annotated[
        int, Query(ge=1, le=service.MAX_WINDOW_DAYS, description="Expiry: near-expiry window in days.")
    ] = service.DEFAULT_WINDOW_DAYS,
) -> Response | ReportOut:
    if not principal.has(Permission.REPORTS_VIEW if format == "json" else Permission.REPORTS_EXPORT):
        raise ForbiddenError()
    generated_at = datetime.now(UTC)
    filters: dict[str, str | int] = {}
    if kind == "stock":
        report = service.stock_report(db, today=today, generated_at=generated_at)
    elif kind == "expiry":
        report = service.expiry_report(db, today=today, days=days, generated_at=generated_at)
        filters["days"] = days
    else:
        start, end = resolve_range(date_from, date_to, today)
        filters.update(date_from=start.isoformat(), date_to=end.isoformat())
        build = service.environment_report if kind == "environment" else service.waste_report
        report = build(db, date_from=start, date_to=end, generated_at=generated_at)

    if format == "json":
        return ReportOut.of(report)

    content = report_files.to_csv(report) if format == "csv" else report_files.to_pdf(report)
    record_event(
        db,
        "report.exported",
        actor=principal.employee,
        client=ClientInfo.from_request(request),
        details={"kind": kind, "format": format, **filters},
    )
    db.commit()
    return Response(
        content,
        media_type=MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="ecopantry-{kind}-{today.isoformat()}.{format}"'},
    )
