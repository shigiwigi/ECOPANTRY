"""Batch and stock movement schemas. Quantities are decimal strings in JSON (e.g. "2.500")."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.models.inventory import BATCH_NOTES_MAX_LENGTH, MOVEMENT_REASON_MAX_LENGTH, Batch
from app.schemas.inventory import MAX_QUANTITY

BatchStatus = Literal["available", "near_expiry", "expired", "depleted"]
MovementKind = Literal["in", "out", "adjust"]


class BatchIngredient(BaseModel):
    id: uuid.UUID
    name: str
    unit: str = Field(description="Unit code, e.g. `kg`.")


class BatchArea(BaseModel):
    id: uuid.UUID
    name: str


class BatchOut(BaseModel):
    id: uuid.UUID
    label_code: str
    ingredient: BatchIngredient
    storage_area: BatchArea | None
    received_on: date
    expiry_on: date
    quantity: Decimal = Field(description="Quantity received.")
    remaining_quantity: Decimal
    status: BatchStatus = Field(description="Derived from dates and remaining quantity; never stored.")
    notes: str | None
    created_at: datetime

    @classmethod
    def from_batch(cls, batch: Batch, status: BatchStatus) -> "BatchOut":
        area = batch.storage_area
        return cls(
            id=batch.id,
            label_code=batch.label_code,
            ingredient=BatchIngredient(
                id=batch.ingredient.id, name=batch.ingredient.name, unit=batch.ingredient.unit.code
            ),
            storage_area=BatchArea(id=area.id, name=area.name) if area else None,
            received_on=batch.received_on,
            expiry_on=batch.expiry_on,
            quantity=batch.quantity,
            remaining_quantity=batch.remaining_quantity,
            status=status,
            notes=batch.notes,
            created_at=batch.created_at,
        )


class MovementOut(BaseModel):
    id: int
    kind: MovementKind
    quantity_delta: Decimal = Field(description="Signed: positive in, negative out, either for an adjustment.")
    remaining_after: Decimal
    reason: str | None
    employee_name: str
    created_at: datetime


class BatchDetail(BatchOut):
    movements: list[MovementOut] = Field(description="Newest first.")


class BatchLookup(BaseModel):
    """What the scanner shows (contract in docs/QR_LABELS.md). Reading it changes nothing."""

    batch_id: uuid.UUID
    code: str
    ingredient_name: str
    received_on: date
    expires_on: date
    status: Literal["in_stock", "used_up", "discarded"]
    remaining_quantity: Decimal
    unit: str
    storage_location: str | None


class BatchReceive(BaseModel):
    ingredient_id: uuid.UUID
    storage_area_id: uuid.UUID | None = None
    quantity: Decimal = Field(gt=0, le=MAX_QUANTITY, max_digits=12, decimal_places=3)
    received_on: date | None = Field(default=None, description="Defaults to today.")
    expiry_on: date
    notes: str | None = Field(default=None, max_length=BATCH_NOTES_MAX_LENGTH * 2)


class ConsumeRequest(BaseModel):
    quantity: Decimal = Field(gt=0, le=MAX_QUANTITY, max_digits=12, decimal_places=3)
    reason: str | None = Field(default=None, max_length=MOVEMENT_REASON_MAX_LENGTH * 2)


class AdjustRequest(BaseModel):
    delta: Decimal = Field(
        ge=-MAX_QUANTITY, le=MAX_QUANTITY, max_digits=12, decimal_places=3,
        description="Signed change to the remaining quantity; not zero.",
    )  # fmt: skip
    reason: str = Field(min_length=1, max_length=MOVEMENT_REASON_MAX_LENGTH * 2)
