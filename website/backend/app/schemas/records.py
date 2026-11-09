"""Waste and pH record schemas. Quantities are decimal strings in JSON (e.g. "1.250")."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.models.ph import PhRecord
from app.models.waste import WasteRecord

WasteCategory = Literal["expired", "spoiled", "damaged", "production_offcut", "other"]

PH_EXPERIMENTAL_NOTE = (
    "Experimental: pH from a hobby-grade probe is a note about a sample, never a verdict. "
    "It must not be used alone to decide whether food is safe or spoiled. EcoPantry is not a certified "
    "food-safety system."
)


class EmployeeRef(BaseModel):
    id: uuid.UUID
    full_name: str


# --- waste ------------------------------------------------------------------


class WasteRecordCreate(BaseModel):
    category: WasteCategory
    reason: str | None = Field(default=None, max_length=2000, description="Required when the category is `other`.")
    weight_kg: Decimal | None = Field(default=None, ge=0, le=Decimal("99999.999"))
    batch_id: uuid.UUID | None = None
    recorded_at: datetime | None = Field(default=None, description="When the waste happened; defaults to now.")


class WasteRecordOut(BaseModel):
    id: uuid.UUID
    category: WasteCategory
    reason: str | None
    weight_kg: Decimal | None
    batch_id: uuid.UUID | None
    employee: EmployeeRef
    recorded_at: datetime
    created_at: datetime

    @classmethod
    def from_record(cls, record: WasteRecord, employee: EmployeeRef) -> "WasteRecordOut":
        return cls(
            id=record.id,
            category=record.category,  # type: ignore[arg-type]
            reason=record.reason,
            weight_kg=record.weight_kg,
            batch_id=record.batch_id,
            employee=employee,
            recorded_at=record.recorded_at,
            created_at=record.created_at,
        )


class WasteCategoryTotal(BaseModel):
    category: WasteCategory
    records: int
    weight_kg: Decimal = Field(description="Sum of the weighed records; records without a weight add nothing.")


class WasteSummaryOut(BaseModel):
    date_from: date | None
    date_to: date | None
    records: int
    weight_kg: Decimal
    by_category: list[WasteCategoryTotal]


# --- pH ---------------------------------------------------------------------


class PhRecordCreate(BaseModel):
    sample_description: str = Field(max_length=2000)
    batch_id: uuid.UUID | None = None
    ph_value: Decimal = Field(ge=0, le=14, max_digits=6, decimal_places=3)
    reference_min: Decimal | None = Field(default=None, ge=0, le=14, max_digits=6, decimal_places=3)
    reference_max: Decimal | None = Field(default=None, ge=0, le=14, max_digits=6, decimal_places=3)
    calibration_note: str | None = Field(default=None, max_length=2000)
    sensor_reading_id: int | None = Field(default=None, ge=1)
    recorded_at: datetime | None = None


class PhRecordOut(BaseModel):
    id: uuid.UUID
    sample_description: str
    batch_id: uuid.UUID | None
    ph_value: Decimal
    reference_min: Decimal | None
    reference_max: Decimal | None
    calibration_note: str | None
    sensor_reading_id: int | None
    operator: EmployeeRef
    recorded_at: datetime
    created_at: datetime
    experimental: Literal[True] = True
    note: str = PH_EXPERIMENTAL_NOTE

    @classmethod
    def from_record(cls, record: PhRecord, operator: EmployeeRef) -> "PhRecordOut":
        return cls(
            id=record.id,
            sample_description=record.sample_description,
            batch_id=record.batch_id,
            ph_value=record.ph_value,
            reference_min=record.reference_min,
            reference_max=record.reference_max,
            calibration_note=record.calibration_note,
            sensor_reading_id=record.sensor_reading_id,
            operator=operator,
            recorded_at=record.recorded_at,
            created_at=record.created_at,
        )
