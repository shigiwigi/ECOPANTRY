"""Waste and pH records. Callers commit; each record is audited in the same transaction.

Records are history: they're never edited or deleted here. Waste is attributed to the signed-in
employee. pH records are EXPERIMENTAL notes about a sample, with no safe/spoiled verdict anywhere.
"""

import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.auth.service import utcnow
from app.core.errors import AppError
from app.models.auth import Employee
from app.models.devices import SensorReading
from app.models.inventory import Batch
from app.models.ph import CALIBRATION_NOTE_MAX_LENGTH, SAMPLE_DESCRIPTION_MAX_LENGTH, PhRecord
from app.models.waste import WASTE_CATEGORIES, WASTE_REASON_MAX_LENGTH, WasteRecord
from app.schemas.records import EmployeeRef, WasteCategoryTotal, WasteSummaryOut
from app.services.audit import ClientInfo, record_event


class InvalidRecordError(AppError):
    status_code = 400
    code = "invalid_record"


def _clean(value: str | None, *, field: str, max_length: int) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    if len(cleaned) > max_length:
        raise InvalidRecordError(f"Keep the {field} to {max_length} characters or fewer.")
    return cleaned or None


def _check_batch(db: Session, batch_id: uuid.UUID | None) -> None:
    if batch_id is not None and db.get(Batch, batch_id) is None:
        raise InvalidRecordError("That batch doesn't exist.", code="unknown_batch")


def _check_time(recorded_at: datetime | None) -> datetime:
    now = utcnow()
    if recorded_at is None:
        return now
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=UTC)
    if recorded_at > now + timedelta(minutes=5):
        raise InvalidRecordError("The time can't be in the future.")
    return recorded_at


def employee_refs(db: Session, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, EmployeeRef]:
    wanted = set(ids)
    if not wanted:
        return {}
    rows = db.execute(select(Employee.id, Employee.full_name).where(Employee.id.in_(wanted)))
    return {row.id: EmployeeRef(id=row.id, full_name=row.full_name) for row in rows}


def _to_places(value: object, step: str) -> Decimal | None:
    return None if value is None else Decimal(str(value)).quantize(Decimal(step))


def _two_places(value: object) -> Decimal | None:
    return _to_places(value, "0.01")


# --- waste ------------------------------------------------------------------


def create_waste_record(db: Session, data: dict[str, Any], *, by: Employee, client: ClientInfo) -> WasteRecord:
    category = str(data["category"])
    if category not in WASTE_CATEGORIES:
        raise InvalidRecordError("Choose a waste category.")
    reason = _clean(data.get("reason"), field="reason", max_length=WASTE_REASON_MAX_LENGTH)
    if category == "other" and reason is None:
        raise InvalidRecordError("Say what happened when the category is Other.", code="reason_required")
    batch_id = data.get("batch_id")
    _check_batch(db, batch_id)
    record = WasteRecord(
        category=category,
        reason=reason,
        weight_kg=_to_places(data.get("weight_kg"), "0.001"),
        batch_id=batch_id,
        employee_id=by.id,
        recorded_at=_check_time(data.get("recorded_at")),
    )
    db.add(record)
    db.flush()
    record_event(
        db,
        "waste.recorded",
        actor=by,
        target=record,
        client=client,
        details={
            "category": category,
            "weight_kg": str(record.weight_kg) if record.weight_kg is not None else None,
            "batch_id": str(batch_id) if batch_id else None,
        },
    )
    return record


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def waste_filters(
    statement: Select[Any],
    *,
    category: str | None,
    date_from: date | None,
    date_to: date | None,
    employee_id: uuid.UUID | None,
) -> Select[Any]:
    """Filter by category, employee and whole UTC days (`date_to` is inclusive)."""
    if category:
        statement = statement.where(WasteRecord.category == category)
    if date_from:
        statement = statement.where(WasteRecord.recorded_at >= _day_start(date_from))
    if date_to:
        statement = statement.where(WasteRecord.recorded_at < _day_start(date_to + timedelta(days=1)))
    if employee_id:
        statement = statement.where(WasteRecord.employee_id == employee_id)
    return statement


def waste_summary(db: Session, *, date_from: date | None, date_to: date | None) -> WasteSummaryOut:
    statement = waste_filters(
        select(WasteRecord.category, func.count(), func.coalesce(func.sum(WasteRecord.weight_kg), 0)),
        category=None,
        date_from=date_from,
        date_to=date_to,
        employee_id=None,
    ).group_by(WasteRecord.category)
    totals = {row[0]: (int(row[1]), Decimal(row[2])) for row in db.execute(statement)}
    by_category = [
        WasteCategoryTotal(category=c, records=totals.get(c, (0, Decimal(0)))[0], weight_kg=totals.get(c, (0, Decimal(0)))[1])  # type: ignore[arg-type]
        for c in WASTE_CATEGORIES
    ]
    return WasteSummaryOut(
        date_from=date_from,
        date_to=date_to,
        records=sum(t.records for t in by_category),
        weight_kg=sum((t.weight_kg for t in by_category), Decimal(0)),
        by_category=by_category,
    )


# --- pH (experimental) ------------------------------------------------------


def create_ph_record(db: Session, data: dict[str, Any], *, by: Employee, client: ClientInfo) -> PhRecord:
    sample = _clean(data["sample_description"], field="sample description", max_length=SAMPLE_DESCRIPTION_MAX_LENGTH)
    if sample is None:
        raise InvalidRecordError("Describe the sample that was measured.")
    note = _clean(data.get("calibration_note"), field="calibration note", max_length=CALIBRATION_NOTE_MAX_LENGTH)
    ref_min, ref_max = _two_places(data.get("reference_min")), _two_places(data.get("reference_max"))
    if (ref_min is None) != (ref_max is None):
        raise InvalidRecordError("Give both ends of the reference range, or neither.", code="reference_range_incomplete")
    if ref_min is not None and ref_max is not None and ref_min > ref_max:
        raise InvalidRecordError("The reference minimum can't be above the maximum.", code="reference_range_invalid")
    batch_id = data.get("batch_id")
    _check_batch(db, batch_id)
    reading_id = data.get("sensor_reading_id")
    if reading_id is not None and db.get(SensorReading, reading_id) is None:
        raise InvalidRecordError("That sensor reading doesn't exist.", code="unknown_reading")
    record = PhRecord(
        sample_description=sample,
        batch_id=batch_id,
        ph_value=_two_places(data["ph_value"]),
        reference_min=ref_min,
        reference_max=ref_max,
        calibration_note=note,
        sensor_reading_id=reading_id,
        operator_id=by.id,
        recorded_at=_check_time(data.get("recorded_at")),
    )
    db.add(record)
    db.flush()
    record_event(
        db,
        "ph.recorded",
        actor=by,
        target=record,
        client=client,
        details={"ph_value": str(record.ph_value), "batch_id": str(batch_id) if batch_id else None, "experimental": True},
    )
    return record
