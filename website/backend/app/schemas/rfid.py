"""RFID card schemas for the portal."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.rfid import RfidCard, RfidScan


class CardAssign(BaseModel):
    uid: str = Field(min_length=8, max_length=40, description="Card UID, for example D5:61:E9:E7.")
    employee_id: uuid.UUID


class CardEmployee(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    status: str


class CardOut(BaseModel):
    id: uuid.UUID
    uid: str
    active: bool
    employee: CardEmployee
    assigned_at: datetime
    revoked_at: datetime | None

    @classmethod
    def from_card(cls, card: RfidCard) -> "CardOut":
        employee = card.employee
        return cls(
            id=card.id,
            uid=card.uid,
            active=card.is_active,
            employee=CardEmployee(
                id=employee.id, full_name=employee.full_name, email=employee.email, status=employee.status
            ),
            assigned_at=card.assigned_at,
            revoked_at=card.revoked_at,
        )


class ScanOut(BaseModel):
    id: int
    uid: str
    device_id: uuid.UUID
    result: str
    granted: bool
    employee_name: str | None
    scanned_at: datetime

    @classmethod
    def from_scan(cls, scan: RfidScan) -> "ScanOut":
        return cls(
            id=scan.id,
            uid=scan.uid,
            device_id=scan.device_id,
            result=scan.result,
            granted=scan.granted,
            employee_name=scan.employee.full_name if scan.employee else None,
            scanned_at=scan.scanned_at,
        )
