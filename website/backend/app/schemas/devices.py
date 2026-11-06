"""Device schemas: what a sensor station sends and receives, and the admin view of a device.

Device-facing responses stay small (the ESP32 parses them with ArduinoJson)
and always say whether the station is live and for how long, in seconds,
because the station has no wall clock.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.devices import (
    HUMIDITY_RANGE,
    PH_RANGE,
    PH_VOLTAGE_RANGE,
    TEMPERATURE_RANGE,
    WEIGHT_RANGE,
    Device,
)

MAX_BATCH = 50
# Buffered readings older than this are dropped rather than stored with a doubtful timestamp.
MAX_READING_AGE_MS = 60 * 60 * 1000

# --- staff (admin) ----------------------------------------------------------


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class DeviceOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    status: str
    token_prefix: str = Field(description="First characters of the current token, to tell tokens apart.")
    firmware_version: str | None
    last_seen_at: datetime | None
    last_reading_at: datetime | None
    live: bool
    live_until: datetime | None
    live_started_at: datetime | None
    created_at: datetime

    @classmethod
    def from_device(cls, device: Device, now: datetime) -> "DeviceOut":
        live = device.is_live(now)
        return cls(
            id=device.id,
            name=device.name,
            kind=device.kind,
            status=device.status,
            token_prefix=device.token_prefix,
            firmware_version=device.firmware_version,
            last_seen_at=device.last_seen_at,
            last_reading_at=device.last_reading_at,
            live=live,
            live_until=device.live_until if live else None,
            live_started_at=device.live_started_at if live else None,
            created_at=device.created_at,
        )


class DeviceWithToken(BaseModel):
    device: DeviceOut
    token: str = Field(description="Shown once. Put it in the station's secrets.h; it can't be read back later.")


# --- device-facing ----------------------------------------------------------


class LiveStatusOut(BaseModel):
    live: bool
    live_seconds_remaining: int = Field(description="0 when not live. The station pauses uploads when it reaches 0.")
    budget_exhausted: bool = Field(description="True when today's live-time budget is used up.")
    report_interval_seconds: int


class ReadingIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")

    uptime_ms: int = Field(ge=0, description="Station uptime (millis()) when the sample was taken.")
    temperature_c: float | None = Field(default=None, ge=TEMPERATURE_RANGE[0], le=TEMPERATURE_RANGE[1])
    humidity_pct: float | None = Field(default=None, ge=HUMIDITY_RANGE[0], le=HUMIDITY_RANGE[1])
    weight_g: float | None = Field(default=None, ge=WEIGHT_RANGE[0], le=WEIGHT_RANGE[1])
    ph_value: float | None = Field(default=None, ge=PH_RANGE[0], le=PH_RANGE[1])
    ph_voltage: float | None = Field(default=None, ge=PH_VOLTAGE_RANGE[0], le=PH_VOLTAGE_RANGE[1])
    dht_ok: bool
    load_cell_ok: bool

    @model_validator(mode="after")
    def _failed_sensors_send_nothing(self) -> "ReadingIn":
        if not self.dht_ok and (self.temperature_c is not None or self.humidity_pct is not None):
            raise ValueError("dht_ok is false, so temperature_c and humidity_pct must be null.")
        if not self.load_cell_ok and self.weight_g is not None:
            raise ValueError("load_cell_ok is false, so weight_g must be null.")
        return self


class ReadingBatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sent_uptime_ms: int = Field(ge=0, description="Station uptime when this request was sent.")
    readings: list[ReadingIn] = Field(min_length=1, max_length=MAX_BATCH)

    @model_validator(mode="after")
    def _samples_are_not_from_the_future(self) -> "ReadingBatchIn":
        if any(reading.uptime_ms > self.sent_uptime_ms for reading in self.readings):
            raise ValueError("A reading's uptime_ms can't be later than sent_uptime_ms.")
        return self


class ReadingsAccepted(LiveStatusOut):
    stored: int = Field(description="Readings stored. Readings older than an hour are dropped.")


class RfidScanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uid: str = Field(min_length=8, max_length=40, description="Card UID, for example D5:61:E9:E7.")


class RfidScanOut(LiveStatusOut):
    result: str = Field(description="granted, unknown_card, card_revoked or employee_inactive.")
    granted: bool
    display_name: str | None = Field(description="Up to 16 characters for the station's LCD; null unless granted.")
