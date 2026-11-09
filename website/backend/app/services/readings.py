"""Storing station readings and reading them back for the portal. Callers commit.

Readings are not audited (one every few seconds would swamp the audit log);
they carry their device and timestamps instead.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import TooManyRequestsError
from app.models.devices import Device, SensorReading
from app.schemas.devices import MAX_READING_AGE_MS, ReadingBatchIn
from app.schemas.sensors import HistoryRange, Metric
from app.services.alerts import evaluate_reading
from app.services.live_sessions import require_live

# Bucket sizes keep every chart at a few hundred points at most.
BUCKETS: dict[HistoryRange, tuple[timedelta, timedelta]] = {
    HistoryRange.HOUR: (timedelta(hours=1), timedelta(seconds=10)),
    HistoryRange.SIX_HOURS: (timedelta(hours=6), timedelta(minutes=1)),
    HistoryRange.DAY: (timedelta(hours=24), timedelta(minutes=5)),
    HistoryRange.WEEK: (timedelta(days=7), timedelta(minutes=30)),
}
_BUCKET_ORIGIN = datetime(2000, 1, 1, tzinfo=UTC)


class UploadTooSoonError(TooManyRequestsError):
    code = "upload_too_soon"
    detail = "Readings are arriving faster than the station's report interval."


def ingest(db: Session, settings: Settings, device: Device, batch: ReadingBatchIn, now: datetime) -> int:
    """Store a batch from a live station. Returns how many readings were stored."""
    require_live(device, now)
    minimum = timedelta(seconds=settings.device_min_report_interval_seconds)
    if device.last_reading_at is not None and now - device.last_reading_at < minimum:
        raise UploadTooSoonError(headers={"Retry-After": str(settings.device_min_report_interval_seconds)})

    stored = 0
    newest: SensorReading | None = None
    for reading in batch.readings:
        age_ms = batch.sent_uptime_ms - reading.uptime_ms
        if age_ms > MAX_READING_AGE_MS:
            continue
        row = (
            SensorReading(
                device_id=device.id,
                recorded_at=now - timedelta(milliseconds=age_ms),
                received_at=now,
                device_uptime_ms=reading.uptime_ms,
                temperature_c=reading.temperature_c,
                humidity_pct=reading.humidity_pct,
                weight_g=reading.weight_g,
                ph_value=reading.ph_value,
                ph_voltage=reading.ph_voltage,
                dht_ok=reading.dht_ok,
                load_cell_ok=reading.load_cell_ok,
            )
        )
        db.add(row)
        if newest is None or row.recorded_at >= newest.recorded_at:
            newest = row
        stored += 1
    device.last_reading_at = now
    if newest is not None:
        # Same transaction as the stored readings. Only the newest one, so a backlog costs one evaluation.
        db.flush()
        evaluate_reading(db, device, newest)
    return stored


def latest_reading(db: Session, device: Device) -> SensorReading | None:
    return db.scalar(
        select(SensorReading)
        .where(SensorReading.device_id == device.id)
        .order_by(SensorReading.recorded_at.desc())
        .limit(1)
    )


def is_stale(reading: SensorReading | None, settings: Settings, now: datetime) -> bool:
    if reading is None:
        return True
    return now - reading.recorded_at > timedelta(seconds=3 * settings.device_report_interval_seconds)


def history(
    db: Session, device_id: uuid.UUID, metric: Metric, range_: HistoryRange, now: datetime
) -> tuple[int, list[tuple[datetime, float, float, float, int]]]:
    """Bucketed (start, avg, min, max, count) rows for one metric; empty buckets are left out."""
    span, bucket = BUCKETS[range_]
    column = getattr(SensorReading, metric.value)
    start = func.date_bin(bucket, SensorReading.recorded_at, _BUCKET_ORIGIN).label("t")
    rows = db.execute(
        select(start, func.avg(column), func.min(column), func.max(column), func.count(column))
        .where(
            SensorReading.device_id == device_id,
            SensorReading.recorded_at >= now - span,
            SensorReading.recorded_at <= now,
            column.is_not(None),
        )
        .group_by(start)
        .order_by(start)
    ).all()
    return int(bucket.total_seconds()), [(t, float(avg), float(low), float(high), int(n)) for t, avg, low, high, n in rows]
