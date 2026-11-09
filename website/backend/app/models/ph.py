"""pH records (migration 0008). EXPERIMENTAL.

pH is measured with a hobby-grade probe. A record says what was measured,
against which reference range, by whom and how the probe was calibrated. It is
never a food-safety verdict: there is deliberately no "safe"/"spoiled" column,
and nothing may use pH alone to declare food safe or spoiled. EcoPantry is not
a certified food-safety system. See docs/DATA_MODEL.md.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import ClassVar

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

SAMPLE_DESCRIPTION_MAX_LENGTH = 200
CALIBRATION_NOTE_MAX_LENGTH = 500

PH_VALUE = Numeric(4, 2)


class PhRecord(Base):
    __tablename__ = "ph_records"
    __table_args__ = (
        CheckConstraint("length(btrim(sample_description)) > 0", name="sample_description_not_blank"),
        CheckConstraint("ph_value >= 0 AND ph_value <= 14", name="ph_value_range"),
        CheckConstraint("(reference_min IS NULL) = (reference_max IS NULL)", name="reference_range_complete"),
        CheckConstraint(
            "reference_min IS NULL OR (reference_min >= 0 AND reference_min <= reference_max AND reference_max <= 14)",
            name="reference_range_valid",
        ),
    )
    audit_target_type: ClassVar[str] = "ph_record"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sample_description: Mapped[str] = mapped_column(String(SAMPLE_DESCRIPTION_MAX_LENGTH))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("batches.id", ondelete="RESTRICT"), index=True)
    ph_value: Mapped[Decimal] = mapped_column(PH_VALUE)
    # The range the operator compared against (e.g. from a recipe). Informational only.
    reference_min: Mapped[Decimal | None] = mapped_column(PH_VALUE)
    reference_max: Mapped[Decimal | None] = mapped_column(PH_VALUE)
    operator_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    calibration_note: Mapped[str | None] = mapped_column(String(CALIBRATION_NOTE_MAX_LENGTH))
    # Set when the value was taken from a station reading rather than typed in.
    sensor_reading_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("sensor_readings.id", ondelete="RESTRICT")
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<PhRecord {self.id}>"
