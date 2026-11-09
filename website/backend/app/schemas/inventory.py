"""Inventory reference data schemas: units, ingredients, storage areas.

Request models use generous limits; the service trims whitespace and applies
the real ones. Quantities are decimal strings in JSON (e.g. "2.500").
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.models.inventory import NOTES_MAX_LENGTH, Ingredient, StorageArea, Unit

MAX_QUANTITY = Decimal("999999999.999")

StorageAreaKind = Literal["fridge", "freezer", "shelf", "other"]


class UnitOut(BaseModel):
    code: str
    name: str
    kind: Literal["mass", "volume", "count"]

    @classmethod
    def from_unit(cls, unit: Unit) -> "UnitOut":
        return cls(code=unit.code, name=unit.name, kind=unit.kind)  # type: ignore[arg-type]


# --- ingredients ------------------------------------------------------------


class IngredientOut(BaseModel):
    id: uuid.UUID
    name: str
    unit: UnitOut
    reorder_level: Decimal | None = Field(description="Decimal string in the ingredient's unit; null: no low-stock warning.")
    notes: str | None
    is_active: bool
    deactivated_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_ingredient(cls, ingredient: Ingredient) -> "IngredientOut":
        return cls(
            id=ingredient.id,
            name=ingredient.name,
            unit=UnitOut.from_unit(ingredient.unit),
            reorder_level=ingredient.reorder_level,
            notes=ingredient.notes,
            is_active=ingredient.is_active,
            deactivated_at=ingredient.deactivated_at,
            created_at=ingredient.created_at,
            updated_at=ingredient.updated_at,
        )


ReorderLevel = Decimal | None


class IngredientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    unit: str = Field(min_length=1, max_length=8, description="Unit code from `GET /units`, e.g. `kg`.")
    reorder_level: ReorderLevel = Field(default=None, ge=0, le=MAX_QUANTITY, max_digits=12, decimal_places=3)
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH * 2)


class IngredientUpdate(BaseModel):
    """Partial update: only the fields present change. Send `null` to clear `reorder_level` or `notes`."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    unit: str | None = Field(default=None, min_length=1, max_length=8)
    reorder_level: ReorderLevel = Field(default=None, ge=0, le=MAX_QUANTITY, max_digits=12, decimal_places=3)
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH * 2)


# --- storage areas ----------------------------------------------------------


class StorageAreaOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: StorageAreaKind
    notes: str | None
    is_active: bool
    deactivated_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_area(cls, area: StorageArea) -> "StorageAreaOut":
        return cls(
            id=area.id,
            name=area.name,
            kind=area.kind,  # type: ignore[arg-type]
            notes=area.notes,
            is_active=area.is_active,
            deactivated_at=area.deactivated_at,
            created_at=area.created_at,
            updated_at=area.updated_at,
        )


class StorageAreaCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: StorageAreaKind
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH * 2)


class StorageAreaUpdate(BaseModel):
    """Partial update: only the fields present change. Send `null` to clear `notes`."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: StorageAreaKind | None = None
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH * 2)
