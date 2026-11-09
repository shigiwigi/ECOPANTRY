"""Threshold evaluation on incoming readings, and alert/threshold management. Callers commit.

`evaluate_reading` runs inside `POST /device/readings`, in the same transaction
as the stored readings, so a reading and the alert it raised are saved or
discarded together. Only the newest reading of an upload is evaluated: a
backlog of buffered samples costs one evaluation, not fifty.

Rules, per enabled threshold that matches the reading's device (the threshold's
device, or every device when it has none):

- A missing value (a sensor that failed, stored as NULL) changes nothing.
- No unresolved alert and the value is at or beyond the limit (>= max, or <= min):
  open one alert. The partial unique index allows only one per (threshold,
  device); losing that race is not an error.
- An unresolved alert and the value is back past `clear_value` (below it for a
  max, above it for a min; with no `clear_value`, merely inside the limit):
  resolve it. Between the limit and `clear_value` the alert stays as it is
  (hysteresis), and its `last_value` follows the reading.

Opening and resolving are audited with actor type `device`.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.service import utcnow
from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.alerts import ALERT_MESSAGE_MAX_LENGTH, SEVERITIES, THRESHOLD_LABEL_MAX_LENGTH, THRESHOLD_METRICS, Alert, Threshold
from app.models.auth import Employee
from app.models.devices import HUMIDITY_RANGE, TEMPERATURE_RANGE, WEIGHT_RANGE, Device, SensorReading
from app.services.audit import ClientInfo, record_event

METRIC_RANGES: dict[str, tuple[float, float]] = {
    "temperature_c": TEMPERATURE_RANGE,
    "humidity_pct": HUMIDITY_RANGE,
    "weight_g": WEIGHT_RANGE,
}


class InvalidThresholdError(AppError):
    status_code = 400
    code = "invalid_threshold"


# --- evaluation -------------------------------------------------------------


def _format_value(metric: str, value: float) -> str:
    if metric == "weight_g":
        return f"{value / 1000:.2f} kg"
    if metric == "temperature_c":
        return f"{value:.1f} °C"
    return f"{value:.0f} %"


def _tripped(threshold: Threshold, value: float) -> bool:
    if threshold.max_value is not None:
        return value >= threshold.max_value
    return threshold.min_value is not None and value <= threshold.min_value


def _cleared(threshold: Threshold, value: float) -> bool:
    if threshold.clear_value is None:
        return not _tripped(threshold, value)
    if threshold.max_value is not None:
        return value < threshold.clear_value
    return value > threshold.clear_value


def _limit(threshold: Threshold) -> float:
    return threshold.max_value if threshold.max_value is not None else threshold.min_value  # type: ignore[return-value]


def evaluate_reading(db: Session, device: Device, reading: SensorReading) -> None:
    """Open, update or resolve alerts for `device` from one reading. The reading must be flushed (it needs an id)."""
    thresholds = db.scalars(
        select(Threshold).where(
            Threshold.enabled.is_(True),
            or_(Threshold.device_id.is_(None), Threshold.device_id == device.id),
        )
    ).all()
    if not thresholds:
        return
    unresolved = {
        alert.threshold_id: alert
        for alert in db.scalars(select(Alert).where(Alert.device_id == device.id, Alert.status != "resolved")).unique()
    }
    for threshold in thresholds:
        value: float | None = getattr(reading, threshold.metric)
        if value is None:
            continue
        alert = unresolved.get(threshold.id)
        if alert is None:
            if _tripped(threshold, value):
                _open(db, device, threshold, reading, value)
            continue
        alert.last_value = value
        if _cleared(threshold, value):
            alert.status = "resolved"
            alert.resolved_at = utcnow()
            record_event(
                db,
                "alert.resolved",
                actor_type="device",
                target=alert,
                details={"device": device.name, "metric": alert.metric, "value": value},
            )


def _open(db: Session, device: Device, threshold: Threshold, reading: SensorReading, value: float) -> None:
    direction = "above" if threshold.max_value is not None else "below"
    message = f"{threshold.label}: {_format_value(threshold.metric, value)} ({direction} {_format_value(threshold.metric, _limit(threshold))})"
    alert = Alert(
        threshold_id=threshold.id,
        device_id=device.id,
        metric=threshold.metric,
        severity=threshold.severity,
        message=message[:ALERT_MESSAGE_MAX_LENGTH],
        status="open",
        trigger_value=value,
        last_value=value,
        sensor_reading_id=reading.id,
        opened_at=utcnow(),
    )
    try:
        with db.begin_nested():
            db.add(alert)
            db.flush()
    except IntegrityError:
        # Another upload opened it first (partial unique index): there is already one alert.
        return
    record_event(
        db,
        "alert.opened",
        actor_type="device",
        target=alert,
        details={"device": device.name, "metric": alert.metric, "severity": alert.severity, "value": value},
    )


# --- alerts for the portal --------------------------------------------------


def alerts_query(*, status: str | None, device_id: uuid.UUID | None, metric: str | None) -> Select[Any]:
    statement = select(Alert)
    if status == "active":
        statement = statement.where(Alert.status != "resolved")
    elif status:
        statement = statement.where(Alert.status == status)
    if device_id:
        statement = statement.where(Alert.device_id == device_id)
    if metric:
        statement = statement.where(Alert.metric == metric)
    return statement


def employee_names(db: Session, alerts: Sequence[Alert]) -> dict[uuid.UUID, str]:
    ids = {a.acknowledged_by_id for a in alerts if a.acknowledged_by_id}
    if not ids:
        return {}
    return {e.id: e.full_name for e in db.scalars(select(Employee).where(Employee.id.in_(ids)))}


def get_alert(db: Session, alert_id: uuid.UUID) -> Alert:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise NotFoundError("No alert has that id.")
    return alert


def acknowledge(db: Session, alert: Alert, *, by: Employee, client: ClientInfo) -> Alert:
    if alert.status == "resolved":
        raise ConflictError("This alert is already resolved.")
    if alert.status == "open":
        alert.status = "acknowledged"
        alert.acknowledged_at = utcnow()
        alert.acknowledged_by_id = by.id
        record_event(
            db,
            "alert.acknowledged",
            actor=by,
            target=alert,
            client=client,
            details={"metric": alert.metric, "severity": alert.severity},
        )
    return alert


# --- thresholds -------------------------------------------------------------


def list_thresholds(db: Session) -> list[Threshold]:
    return list(db.scalars(select(Threshold).order_by(Threshold.created_at, Threshold.id)))


def get_threshold(db: Session, threshold_id: uuid.UUID) -> Threshold:
    threshold = db.get(Threshold, threshold_id)
    if threshold is None:
        raise NotFoundError("No threshold has that id.")
    return threshold


def _validate(db: Session, t: Threshold) -> None:
    t.label = " ".join(t.label.split())
    if not t.label or len(t.label) > THRESHOLD_LABEL_MAX_LENGTH:
        raise InvalidThresholdError(f"Enter a label of 1 to {THRESHOLD_LABEL_MAX_LENGTH} characters.")
    if t.metric not in THRESHOLD_METRICS:
        raise InvalidThresholdError("Choose temperature, humidity or weight. pH has no thresholds.")
    if t.severity not in SEVERITIES:
        raise InvalidThresholdError("Choose info, warning or critical.")
    if (t.min_value is None) == (t.max_value is None):
        raise InvalidThresholdError("Set exactly one of a minimum or a maximum.")
    low, high = METRIC_RANGES[t.metric]
    for value in (t.min_value, t.max_value, t.clear_value):
        if value is not None and not low <= value <= high:
            raise InvalidThresholdError("A limit is outside what this sensor can measure.")
    if t.clear_value is not None:
        if t.max_value is not None and t.clear_value > t.max_value:
            raise InvalidThresholdError("The clear value of a maximum must be at or below the maximum.")
        if t.min_value is not None and t.clear_value < t.min_value:
            raise InvalidThresholdError("The clear value of a minimum must be at or above the minimum.")
    if t.device_id is not None and db.get(Device, t.device_id) is None:
        raise InvalidThresholdError("No station has that id.")


def _details(t: Threshold) -> dict[str, Any]:
    return {
        "label": t.label,
        "metric": t.metric,
        "device_id": str(t.device_id) if t.device_id else None,
        "min_value": t.min_value,
        "max_value": t.max_value,
        "clear_value": t.clear_value,
        "severity": t.severity,
        "enabled": t.enabled,
    }


def create_threshold(db: Session, data: dict[str, Any], *, by: Employee, client: ClientInfo) -> Threshold:
    threshold = Threshold(**data)
    threshold.severity = data.get("severity") or "warning"
    threshold.enabled = data.get("enabled", True)
    _validate(db, threshold)
    db.add(threshold)
    db.flush()
    record_event(db, "threshold.created", actor=by, target=threshold, client=client, details=_details(threshold))
    return threshold


def update_threshold(
    db: Session, threshold: Threshold, changes: dict[str, Any], *, by: Employee, client: ClientInfo
) -> Threshold:
    for key, value in changes.items():
        setattr(threshold, key, value)
    _validate(db, threshold)
    record_event(
        db,
        "threshold.updated",
        actor=by,
        target=threshold,
        client=client,
        details={"changed": sorted(changes), **_details(threshold)},
    )
    return threshold


def set_threshold_enabled(
    db: Session, threshold: Threshold, enabled: bool, *, by: Employee, client: ClientInfo
) -> Threshold:
    if threshold.enabled != enabled:
        threshold.enabled = enabled
        record_event(
            db,
            "threshold.enabled" if enabled else "threshold.disabled",
            actor=by,
            target=threshold,
            client=client,
            details={"label": threshold.label},
        )
    return threshold
