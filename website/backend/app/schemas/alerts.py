"""Alerts and thresholds as the portal sees them. Values are in the metric's storage unit (grams for weight)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.alerts import Alert, Threshold

AlertMetric = Literal["temperature_c", "humidity_pct", "weight_g"]
Severity = Literal["info", "warning", "critical"]
AlertStatus = Literal["open", "acknowledged", "resolved"]
AlertStatusFilter = Literal["open", "acknowledged", "resolved", "active"]


class AlertOut(BaseModel):
    id: uuid.UUID
    threshold_id: uuid.UUID
    device_id: uuid.UUID
    device_name: str
    metric: AlertMetric
    severity: Severity
    message: str
    status: AlertStatus
    trigger_value: float
    last_value: float | None
    opened_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by_name: str | None
    resolved_at: datetime | None

    @classmethod
    def from_alert(cls, alert: Alert, names: dict[uuid.UUID, str]) -> "AlertOut":
        return cls(
            id=alert.id,
            threshold_id=alert.threshold_id,
            device_id=alert.device_id,
            device_name=alert.device.name,
            metric=alert.metric,  # type: ignore[arg-type]
            severity=alert.severity,  # type: ignore[arg-type]
            message=alert.message,
            status=alert.status,  # type: ignore[arg-type]
            trigger_value=alert.trigger_value,
            last_value=alert.last_value,
            opened_at=alert.opened_at,
            acknowledged_at=alert.acknowledged_at,
            acknowledged_by_name=names.get(alert.acknowledged_by_id) if alert.acknowledged_by_id else None,
            resolved_at=alert.resolved_at,
        )


class AlertSummaryOut(BaseModel):
    open: int = Field(description="Alerts nobody has acknowledged yet.")
    acknowledged: int
    unresolved: int = Field(description="open + acknowledged.")
    by_severity: dict[str, int] = Field(description="Unresolved alerts per severity (info, warning, critical).")


class ThresholdOut(BaseModel):
    id: uuid.UUID
    label: str
    metric: AlertMetric
    device_id: uuid.UUID | None = Field(description="null: applies to every station.")
    device_name: str | None
    min_value: float | None
    max_value: float | None
    clear_value: float | None
    severity: Severity
    enabled: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_threshold(cls, t: Threshold, device_name: str | None = None) -> "ThresholdOut":
        return cls(
            id=t.id,
            label=t.label,
            metric=t.metric,  # type: ignore[arg-type]
            device_id=t.device_id,
            device_name=device_name,
            min_value=t.min_value,
            max_value=t.max_value,
            clear_value=t.clear_value,
            severity=t.severity,  # type: ignore[arg-type]
            enabled=t.enabled,
            created_at=t.created_at,
            updated_at=t.updated_at,
        )


class ThresholdCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    metric: AlertMetric
    device_id: uuid.UUID | None = None
    min_value: float | None = None
    max_value: float | None = None
    clear_value: float | None = None
    severity: Severity = "warning"
    enabled: bool = True


class ThresholdUpdate(BaseModel):
    """Only the fields sent change. To switch a minimum to a maximum, send the new one and `null` for the old one."""

    label: str | None = Field(default=None, min_length=1, max_length=200)
    metric: AlertMetric | None = None
    device_id: uuid.UUID | None = None
    min_value: float | None = None
    max_value: float | None = None
    clear_value: float | None = None
    severity: Severity | None = None
