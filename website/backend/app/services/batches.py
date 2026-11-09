"""Batches and stock movements. Callers commit.

Every change to a batch's stock goes through `receive_batch`, `consume` or
`adjust`: they lock the batch row (`SELECT ... FOR UPDATE`), write one ledger
line (`stock_movements`, append-only), update `remaining_quantity`, and write an
audit event, all in the caller's transaction. Remaining stock can never go
below zero or above the quantity received. Looking a batch up never changes it.
"""

import uuid
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.pagination import contains
from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.auth import Employee
from app.models.inventory import (
    BATCH_NOTES_MAX_LENGTH,
    MOVEMENT_REASON_MAX_LENGTH,
    Batch,
    Ingredient,
    StockMovement,
)
from app.schemas.batches import BatchStatus
from app.services import inventory as reference
from app.services.audit import ClientInfo, record_event
from app.services.batch_labels import generate_code

NEAR_EXPIRY_DAYS = 7
LABEL_ATTEMPTS = 8


class InvalidBatchError(AppError):
    status_code = 400
    code = "invalid_batch"


class InsufficientStockError(ConflictError):
    code = "insufficient_stock"


class StockLimitError(ConflictError):
    code = "exceeds_received_quantity"


# --- status -----------------------------------------------------------------


def status_of(batch: Batch, today: date | None = None) -> BatchStatus:
    today = today or date.today()
    if batch.remaining_quantity <= 0:
        return "depleted"
    if batch.expiry_on < today:
        return "expired"
    if batch.expiry_on <= today + timedelta(days=NEAR_EXPIRY_DAYS):
        return "near_expiry"
    return "available"


def _status_clause(status: BatchStatus, today: date) -> ColumnElement[bool]:
    open_stock = Batch.remaining_quantity > 0
    soon = today + timedelta(days=NEAR_EXPIRY_DAYS)
    if status == "depleted":
        return Batch.remaining_quantity <= 0
    if status == "expired":
        return and_(open_stock, Batch.expiry_on < today)
    if status == "near_expiry":
        return and_(open_stock, Batch.expiry_on >= today, Batch.expiry_on <= soon)
    return and_(open_stock, Batch.expiry_on > soon)


# --- reading ----------------------------------------------------------------


def batches_query(
    *,
    ingredient_id: uuid.UUID | None,
    storage_area_id: uuid.UUID | None,
    status: BatchStatus | None,
    has_stock: bool | None,
    search: str | None,
) -> Select[tuple[Batch]]:
    statement = select(Batch).join(Ingredient, Ingredient.id == Batch.ingredient_id)
    if ingredient_id:
        statement = statement.where(Batch.ingredient_id == ingredient_id)
    if storage_area_id:
        statement = statement.where(Batch.storage_area_id == storage_area_id)
    if status:
        statement = statement.where(_status_clause(status, date.today()))
    if has_stock is not None:
        statement = statement.where(Batch.remaining_quantity > 0 if has_stock else Batch.remaining_quantity <= 0)
    if search:
        code = search.replace("-", "").replace(" ", "").upper()
        statement = statement.where(or_(contains(Ingredient.name, search), Batch.label_code == code))
    return statement


def get_batch(db: Session, batch_id: object) -> Batch:
    batch = db.get(Batch, batch_id)
    if batch is None:
        raise NotFoundError("That batch doesn't exist.")
    return batch


def lookup_by_label(db: Session, code: str) -> Batch:
    batch = db.scalars(select(Batch).where(Batch.label_code == code)).unique().one_or_none()
    if batch is None:
        raise NotFoundError("No batch has that label code.", code="batch_not_found")
    return batch


def movements_of(db: Session, batch: Batch) -> list[tuple[StockMovement, str]]:
    rows = db.execute(
        select(StockMovement, Employee.full_name)
        .join(Employee, Employee.id == StockMovement.employee_id)
        .where(StockMovement.batch_id == batch.id)
        .order_by(StockMovement.id.desc())
    ).all()
    return [(movement, name) for movement, name in rows]


def stock_totals(db: Session, ingredient_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    """Remaining quantity per ingredient across batches that haven't expired."""
    if not ingredient_ids:
        return {}
    rows = db.execute(
        select(Batch.ingredient_id, func.coalesce(func.sum(Batch.remaining_quantity), 0))
        .where(Batch.ingredient_id.in_(ingredient_ids), Batch.expiry_on >= date.today())
        .group_by(Batch.ingredient_id)
    ).all()
    return {ingredient_id: Decimal(total) for ingredient_id, total in rows}


# --- writing ----------------------------------------------------------------


def _clean_reason(reason: str | None, *, required: bool) -> str | None:
    cleaned = " ".join(reason.split()) if reason else ""
    if not cleaned:
        if required:
            raise InvalidBatchError("Say why the stock is being adjusted.", code="reason_required")
        return None
    if len(cleaned) > MOVEMENT_REASON_MAX_LENGTH:
        raise InvalidBatchError(f"Keep the reason to {MOVEMENT_REASON_MAX_LENGTH} characters or fewer.")
    return cleaned


def _new_label_code(db: Session) -> str:
    for _ in range(LABEL_ATTEMPTS):
        code = generate_code()
        if db.scalar(select(Batch.id).where(Batch.label_code == code)) is None:
            return code
    raise ConflictError("Couldn't make a unique label code. Try again.", code="label_code_unavailable")


def receive_batch(db: Session, fields: dict[str, Any], *, by: Employee, client: ClientInfo) -> Batch:
    """Create a batch and its single `in` movement. `fields` are validated (see `BatchReceive`)."""
    ingredient = reference.get_ingredient(db, fields["ingredient_id"])
    if not ingredient.is_active:
        raise InvalidBatchError(
            "That ingredient is deactivated. Reactivate it before receiving stock.", code="ingredient_inactive"
        )
    area_id = fields.get("storage_area_id")
    if area_id is not None and not reference.get_storage_area(db, area_id).is_active:
        raise InvalidBatchError("That storage area is deactivated.", code="storage_area_inactive")
    received_on = fields.get("received_on") or date.today()
    if fields["expiry_on"] < received_on:
        raise InvalidBatchError(
            "The use-by date can't be before the day the stock was received.", code="expiry_before_received"
        )
    notes = reference.clean_notes(fields.get("notes"))
    if notes and len(notes) > BATCH_NOTES_MAX_LENGTH:
        raise InvalidBatchError(f"Keep the notes to {BATCH_NOTES_MAX_LENGTH} characters or fewer.")
    quantity = Decimal(fields["quantity"])

    batch = Batch(
        ingredient_id=ingredient.id, storage_area_id=area_id, label_code=_new_label_code(db),
        received_on=received_on, expiry_on=fields["expiry_on"], quantity=quantity,
        remaining_quantity=quantity, notes=notes, created_by_id=by.id,
    )  # fmt: skip
    db.add(batch)
    try:
        db.flush()
    except IntegrityError as exc:  # a label-code race; the unique index caught it
        db.rollback()
        raise ConflictError("Couldn't save the batch. Try again.", code="label_code_unavailable") from exc
    db.add(
        StockMovement(batch_id=batch.id, kind="in", quantity_delta=quantity, remaining_after=quantity, employee_id=by.id)
    )
    db.flush()
    db.refresh(batch)
    record_event(
        db, "inventory.batch_received", actor=by, target=batch, client=client,
        details={
            "ingredient": ingredient.name, "quantity": f"{quantity:.3f}", "unit": ingredient.unit.code,
            "expiry_on": batch.expiry_on.isoformat(),
        },
    )  # fmt: skip
    return batch


def _lock(db: Session, batch_id: object) -> Batch:
    batch = (
        db.scalars(
            select(Batch).where(Batch.id == batch_id).with_for_update(of=Batch).execution_options(populate_existing=True)
        )
        .unique()
        .one_or_none()
    )
    if batch is None:
        raise NotFoundError("That batch doesn't exist.")
    return batch


def _move(
    db: Session, batch_id: object, *, kind: str, delta: Decimal, reason: str | None, by: Employee, client: ClientInfo
) -> Batch:
    batch = _lock(db, batch_id)
    after = batch.remaining_quantity + delta
    if after < 0:
        raise InsufficientStockError(
            f"Only {batch.remaining_quantity.normalize():f} {batch.ingredient.unit.code} left in this batch."
        )
    if after > batch.quantity:
        raise StockLimitError("A batch can't hold more than the quantity received. Receive a new batch instead.")
    batch.remaining_quantity = after
    db.add(
        StockMovement(
            batch_id=batch.id, kind=kind, quantity_delta=delta, remaining_after=after, reason=reason, employee_id=by.id
        )
    )
    db.flush()
    db.refresh(batch)
    action = "inventory.stock_consumed" if kind == "out" else "inventory.stock_adjusted"
    details: dict[str, Any] = {"delta": f"{delta:.3f}", "remaining_after": f"{after:.3f}", "unit": batch.ingredient.unit.code}
    if reason:
        details["reason"] = reason
    record_event(db, action, actor=by, target=batch, client=client, details=details)
    return batch


def consume(
    db: Session, batch_id: object, quantity: Decimal, *, reason: str | None, by: Employee, client: ClientInfo
) -> Batch:
    """Take `quantity` out of a batch (a positive number). Refused if less than that remains."""
    if quantity <= 0:
        raise InvalidBatchError("Enter a quantity above zero.")
    return _move(
        db, batch_id, kind="out", delta=-quantity, reason=_clean_reason(reason, required=False), by=by, client=client
    )


def adjust(db: Session, batch_id: object, delta: Decimal, *, reason: str, by: Employee, client: ClientInfo) -> Batch:
    """Correct the remaining quantity by a signed `delta` (not zero), with a reason."""
    if delta == 0:
        raise InvalidBatchError("An adjustment can't be zero.", code="zero_adjustment")
    return _move(
        db, batch_id, kind="adjust", delta=delta, reason=_clean_reason(reason, required=True), by=by, client=client
    )
