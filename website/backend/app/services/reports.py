"""Stock, expiry, environment and waste reports (M13), as one neutral structure.

Every report is a `Report`: a title, the filters used and one or more tables
(`Section`) of plain strings. The JSON preview, the CSV and the PDF are all
rendered from that same structure, so what staff see on screen is exactly what
they download. Nothing here reads the clock: `today` and `generated_at` are
passed in.

Rules:

- Stock "remaining" counts only batches that are not expired (an expiry date
  is usable through its last day, as in `services/expiry.py`). Low stock means
  the ingredient has a reorder level and its remaining quantity is at or below it.
- Environment figures are SQL aggregates over `sensor_readings` (the table can
  be large); only temperature and humidity are reported. pH is experimental and
  is deliberately not part of any report.
- Date ranges are whole UTC days, both ends inclusive, at most `MAX_RANGE_DAYS`.
- Each table is capped at `MAX_ROWS` rows; when it is cut, `truncated` is set and
  a note says how many rows exist.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models.alerts import Alert
from app.models.devices import Device, SensorReading
from app.models.inventory import Batch, Ingredient, StorageArea, Unit
from app.models.waste import WasteRecord

ReportKind = Literal["stock", "expiry", "environment", "waste"]
ReportFormat = Literal["json", "csv", "pdf"]

MAX_ROWS = 5000
MAX_RANGE_DAYS = 31
DEFAULT_RANGE_DAYS = 7
DEFAULT_WINDOW_DAYS = 7
MAX_WINDOW_DAYS = 90
DISCLAIMER = "EcoPantry is a prototype, not a certified food-safety system."

ENVIRONMENT_METRICS = (("temperature_c", "Temperature (°C)"), ("humidity_pct", "Humidity (%RH)"))


@dataclass
class Section:
    title: str
    columns: list[str]
    rows: list[list[str]]
    total_rows: int  # rows that exist; more than len(rows) when truncated

    @property
    def truncated(self) -> bool:
        return self.total_rows > len(self.rows)


@dataclass
class Report:
    kind: ReportKind
    title: str
    generated_at: datetime
    filters: list[tuple[str, str]]
    sections: list[Section] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def num(value: Decimal | float | None, places: int = 3) -> str:
    if value is None:
        return ""
    return f"{value:.{places}f}"


def day_bounds(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """Half-open UTC interval covering both days entirely."""
    return (
        datetime(date_from.year, date_from.month, date_from.day, tzinfo=UTC),
        datetime(date_to.year, date_to.month, date_to.day, tzinfo=UTC) + timedelta(days=1),
    )


def stamp(value: datetime | None) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%d %H:%M") if value else ""


def _section(db: Session, title: str, columns: list[str], statement: Select[Any], to_row: Any) -> Section:
    """Run `statement` with the row cap; count the full set only when it was cut."""
    limit = MAX_ROWS
    fetched = db.execute(statement.limit(limit + 1)).all()
    total = len(fetched)
    if total > limit:
        total = int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)
    return Section(title, columns, [to_row(r) for r in fetched[:limit]], total)


def _truncation_notes(sections: list[Section]) -> list[str]:
    return [
        f'Truncated: "{s.title}" shows the first {len(s.rows)} of {s.total_rows} rows.' for s in sections if s.truncated
    ]


# --- stock ---------------------------------------------------------------------


def stock_report(db: Session, *, today: date, generated_at: datetime) -> Report:
    usable = func.coalesce(func.sum(Batch.remaining_quantity).filter(Batch.expiry_on >= today), 0)
    ingredients = (
        select(Ingredient.name, Unit.code, Ingredient.reorder_level, usable)
        .join(Unit, Ingredient.unit_id == Unit.id)
        .outerjoin(Batch, Batch.ingredient_id == Ingredient.id)
        .where(Ingredient.is_active)
        .group_by(Ingredient.id, Unit.code)
        .order_by(func.lower(Ingredient.name), Ingredient.id)
    )

    def ingredient_row(r: Any) -> list[str]:
        name, unit, reorder, total = r
        low = reorder is not None and total <= reorder
        return [name, unit, num(reorder), num(total), "Low" if low else "OK"]

    batches = (
        select(Batch.label_code, Ingredient.name, StorageArea.name, Batch.expiry_on, Batch.remaining_quantity, Unit.code)
        .join(Ingredient, Batch.ingredient_id == Ingredient.id)
        .join(Unit, Ingredient.unit_id == Unit.id)
        .outerjoin(StorageArea, Batch.storage_area_id == StorageArea.id)
        .where(Batch.remaining_quantity > 0)
        .order_by(func.lower(Ingredient.name), Batch.expiry_on, Batch.id)
    )

    def batch_row(r: Any) -> list[str]:
        label, name, area, expiry, remaining, unit = r
        return [label, name, area or "", expiry.isoformat(), num(remaining), unit, "Expired" if expiry < today else "Usable"]

    sections = [
        _section(
            db,
            "Ingredients",
            ["Ingredient", "Unit", "Reorder level", "Remaining (not expired)", "Stock"],
            ingredients,
            ingredient_row,
        ),
        _section(
            db,
            "Batches in stock",
            ["Label", "Ingredient", "Storage area", "Expiry", "Remaining", "Unit", "Status"],
            batches,
            batch_row,
        ),
    ]
    return Report(
        "stock",
        "Stock report",
        generated_at,
        [("As of", today.isoformat())],
        sections,
        ["Remaining quantity excludes expired batches. Low means at or below the reorder level."]
        + _truncation_notes(sections),
    )


# --- expiry --------------------------------------------------------------------


def expiry_report(db: Session, *, today: date, days: int, generated_at: datetime) -> Report:
    base = (
        select(Batch.label_code, Ingredient.name, StorageArea.name, Batch.expiry_on, Batch.remaining_quantity, Unit.code)
        .join(Ingredient, Batch.ingredient_id == Ingredient.id)
        .join(Unit, Ingredient.unit_id == Unit.id)
        .outerjoin(StorageArea, Batch.storage_area_id == StorageArea.id)
        .where(Batch.remaining_quantity > 0)
        .order_by(Batch.expiry_on, Batch.id)
    )
    columns = ["Label", "Ingredient", "Storage area", "Expiry", "Days left", "Remaining", "Unit"]

    def row(r: Any) -> list[str]:
        label, name, area, expiry, remaining, unit = r
        return [label, name, area or "", expiry.isoformat(), str((expiry - today).days), num(remaining), unit]

    near = base.where(Batch.expiry_on >= today, Batch.expiry_on <= today + timedelta(days=days))
    gone = base.where(Batch.expiry_on < today)
    sections = [
        _section(db, f"Expiring within {days} days", columns, near, row),
        _section(db, "Expired, still in stock", columns, gone, row),
    ]
    return Report(
        "expiry",
        "Expiry report",
        generated_at,
        [("As of", today.isoformat()), ("Window", f"{days} days")],
        sections,
        ["A batch is usable through its expiry date. Expired batches must not be used."] + _truncation_notes(sections),
    )


# --- environment ---------------------------------------------------------------


def _alerts_section(db: Session, title: str, metrics: tuple[str, ...], start: datetime, end: datetime) -> Section:
    statement = (
        select(Alert.opened_at, Device.name, Alert.metric, Alert.severity, Alert.status, Alert.message, Alert.trigger_value)
        .join(Device, Alert.device_id == Device.id)
        .where(Alert.metric.in_(metrics), Alert.opened_at >= start, Alert.opened_at < end)
        .order_by(Alert.opened_at, Alert.id)
    )
    return _section(
        db,
        title,
        ["Opened (UTC)", "Station", "Metric", "Severity", "Status", "Message", "Trigger value"],
        statement,
        lambda r: [stamp(r[0]), r[1], r[2], r[3], r[4], r[5], num(r[6], 2)],
    )


def environment_report(db: Session, *, date_from: date, date_to: date, generated_at: datetime) -> Report:
    start, end = day_bounds(date_from, date_to)
    rows: list[list[str]] = []
    for metric, label in ENVIRONMENT_METRICS:
        column = getattr(SensorReading, metric)
        aggregate = (
            select(Device.name, func.count(column), func.min(column), func.avg(column), func.max(column))
            .join(Device, SensorReading.device_id == Device.id)
            .where(SensorReading.recorded_at >= start, SensorReading.recorded_at < end, column.is_not(None))
            .group_by(Device.id, Device.name)
            .order_by(Device.name, Device.id)
        )
        for name, count, low, mean, high in db.execute(aggregate):
            rows.append([name, label, str(count), num(low, 1), num(mean, 1), num(high, 1)])
    summary = Section("Readings summary", ["Station", "Metric", "Readings", "Min", "Average", "Max"], rows, len(rows))
    alerts = _alerts_section(db, "Alerts opened", tuple(m for m, _ in ENVIRONMENT_METRICS), start, end)
    notes = ["Temperature and humidity only. pH is experimental and is not reported."]
    if not rows:
        notes.append("No readings were stored in this period (stations only upload during live sessions).")
    return Report(
        "environment",
        "Environment report",
        generated_at,
        [("From", date_from.isoformat()), ("To", date_to.isoformat()), ("Timezone", "UTC")],
        [summary, alerts],
        notes + _truncation_notes([alerts]),
    )


# --- waste ---------------------------------------------------------------------


def waste_report(db: Session, *, date_from: date, date_to: date, generated_at: datetime) -> Report:
    start, end = day_bounds(date_from, date_to)
    in_range = (WasteRecord.recorded_at >= start, WasteRecord.recorded_at < end)
    by_category = (
        select(
            WasteRecord.category,
            func.count(WasteRecord.id),
            func.count(WasteRecord.weight_kg),
            func.coalesce(func.sum(WasteRecord.weight_kg), 0),
        )
        .where(*in_range)
        .group_by(WasteRecord.category)
        .order_by(WasteRecord.category)
    )
    category_rows = [[c, str(n), str(w), num(total)] for c, n, w, total in db.execute(by_category)]
    categories = Section(
        "Waste by category",
        ["Category", "Records", "Weighed records", "Total weight (kg)"],
        category_rows,
        len(category_rows),
    )
    records_statement = (
        select(WasteRecord.recorded_at, WasteRecord.category, WasteRecord.weight_kg, Batch.label_code, WasteRecord.reason)
        .outerjoin(Batch, WasteRecord.batch_id == Batch.id)
        .where(*in_range)
        .order_by(WasteRecord.recorded_at.desc(), WasteRecord.id)
    )
    records = _section(
        db,
        "Waste records",
        ["Recorded (UTC)", "Category", "Weight (kg)", "Batch label", "Reason"],
        records_statement,
        lambda r: [stamp(r[0]), r[1], num(r[2]), r[3] or "", r[4] or ""],
    )
    alerts = _alerts_section(db, "Waste bin weight alerts", ("weight_g",), start, end)
    return Report(
        "waste",
        "Waste report",
        generated_at,
        [("From", date_from.isoformat()), ("To", date_to.isoformat()), ("Timezone", "UTC")],
        [categories, records, alerts],
        ["Total weight counts only records that were weighed. Bin alert values are in grams."]
        + _truncation_notes([records, alerts]),
    )
