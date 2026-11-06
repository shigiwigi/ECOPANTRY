"""Sensor readings as the portal sees them. Never public."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Metric(StrEnum):
    TEMPERATURE = "temperature_c"
    HUMIDITY = "humidity_pct"
    WEIGHT = "weight_g"
    PH = "ph_value"
    PH_VOLTAGE = "ph_voltage"


class HistoryRange(StrEnum):
    HOUR = "1h"
    SIX_HOURS = "6h"
    DAY = "24h"
    WEEK = "7d"


class LatestReadingOut(BaseModel):
    recorded_at: datetime
    temperature_c: float | None
    humidity_pct: float | None
    weight_g: float | None
    ph_value: float | None = Field(description="Experimental. Never use it alone to decide whether food is safe.")
    ph_voltage: float | None
    dht_ok: bool
    load_cell_ok: bool


class StationOut(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    firmware_version: str | None
    last_seen_at: datetime | None
    live: bool
    live_until: datetime | None
    stale: bool = Field(description="True when the latest reading is older than three report intervals.")
    report_interval_seconds: int
    latest: LatestReadingOut | None


class StationsOut(BaseModel):
    server_time: datetime
    stations: list[StationOut]


class HistoryPoint(BaseModel):
    t: datetime = Field(description="Start of the bucket.")
    avg: float
    min: float
    max: float
    count: int


class HistoryOut(BaseModel):
    device_id: uuid.UUID
    metric: Metric
    range: HistoryRange
    bucket_seconds: int
    points: list[HistoryPoint]
