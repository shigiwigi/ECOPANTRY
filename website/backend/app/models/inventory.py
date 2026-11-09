"""In-shop ingredient inventory: units, ingredients and storage areas (migration 0005),
batches and stock movements (migration 0006).

Inventory is for what is inside the shop only; there are no suppliers. The
public catalogue (`catalogue.py`) is separate and never links to these tables.
Ingredients and storage areas are never deleted (batches and records point at
them); deactivate them instead. See docs/DATA_MODEL.md.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import ClassVar

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Numeric,
    SmallInteger,
    String,
    func,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.services.batch_labels import CODE_PATTERN

UNIT_KINDS = ("mass", "volume", "count")
STORAGE_AREA_KINDS = ("fridge", "freezer", "shelf", "other")
MOVEMENT_KINDS = ("in", "out", "adjust")

INGREDIENT_NAME_MAX_LENGTH = 120
STORAGE_AREA_NAME_MAX_LENGTH = 80
NOTES_MAX_LENGTH = 1000
BATCH_NOTES_MAX_LENGTH = 500
MOVEMENT_REASON_MAX_LENGTH = 200

# Quantities are exact decimals in the ingredient's unit: up to 999 999 999.999.
QUANTITY = Numeric(12, 3)


class Unit(Base):
    """A unit of measure (kg, g, l, ml, pcs). Reference data seeded by migration 0005; read-only in the API."""

    __tablename__ = "units"
    __table_args__ = (
        CheckConstraint("code ~ '^[a-z]{1,8}$'", name="code_format"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"kind IN {UNIT_KINDS!r}", name="kind_valid"),
    )

    id: Mapped[int] = mapped_column(SmallInteger, Identity(), primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(16))

    def __repr__(self) -> str:
        return f"<Unit {self.code}>"


class Ingredient(Base):
    """A raw ingredient the shop keeps in stock, counted in one unit."""

    __tablename__ = "ingredients"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("reorder_level IS NULL OR reorder_level >= 0", name="reorder_level_not_negative"),
        CheckConstraint("is_active = (deactivated_at IS NULL)", name="deactivated_at_matches"),
        # Names are unique ignoring case, so "Flour" and "flour" can't both exist.
        Index("uq_ingredients_lower_name", text("lower(name)"), unique=True),
    )
    audit_target_type: ClassVar[str] = "ingredient"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(INGREDIENT_NAME_MAX_LENGTH))
    unit_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("units.id", ondelete="RESTRICT"), index=True)
    # Low stock when the remaining quantity of usable batches is at or below this. NULL: no low-stock warning.
    reorder_level: Mapped[Decimal | None] = mapped_column(QUANTITY)
    notes: Mapped[str | None] = mapped_column(String(NOTES_MAX_LENGTH))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    unit: Mapped[Unit] = relationship(lazy="joined", innerjoin=True)

    def __repr__(self) -> str:
        return f"<Ingredient {self.id}>"


class StorageArea(Base):
    """Where batches are kept inside the shop: a fridge, a freezer, a shelf."""

    __tablename__ = "storage_areas"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"kind IN {STORAGE_AREA_KINDS!r}", name="kind_valid"),
        CheckConstraint("is_active = (deactivated_at IS NULL)", name="deactivated_at_matches"),
        Index("uq_storage_areas_lower_name", text("lower(name)"), unique=True),
    )
    audit_target_type: ClassVar[str] = "storage_area"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(STORAGE_AREA_NAME_MAX_LENGTH))
    kind: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str | None] = mapped_column(String(NOTES_MAX_LENGTH))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<StorageArea {self.id}>"


class Batch(Base):
    """One delivery or lot of an ingredient, with its own expiry date and QR label.

    `remaining_quantity` is kept equal to the sum of the batch's stock movements
    by the service that writes them, in the same transaction, with the batch row
    locked (`SELECT ... FOR UPDATE`). Status (available, near expiry, expired,
    depleted) is derived from the dates and quantities, never stored.
    """

    __tablename__ = "batches"
    __table_args__ = (
        CheckConstraint(f"label_code ~ '{CODE_PATTERN}'", name="label_code_format"),
        CheckConstraint("expiry_on >= received_on", name="expiry_not_before_received"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint(
            "remaining_quantity >= 0 AND remaining_quantity <= quantity", name="remaining_within_quantity"
        ),
        # FEFO: usable batches of one ingredient, earliest expiry first.
        Index(
            "ix_batches_fefo",
            "ingredient_id",
            "expiry_on",
            "received_on",
            postgresql_where=text("remaining_quantity > 0"),
        ),
        # Near-expiry and expired lists across all ingredients.
        Index("ix_batches_open_expiry_on", "expiry_on", postgresql_where=text("remaining_quantity > 0")),
    )
    audit_target_type: ClassVar[str] = "batch"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ingredient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ingredients.id", ondelete="RESTRICT"), index=True)
    storage_area_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("storage_areas.id", ondelete="RESTRICT"), index=True
    )
    # What the printed QR label carries (app/services/batch_labels.py). Random, never reused.
    label_code: Mapped[str] = mapped_column(String(10), unique=True)
    received_on: Mapped[date] = mapped_column(Date)
    expiry_on: Mapped[date] = mapped_column(Date)
    quantity: Mapped[Decimal] = mapped_column(QUANTITY)
    remaining_quantity: Mapped[Decimal] = mapped_column(QUANTITY)
    notes: Mapped[str | None] = mapped_column(String(BATCH_NOTES_MAX_LENGTH))
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    ingredient: Mapped[Ingredient] = relationship(lazy="joined", innerjoin=True)
    storage_area: Mapped[StorageArea | None] = relationship(lazy="joined")

    def __repr__(self) -> str:
        return f"<Batch {self.id}>"


class StockMovement(Base):
    """An append-only ledger line: stock received into, taken out of, or corrected on a batch.

    `quantity_delta` is signed, in the ingredient's unit: positive for `in`,
    negative for `out`, either sign (never zero) for `adjust`. The sum of a
    batch's deltas equals its `remaining_quantity`; `remaining_after` is the
    batch's remaining quantity just after this line. Each batch has exactly one
    `in` line, its receipt, written with the batch. A trigger (migration 0006)
    rejects UPDATE and DELETE: mistakes are corrected with a new `adjust` line.
    """

    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint(f"kind IN {MOVEMENT_KINDS!r}", name="kind_valid"),
        CheckConstraint(
            "(kind = 'in' AND quantity_delta > 0) OR (kind = 'out' AND quantity_delta < 0) "
            "OR (kind = 'adjust' AND quantity_delta <> 0)",
            name="delta_sign_matches_kind",
        ),
        CheckConstraint("remaining_after >= 0", name="remaining_after_not_negative"),
        CheckConstraint(
            "kind <> 'adjust' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)", name="adjust_has_reason"
        ),
        Index("uq_stock_movements_one_receipt_per_batch", "batch_id", unique=True, postgresql_where=text("kind = 'in'")),
        Index("ix_stock_movements_batch_id_created_at", "batch_id", "created_at"),
    )
    audit_target_type: ClassVar[str] = "stock_movement"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("batches.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(8))
    quantity_delta: Mapped[Decimal] = mapped_column(QUANTITY)
    remaining_after: Mapped[Decimal] = mapped_column(QUANTITY)
    reason: Mapped[str | None] = mapped_column(String(MOVEMENT_REASON_MAX_LENGTH))
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    # The card tap that identified the employee at a station, when the movement was made there.
    rfid_scan_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("rfid_scans.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    batch: Mapped[Batch] = relationship(lazy="raise")
