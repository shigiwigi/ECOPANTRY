"""Waste records: what was thrown away, why, by whom (migration 0008).

The bin's fill level is not stored here: it is the load-cell weight in
`sensor_readings.weight_g`, watched by the "Waste bin nearly full" threshold.
A waste record is what a person logs. When the waste came out of a batch, the
service also writes the matching `out` stock movement and links it here.
See docs/DATA_MODEL.md.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import ClassVar

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

WASTE_CATEGORIES = ("expired", "spoiled", "damaged", "production_offcut", "other")
WASTE_REASON_MAX_LENGTH = 500


class WasteRecord(Base):
    __tablename__ = "waste_records"
    __table_args__ = (
        CheckConstraint(f"category IN {WASTE_CATEGORIES!r}", name="category_valid"),
        CheckConstraint("weight_kg IS NULL OR weight_kg >= 0", name="weight_not_negative"),
        CheckConstraint(
            "category <> 'other' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)", name="other_has_reason"
        ),
        CheckConstraint("stock_movement_id IS NULL OR batch_id IS NOT NULL", name="movement_needs_batch"),
    )
    audit_target_type: ClassVar[str] = "waste_record"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    category: Mapped[str] = mapped_column(String(24))
    reason: Mapped[str | None] = mapped_column(String(WASTE_REASON_MAX_LENGTH))
    # Weighed on a scale or read from the bin; optional because not every item is weighed.
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("batches.id", ondelete="RESTRICT"), index=True)
    # The `out` movement that took this waste off the batch's remaining quantity, if any.
    stock_movement_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("stock_movements.id", ondelete="RESTRICT"), unique=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    rfid_scan_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("rfid_scans.id", ondelete="RESTRICT"))
    # When the waste happened (may be earlier than when it was logged).
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<WasteRecord {self.id} {self.category}>"
