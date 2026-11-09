"""Expiry list and FEFO schemas. Quantities are decimal strings in JSON."""

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.inventory import Batch
from app.services.expiry import FefoBatch, FefoPlan, days_left


class ExpiryIngredient(BaseModel):
    id: uuid.UUID
    name: str
    unit: str = Field(description="Unit code, e.g. `kg`.")


class ExpiryArea(BaseModel):
    id: uuid.UUID
    name: str


class ExpiryBatchOut(BaseModel):
    id: uuid.UUID
    label_code: str
    ingredient: ExpiryIngredient
    storage_area: ExpiryArea | None
    received_on: date
    expiry_on: date
    quantity: Decimal
    remaining_quantity: Decimal
    days_left: int = Field(description="Whole days until expiry: 0 on the expiry date, negative once expired.")

    @classmethod
    def from_batch(cls, batch: Batch, today: date) -> "ExpiryBatchOut":
        area = batch.storage_area
        return cls(
            id=batch.id,
            label_code=batch.label_code,
            ingredient=ExpiryIngredient(
                id=batch.ingredient.id, name=batch.ingredient.name, unit=batch.ingredient.unit.code
            ),
            storage_area=ExpiryArea(id=area.id, name=area.name) if area else None,
            received_on=batch.received_on,
            expiry_on=batch.expiry_on,
            quantity=batch.quantity,
            remaining_quantity=batch.remaining_quantity,
            days_left=days_left(batch.expiry_on, today),
        )


class ExpirySummary(BaseModel):
    today: date
    window_days: int = Field(description="The near-expiry window used: expiry within this many days, today included.")
    near_expiry: int = Field(description="Batches with stock expiring today or within the window.")
    expired: int = Field(description="Batches with stock whose expiry date is before today.")


class FefoBatchOut(BaseModel):
    id: uuid.UUID
    label_code: str
    received_on: date
    expiry_on: date
    remaining_quantity: Decimal
    days_left: int

    @classmethod
    def of(cls, batch: FefoBatch, today: date) -> "FefoBatchOut":
        return cls(
            id=batch.id,
            label_code=batch.label_code,
            received_on=batch.received_on,
            expiry_on=batch.expiry_on,
            remaining_quantity=batch.remaining_quantity,
            days_left=days_left(batch.expiry_on, today),
        )


class FefoPickOut(BaseModel):
    batch: FefoBatchOut
    take: Decimal = Field(description="How much to take from this batch.")


class FefoOut(BaseModel):
    today: date
    ingredient: ExpiryIngredient
    usable: list[FefoBatchOut] = Field(description="Use in this order: earliest expiry first.")
    expired: list[FefoBatchOut] = Field(description="Still in stock but past expiry. Do not use.")
    requested: Decimal | None = None
    pick: list[FefoPickOut] | None = Field(default=None, description="Only when `quantity` was sent.")
    allocated: Decimal | None = None
    shortfall: Decimal | None = Field(default=None, description="Requested minus what usable stock covers; 0 if enough.")
    sufficient: bool | None = None

    @classmethod
    def of(cls, plan: FefoPlan, ingredient: ExpiryIngredient, today: date) -> "FefoOut":
        pick = None
        if plan.requested is not None:
            pick = [FefoPickOut(batch=FefoBatchOut.of(p.batch, today), take=p.take) for p in plan.pick]
        return cls(
            today=today,
            ingredient=ingredient,
            usable=[FefoBatchOut.of(b, today) for b in plan.usable],
            expired=[FefoBatchOut.of(b, today) for b in plan.expired],
            requested=plan.requested,
            pick=pick,
            allocated=plan.allocated,
            shortfall=plan.shortfall,
            sufficient=plan.sufficient,
        )
