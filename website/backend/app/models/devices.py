"""Hardware devices (ESP32 sensor stations), their live sessions and their readings.

Devices talk to the API over HTTPS with a bearer token; they never touch the
database. Only the token's SHA-256 is stored. Devices are never deleted
(readings and audit events point at them); disable them instead.

A device only uploads during a *live session* (`live_until` in the future).
Sessions start from a physical action at the station (power-on or an
authorised RFID card) and are capped per day (`device_live_usage`), so an
idle station sends nothing and the free-tier database can suspend.
"""

import uuid
from datetime import date, datetime
from typing import ClassVar

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

DEVICE_KINDS = ("sensor_station",)
DEVICE_STATUSES = ("active", "disabled")

# Physical limits of the sensors on the station. Values outside them are wiring or
# calibration faults and are rejected rather than stored.
TEMPERATURE_RANGE = (-40.0, 80.0)  # °C, DHT11 is specified for 0–50 but the column allows the DHT22 range
HUMIDITY_RANGE = (0.0, 100.0)  # %RH
WEIGHT_RANGE = (-5_000.0, 500_000.0)  # g, a small negative drift after tare is normal
PH_RANGE = (0.0, 14.0)
PH_VOLTAGE_RANGE = (0.0, 10.0)  # V at the probe board, before the divider


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"kind IN ({', '.join(repr(kind) for kind in DEVICE_KINDS)})", name="kind_valid"),
        CheckConstraint(f"status IN {DEVICE_STATUSES!r}", name="status_valid"),
        CheckConstraint("(status = 'disabled') = (disabled_at IS NOT NULL)", name="disabled_at_matches_status"),
    )
    audit_target_type: ClassVar[str] = "device"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    kind: Mapped[str] = mapped_column(String(32), default="sensor_station", server_default="sensor_station")
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    # The first characters of the token, so staff can tell which token a device holds.
    token_prefix: Mapped[str] = mapped_column(String(16))
    firmware_version: Mapped[str | None] = mapped_column(String(32))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reading_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    live_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    live_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    live_started_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def is_active(self) -> bool:
        return self.status == "active"

    def is_live(self, now: datetime) -> bool:
        return self.live_until is not None and self.live_until > now

    def __repr__(self) -> str:  # Never include token material.
        return f"<Device {self.id} {self.status}>"


class DeviceLiveUsage(Base):
    """Live-session time granted to a device on one UTC day, for the daily budget."""

    __tablename__ = "device_live_usage"
    __table_args__ = (CheckConstraint("live_seconds >= 0", name="live_seconds_not_negative"),)

    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="RESTRICT"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    live_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


def _range_check(column: str, bounds: tuple[float, float]) -> CheckConstraint:
    low, high = bounds
    return CheckConstraint(f"{column} IS NULL OR ({column} >= {low} AND {column} <= {high})", name=f"{column}_range")


class SensorReading(Base):
    """One sample from a sensor station. A sensor that failed to read stores NULL, never a stale value."""

    __tablename__ = "sensor_readings"
    __table_args__ = (
        _range_check("temperature_c", TEMPERATURE_RANGE),
        _range_check("humidity_pct", HUMIDITY_RANGE),
        _range_check("weight_g", WEIGHT_RANGE),
        _range_check("ph_value", PH_RANGE),
        _range_check("ph_voltage", PH_VOLTAGE_RANGE),
        Index("ix_sensor_readings_device_id_recorded_at", "device_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="RESTRICT"))
    # When the sample was taken, on the server clock (derived from the device's uptime offsets).
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    device_uptime_ms: Mapped[int | None] = mapped_column(BigInteger)
    temperature_c: Mapped[float | None] = mapped_column(Float)
    humidity_pct: Mapped[float | None] = mapped_column(Float)
    weight_g: Mapped[float | None] = mapped_column(Float)
    # Experimental: never used on its own to decide whether food is safe.
    ph_value: Mapped[float | None] = mapped_column(Float)
    ph_voltage: Mapped[float | None] = mapped_column(Float)
    dht_ok: Mapped[bool] = mapped_column(Boolean)
    load_cell_ok: Mapped[bool] = mapped_column(Boolean)
