"""Station readings for the portal: latest values per station, and bucketed history.

Each metric needs its own view permission: temperature and humidity need
`environment.view`, pH needs `ph.view`, bin weight needs `waste.view`.
Metrics the role can't see come back as null.
"""

import uuid

from fastapi import APIRouter, Query

from app.auth.dependencies import CurrentPrincipal, SettingsDep
from app.auth.permissions import Permission
from app.auth.service import Principal, utcnow
from app.core.errors import ForbiddenError
from app.db.session import SessionDep
from app.models.devices import SensorReading
from app.schemas.errors import ErrorResponse
from app.schemas.sensors import HistoryOut, HistoryPoint, HistoryRange, LatestReadingOut, Metric, StationOut, StationsOut
from app.services import devices as device_service
from app.services import readings

router = APIRouter(
    prefix="/sensors",
    tags=["sensors"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role can't see this metric"},
    },
)

METRIC_PERMISSIONS: dict[Metric, Permission] = {
    Metric.TEMPERATURE: Permission.ENVIRONMENT_VIEW,
    Metric.HUMIDITY: Permission.ENVIRONMENT_VIEW,
    Metric.WEIGHT: Permission.WASTE_VIEW,
    Metric.PH: Permission.PH_VIEW,
    Metric.PH_VOLTAGE: Permission.PH_VIEW,
}


def _visible(principal: Principal) -> set[Metric]:
    visible = {metric for metric, permission in METRIC_PERMISSIONS.items() if principal.has(permission)}
    if not visible:
        raise ForbiddenError()
    return visible


def _latest_out(reading: SensorReading, visible: set[Metric]) -> LatestReadingOut:
    def value(metric: Metric) -> float | None:
        return getattr(reading, metric.value) if metric in visible else None

    return LatestReadingOut(
        recorded_at=reading.recorded_at,
        temperature_c=value(Metric.TEMPERATURE),
        humidity_pct=value(Metric.HUMIDITY),
        weight_g=value(Metric.WEIGHT),
        ph_value=value(Metric.PH),
        ph_voltage=value(Metric.PH_VOLTAGE),
        dht_ok=reading.dht_ok,
        load_cell_ok=reading.load_cell_ok,
    )


@router.get("/stations", response_model=StationsOut, summary="Every station with its latest reading and live state")
def stations(principal: CurrentPrincipal, db: SessionDep, settings: SettingsDep) -> StationsOut:
    visible = _visible(principal)
    now = utcnow()
    result = []
    for device in device_service.list_devices(db):
        latest = readings.latest_reading(db, device)
        live = device.is_live(now)
        result.append(
            StationOut(
                id=device.id,
                name=device.name,
                status=device.status,
                firmware_version=device.firmware_version,
                last_seen_at=device.last_seen_at,
                live=live,
                live_until=device.live_until if live else None,
                stale=readings.is_stale(latest, settings, now),
                report_interval_seconds=settings.device_report_interval_seconds,
                latest=_latest_out(latest, visible) if latest else None,
            )
        )
    return StationsOut(server_time=now, stations=result)


@router.get("/stations/{device_id}/history", response_model=HistoryOut, summary="Bucketed history of one metric")
def station_history(
    device_id: uuid.UUID,
    principal: CurrentPrincipal,
    db: SessionDep,
    metric: Metric = Query(),
    range_: HistoryRange = Query(default=HistoryRange.DAY, alias="range"),
) -> HistoryOut:
    if not principal.has(METRIC_PERMISSIONS[metric]):
        raise ForbiddenError()
    device = device_service.get_device(db, device_id)
    bucket_seconds, rows = readings.history(db, device.id, metric, range_, utcnow())
    return HistoryOut(
        device_id=device.id,
        metric=metric,
        range=range_,
        bucket_seconds=bucket_seconds,
        points=[HistoryPoint(t=t, avg=avg, min=low, max=high, count=n) for t, avg, low, high, n in rows],
    )
