"""Expiry lists and FEFO (first expired, first out) recommendations.

Rules, all decided here and nowhere else:

- A batch is **usable until the end of its expiry date**. On `expiry_on == today`
  it is still usable (and counts as "near expiry", 0 days left); from the next
  day it is expired.
- Only batches with remaining stock count. Depleted batches (0 remaining) never
  appear in any expiry list or FEFO order.
- "Near expiry" means `today <= expiry_on <= today + days`. "Expired" means
  `expiry_on < today`.
- FEFO order: earliest `expiry_on` first; equal expiry dates are ordered by the
  older `received_on`, then by `id`, so the order is the same on every call.
  Partially used batches are included with their remaining quantity.
- Expired batches are never recommended: they are reported separately.

"Today" is always passed in (`today=`); nothing in this module reads the clock,
so tests can fix it. The routes pass the shop's current date.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.api.v1.pagination import contains
from app.models.inventory import Batch, Ingredient

DEFAULT_WINDOW_DAYS = 7
MAX_WINDOW_DAYS = 90


@dataclass(frozen=True)
class FefoBatch:
    """The few batch fields FEFO needs, so the algorithm stays independent of the ORM."""

    id: uuid.UUID
    label_code: str
    received_on: date
    expiry_on: date
    remaining_quantity: Decimal


@dataclass(frozen=True)
class PickLine:
    batch: FefoBatch
    take: Decimal


@dataclass(frozen=True)
class FefoPlan:
    usable: list[FefoBatch]  # in the order they should be used
    expired: list[FefoBatch]  # remaining stock that must not be used, oldest expiry first
    pick: list[PickLine] = field(default_factory=list)  # only when a quantity was requested
    requested: Decimal | None = None
    allocated: Decimal | None = None
    shortfall: Decimal | None = None  # requested - allocated, 0 when stock is enough

    @property
    def sufficient(self) -> bool | None:
        return None if self.shortfall is None else self.shortfall == 0


def _fefo_key(batch: FefoBatch) -> tuple[date, date, str]:
    return (batch.expiry_on, batch.received_on, str(batch.id))


def fefo_plan(batches: list[FefoBatch], *, today: date, quantity: Decimal | None = None) -> FefoPlan:
    """Order `batches` (all of one ingredient) by FEFO and optionally allocate `quantity` across them."""
    stocked = [b for b in batches if b.remaining_quantity > 0]
    usable = sorted((b for b in stocked if b.expiry_on >= today), key=_fefo_key)
    expired = sorted((b for b in stocked if b.expiry_on < today), key=_fefo_key)
    if quantity is None:
        return FefoPlan(usable=usable, expired=expired)

    pick: list[PickLine] = []
    needed = quantity
    for batch in usable:
        if needed <= 0:
            break
        take = min(batch.remaining_quantity, needed)
        pick.append(PickLine(batch=batch, take=take))
        needed -= take
    return FefoPlan(
        usable=usable, expired=expired, pick=pick, requested=quantity, allocated=quantity - needed, shortfall=needed
    )


def days_left(batch_expiry: date, today: date) -> int:
    """Whole days until expiry; 0 on the expiry date itself, negative once expired."""
    return (batch_expiry - today).days


def _stocked_batches(
    *, ingredient_id: uuid.UUID | None, storage_area_id: uuid.UUID | None, search: str | None
) -> Select[tuple[Batch]]:
    statement = (
        select(Batch).join(Ingredient, Batch.ingredient_id == Ingredient.id).where(Batch.remaining_quantity > 0)
    )
    if ingredient_id is not None:
        statement = statement.where(Batch.ingredient_id == ingredient_id)
    if storage_area_id is not None:
        statement = statement.where(Batch.storage_area_id == storage_area_id)
    if search:
        statement = statement.where(contains(Ingredient.name, search) | contains(Batch.label_code, search.upper()))
    return statement


def near_expiry_query(
    *,
    today: date,
    days: int,
    ingredient_id: uuid.UUID | None = None,
    storage_area_id: uuid.UUID | None = None,
    search: str | None = None,
) -> Select[tuple[Batch]]:
    statement = _stocked_batches(ingredient_id=ingredient_id, storage_area_id=storage_area_id, search=search)
    return statement.where(Batch.expiry_on >= today, Batch.expiry_on <= today + timedelta(days=days))


def expired_query(
    *,
    today: date,
    ingredient_id: uuid.UUID | None = None,
    storage_area_id: uuid.UUID | None = None,
    search: str | None = None,
) -> Select[tuple[Batch]]:
    statement = _stocked_batches(ingredient_id=ingredient_id, storage_area_id=storage_area_id, search=search)
    return statement.where(Batch.expiry_on < today)


def count_rows(db: Session, statement: Select[tuple[Batch]]) -> int:
    return int(db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)


def fefo_batches(db: Session, ingredient_id: uuid.UUID) -> list[Batch]:
    statement = select(Batch).where(Batch.ingredient_id == ingredient_id, Batch.remaining_quantity > 0)
    return list(db.scalars(statement).unique())
