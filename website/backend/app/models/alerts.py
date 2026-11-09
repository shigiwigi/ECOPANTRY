"""Alert thresholds on sensor readings and the alerts they raise (migration 0007).

The backend evaluates thresholds on each incoming reading; devices never
decide alerts. One threshold row is one limit in one direction: set either
`max_value` (alert when the value is at or above it) or `min_value` (alert
when at or below it), never both. `clear_value` adds hysteresis so a value
hovering at the limit doesn't open and close alerts over and over. pH has no
thresholds on purpose: it is experimental and never used alone to judge food.
See docs/DATA_MODEL.md.
"""

import uuid
from datetime import datetime
from typing import ClassVar

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, String, func, text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.devices import Device

# Columns of `sensor_readings` a threshold may watch.
THRESHOLD_METRICS = ("temperature_c", "humidity_pct", "weight_g")
SEVERITIES = ("info", "warning", "critical")
ALERT_STATUSES = ("open", "acknowledged", "resolved")

THRESHOLD_LABEL_MAX_LENGTH = 80
ALERT_MESSAGE_MAX_LENGTH = 200


class Threshold(Base):
    __tablename__ = "thresholds"
    __table_args__ = (
        CheckConstraint("length(btrim(label)) > 0", name="label_not_blank"),
        CheckConstraint(f"metric IN {THRESHOLD_METRICS!r}", name="metric_valid"),
        CheckConstraint(f"severity IN {SEVERITIES!r}", name="severity_valid"),
        CheckConstraint("(min_value IS NULL) <> (max_value IS NULL)", name="one_limit"),
        CheckConstraint(
            "clear_value IS NULL OR (max_value IS NOT NULL AND clear_value <= max_value) "
            "OR (min_value IS NOT NULL AND clear_value >= min_value)",
            name="clear_value_inside_limit",
        ),
    )
    audit_target_type: ClassVar[str] = "threshold"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    label: Mapped[str] = mapped_column(String(THRESHOLD_LABEL_MAX_LENGTH))
    metric: Mapped[str] = mapped_column(String(32))
    # NULL applies the threshold to every station.
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id", ondelete="RESTRICT"), index=True)
    min_value: Mapped[float | None] = mapped_column(Float)
    max_value: Mapped[float | None] = mapped_column(Float)
    # The alert clears once the value is back past this (below it for a max, above it for a min).
    # NULL: clears as soon as the value is back inside the limit.
    clear_value: Mapped[float | None] = mapped_column(Float)
    severity: Mapped[str] = mapped_column(String(16), default="warning", server_default="warning")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<Threshold {self.id} {self.metric}>"


class Alert(Base):
    """A threshold breach on one station. At most one unresolved alert per (threshold, device)."""

    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint(f"metric IN {THRESHOLD_METRICS!r}", name="metric_valid"),
        CheckConstraint(f"severity IN {SEVERITIES!r}", name="severity_valid"),
        CheckConstraint(f"status IN {ALERT_STATUSES!r}", name="status_valid"),
        CheckConstraint("length(btrim(message)) > 0", name="message_not_blank"),
        CheckConstraint("(acknowledged_at IS NULL) = (acknowledged_by_id IS NULL)", name="acknowledged_by_matches"),
        CheckConstraint("status <> 'open' OR acknowledged_at IS NULL", name="open_not_acknowledged"),
        CheckConstraint("status <> 'acknowledged' OR acknowledged_at IS NOT NULL", name="acknowledged_has_time"),
        CheckConstraint("(status = 'resolved') = (resolved_at IS NOT NULL)", name="resolved_at_matches_status"),
        CheckConstraint("resolved_by_id IS NULL OR resolved_at IS NOT NULL", name="resolved_by_needs_time"),
        Index(
            "uq_alerts_one_unresolved_per_threshold_device",
            "threshold_id",
            "device_id",
            unique=True,
            postgresql_where=text("status <> 'resolved'"),
        ),
        Index("ix_alerts_status_opened_at", "status", "opened_at"),
    )
    audit_target_type: ClassVar[str] = "alert"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    threshold_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("thresholds.id", ondelete="RESTRICT"))
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="RESTRICT"), index=True)
    # Copied from the threshold when the alert opens, so later threshold edits don't rewrite history.
    metric: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))
    message: Mapped[str] = mapped_column(String(ALERT_MESSAGE_MAX_LENGTH))
    status: Mapped[str] = mapped_column(String(16), default="open", server_default="open")
    # The reading that opened the alert, and the latest value seen while it was unresolved.
    trigger_value: Mapped[float] = mapped_column(Float)
    last_value: Mapped[float | None] = mapped_column(Float)
    sensor_reading_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("sensor_readings.id", ondelete="RESTRICT")
    )
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # NULL with `resolved_at` set: the value went back past `clear_value` by itself.
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))

    threshold: Mapped[Threshold] = relationship(lazy="joined", innerjoin=True)
    device: Mapped[Device] = relationship(lazy="joined", innerjoin=True)

    def __repr__(self) -> str:
        return f"<Alert {self.id} {self.status}>"
