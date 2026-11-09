"""Inventory reference data: units (read-only), ingredients and storage areas. Callers commit.

Ingredients and storage areas are never deleted, only deactivated, because
batches and records point at them. Every change writes an audit event in the
same transaction. Ingredient and area names are not personal data, so they may
appear in audit details.
"""

import re
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Select, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.pagination import contains
from app.auth.service import utcnow
from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.auth import Employee
from app.models.inventory import (
    INGREDIENT_NAME_MAX_LENGTH,
    NOTES_MAX_LENGTH,
    STORAGE_AREA_NAME_MAX_LENGTH,
    Batch,
    Ingredient,
    StorageArea,
    Unit,
)
from app.services.audit import ClientInfo, record_event


class InvalidInventoryEntryError(AppError):
    status_code = 400
    code = "invalid_inventory_entry"


# --- cleaning input ---------------------------------------------------------


def clean_name(value: str, *, field: str, max_length: int) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise InvalidInventoryEntryError(f"Enter a {field}.")
    if len(cleaned) > max_length:
        raise InvalidInventoryEntryError(f"Keep the {field} to {max_length} characters or fewer.")
    return cleaned


def clean_notes(value: str | None) -> str | None:
    if value is None:
        return None
    lines = [line.rstrip() for line in value.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n")]
    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(lines))
    if not cleaned:
        return None
    if len(cleaned) > NOTES_MAX_LENGTH:
        raise InvalidInventoryEntryError(f"Keep the notes to {NOTES_MAX_LENGTH} characters or fewer.")
    return cleaned


def _flush(db: Session, message: str) -> None:
    """Flush, turning a unique-name race into a 409 instead of a 500."""
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(message, code="name_taken") from exc


# --- units ------------------------------------------------------------------


def list_units(db: Session) -> Sequence[Unit]:
    return db.scalars(select(Unit).order_by(Unit.kind, Unit.id)).all()


def unit_by_code(db: Session, code: str) -> Unit:
    unit = db.scalars(select(Unit).where(Unit.code == code.strip().lower())).one_or_none()
    if unit is None:
        raise InvalidInventoryEntryError("Choose one of the listed units.", code="unknown_unit")
    return unit


# --- ingredients ------------------------------------------------------------

INGREDIENT_TAKEN = "An ingredient with that name already exists."


def ingredients_query(*, active: bool | None, search: str | None, unit: str | None) -> Select[tuple[Ingredient]]:
    statement = select(Ingredient)
    if active is not None:
        statement = statement.where(Ingredient.is_active.is_(active))
    if search:
        statement = statement.where(contains(Ingredient.name, search))
    if unit:
        statement = statement.join(Ingredient.unit).where(Unit.code == unit.strip().lower())
    return statement


def get_ingredient(db: Session, ingredient_id: object) -> Ingredient:
    ingredient = db.get(Ingredient, ingredient_id)
    if ingredient is None:
        raise NotFoundError("That ingredient doesn't exist.")
    return ingredient


def _check_ingredient_name_free(db: Session, name: str, *, exclude: Ingredient | None = None) -> None:
    query = select(Ingredient.id).where(func.lower(Ingredient.name) == name.lower())
    if exclude is not None:
        query = query.where(Ingredient.id != exclude.id)
    if db.scalars(query).first() is not None:
        raise ConflictError(INGREDIENT_TAKEN, code="name_taken")


def create_ingredient(db: Session, fields: dict[str, Any], *, by: Employee, client: ClientInfo) -> Ingredient:
    """`fields` are the validated request fields (see `IngredientCreate`)."""
    name = clean_name(fields["name"], field="ingredient name", max_length=INGREDIENT_NAME_MAX_LENGTH)
    _check_ingredient_name_free(db, name)
    unit = unit_by_code(db, fields["unit"])
    ingredient = Ingredient(
        name=name, unit=unit, reorder_level=fields.get("reorder_level"), notes=clean_notes(fields.get("notes"))
    )
    db.add(ingredient)
    _flush(db, INGREDIENT_TAKEN)
    db.refresh(ingredient)
    record_event(
        db, "inventory.ingredient_created", actor=by, target=ingredient, client=client,
        details={"name": name, "unit": unit.code},
    )  # fmt: skip
    return ingredient


def update_ingredient(
    db: Session, ingredient: Ingredient, changes: dict[str, Any], *, by: Employee, client: ClientInfo
) -> Ingredient:
    """`changes` holds only the fields the request sent (see `IngredientUpdate`)."""
    new: dict[str, Any] = {}
    if "name" in changes:
        if changes["name"] is None:
            raise InvalidInventoryEntryError("Enter an ingredient name.")
        new["name"] = clean_name(changes["name"], field="ingredient name", max_length=INGREDIENT_NAME_MAX_LENGTH)
        _check_ingredient_name_free(db, new["name"], exclude=ingredient)
    if "unit" in changes:
        if changes["unit"] is None:
            raise InvalidInventoryEntryError("Choose one of the listed units.", code="unknown_unit")
        unit = unit_by_code(db, changes["unit"])
        if unit.id != ingredient.unit_id and db.scalar(select(exists().where(Batch.ingredient_id == ingredient.id))):
            raise ConflictError(
                "This ingredient already has batches, so its unit can't change. Add a new ingredient instead.",
                code="unit_in_use",
            )
        new["unit_id"] = unit.id
    if "reorder_level" in changes:
        new["reorder_level"] = changes["reorder_level"]
    if "notes" in changes:
        new["notes"] = clean_notes(changes["notes"])

    changed = sorted(field for field, value in new.items() if getattr(ingredient, field) != value)
    if not changed:
        return ingredient
    for field in changed:
        setattr(ingredient, field, new[field])
    _flush(db, INGREDIENT_TAKEN)
    db.refresh(ingredient)
    fields = ["unit" if field == "unit_id" else field for field in changed]
    record_event(db, "inventory.ingredient_updated", actor=by, target=ingredient, client=client, details={"fields": fields})
    return ingredient


def set_ingredient_active(
    db: Session, ingredient: Ingredient, active: bool, *, by: Employee, client: ClientInfo
) -> Ingredient:
    """Deactivate or reactivate. Doing it twice changes nothing and records nothing."""
    if ingredient.is_active == active:
        return ingredient
    ingredient.is_active = active
    ingredient.deactivated_at = None if active else utcnow()
    db.flush()
    db.refresh(ingredient)
    action = "inventory.ingredient_reactivated" if active else "inventory.ingredient_deactivated"
    record_event(db, action, actor=by, target=ingredient, client=client, details={"name": ingredient.name})
    return ingredient


# --- storage areas ----------------------------------------------------------

AREA_TAKEN = "A storage area with that name already exists."


def storage_areas_query(*, active: bool | None, search: str | None, kind: str | None) -> Select[tuple[StorageArea]]:
    statement = select(StorageArea)
    if active is not None:
        statement = statement.where(StorageArea.is_active.is_(active))
    if search:
        statement = statement.where(contains(StorageArea.name, search))
    if kind:
        statement = statement.where(StorageArea.kind == kind)
    return statement


def get_storage_area(db: Session, area_id: object) -> StorageArea:
    area = db.get(StorageArea, area_id)
    if area is None:
        raise NotFoundError("That storage area doesn't exist.")
    return area


def _check_area_name_free(db: Session, name: str, *, exclude: StorageArea | None = None) -> None:
    query = select(StorageArea.id).where(func.lower(StorageArea.name) == name.lower())
    if exclude is not None:
        query = query.where(StorageArea.id != exclude.id)
    if db.scalars(query).first() is not None:
        raise ConflictError(AREA_TAKEN, code="name_taken")


def create_storage_area(db: Session, fields: dict[str, Any], *, by: Employee, client: ClientInfo) -> StorageArea:
    name = clean_name(fields["name"], field="storage area name", max_length=STORAGE_AREA_NAME_MAX_LENGTH)
    _check_area_name_free(db, name)
    area = StorageArea(name=name, kind=fields["kind"], notes=clean_notes(fields.get("notes")))
    db.add(area)
    _flush(db, AREA_TAKEN)
    db.refresh(area)
    record_event(
        db, "inventory.storage_area_created", actor=by, target=area, client=client,
        details={"name": name, "kind": area.kind},
    )  # fmt: skip
    return area


def update_storage_area(
    db: Session, area: StorageArea, changes: dict[str, Any], *, by: Employee, client: ClientInfo
) -> StorageArea:
    new: dict[str, Any] = {}
    if "name" in changes:
        if changes["name"] is None:
            raise InvalidInventoryEntryError("Enter a storage area name.")
        new["name"] = clean_name(changes["name"], field="storage area name", max_length=STORAGE_AREA_NAME_MAX_LENGTH)
        _check_area_name_free(db, new["name"], exclude=area)
    if "kind" in changes:
        if changes["kind"] is None:
            raise InvalidInventoryEntryError("Choose a kind of storage area.")
        new["kind"] = changes["kind"]
    if "notes" in changes:
        new["notes"] = clean_notes(changes["notes"])

    changed = sorted(field for field, value in new.items() if getattr(area, field) != value)
    if not changed:
        return area
    for field in changed:
        setattr(area, field, new[field])
    _flush(db, AREA_TAKEN)
    db.refresh(area)
    record_event(db, "inventory.storage_area_updated", actor=by, target=area, client=client, details={"fields": changed})
    return area


def set_storage_area_active(
    db: Session, area: StorageArea, active: bool, *, by: Employee, client: ClientInfo
) -> StorageArea:
    if area.is_active == active:
        return area
    area.is_active = active
    area.deactivated_at = None if active else utcnow()
    db.flush()
    db.refresh(area)
    action = "inventory.storage_area_reactivated" if active else "inventory.storage_area_deactivated"
    record_event(db, action, actor=by, target=area, client=client, details={"name": area.name})
    return area
