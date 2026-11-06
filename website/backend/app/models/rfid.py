"""RFID cards linked to employees, and every card tap on a station.

A card identifies a person at a station; it does not authenticate them to the
portal. A card can belong to one employee at a time. Revoked cards keep their
row (and their scans) so history stays readable; assigning a revoked UID again
reuses the row. The audit log keeps who held it before.
"""

import uuid
from datetime import datetime
from typing import ClassVar

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.auth import Employee

# Upper-case hex bytes separated by colons: 4, 7 or 10 bytes for MIFARE cards.
UID_PATTERN = r"^[0-9A-F]{2}(:[0-9A-F]{2}){3,9}$"
SCAN_RESULTS = ("granted", "unknown_card", "card_revoked", "employee_inactive")


class RfidCard(Base):
    __tablename__ = "rfid_cards"
    __table_args__ = (
        CheckConstraint(f"uid ~ '{UID_PATTERN}'", name="uid_format"),
        CheckConstraint("(revoked_at IS NULL) = (revoked_by_id IS NULL)", name="revoked_by_matches"),
    )
    audit_target_type: ClassVar[str] = "rfid_card"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    uid: Mapped[str] = mapped_column(String(32), unique=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    assigned_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    employee: Mapped[Employee] = relationship(foreign_keys=[employee_id], lazy="joined", innerjoin=True)

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None

    def __repr__(self) -> str:
        return f"<RfidCard {self.id}>"


class RfidScan(Base):
    """A card tapped on a station, whether or not it was recognised."""

    __tablename__ = "rfid_scans"
    __table_args__ = (
        CheckConstraint(f"uid ~ '{UID_PATTERN}'", name="uid_format"),
        CheckConstraint(f"result IN {SCAN_RESULTS!r}", name="result_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="RESTRICT"), index=True)
    uid: Mapped[str] = mapped_column(String(32))
    card_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rfid_cards.id", ondelete="RESTRICT"))
    employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    result: Mapped[str] = mapped_column(String(24))
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    employee: Mapped[Employee | None] = relationship(foreign_keys=[employee_id], lazy="joined")

    @property
    def granted(self) -> bool:
        return self.result == "granted"
