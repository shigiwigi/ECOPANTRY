"""RFID cards: assign, revoke, and check a tap at a station. Callers commit.

A tap identifies an employee at a station; it never signs anyone in to the
portal. A granted tap is what opens (or extends) the station's live session.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import utcnow
from app.core.config import Settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.auth import Employee
from app.models.devices import Device
from app.models.rfid import RfidCard, RfidScan
from app.services import live_sessions
from app.services.audit import ClientInfo, record_event

_SEPARATORS = re.compile(r"[\s:\-]")
_HEX = re.compile(r"^[0-9A-F]+$")
_UID_BYTES = (4, 7, 10)
LCD_WIDTH = 16


class InvalidUidError(AppError):
    status_code = 400
    code = "invalid_card_uid"
    detail = "Card UIDs are 4, 7 or 10 bytes of hex, for example D5:61:E9:E7."


def normalize_uid(raw: str) -> str:
    """`d5 61 e9 e7`, `D561E9E7` and `D5:61:E9:E7` all become `D5:61:E9:E7`."""
    compact = _SEPARATORS.sub("", raw.strip()).upper()
    if not _HEX.match(compact) or len(compact) % 2 or len(compact) // 2 not in _UID_BYTES:
        raise InvalidUidError()
    return ":".join(compact[i : i + 2] for i in range(0, len(compact), 2))


def list_cards(db: Session) -> list[RfidCard]:
    return list(db.scalars(select(RfidCard).order_by(RfidCard.revoked_at.is_not(None), RfidCard.assigned_at.desc())))


def get_card(db: Session, card_id: uuid.UUID) -> RfidCard:
    card = db.get(RfidCard, card_id)
    if card is None:
        raise NotFoundError("No card has that id.")
    return card


def list_scans(db: Session, limit: int) -> list[RfidScan]:
    return list(db.scalars(select(RfidScan).order_by(RfidScan.scanned_at.desc(), RfidScan.id.desc()).limit(limit)))


def assign_card(db: Session, uid: str, employee: Employee, *, by: Employee, client: ClientInfo) -> RfidCard:
    normalized = normalize_uid(uid)
    if not employee.is_active:
        raise ConflictError("Reactivate the account before giving it a card.")
    now = utcnow()
    card = db.scalar(select(RfidCard).where(RfidCard.uid == normalized).with_for_update())
    if card is not None and card.is_active:
        if card.employee_id == employee.id:
            raise ConflictError("That card is already assigned to this person.")
        raise ConflictError("That card belongs to someone else. Revoke it first.")
    if card is None:
        card = RfidCard(id=uuid.uuid4(), uid=normalized, employee_id=employee.id, assigned_at=now, assigned_by_id=by.id)
        db.add(card)
    else:
        card.employee_id = employee.id
        card.assigned_at = now
        card.assigned_by_id = by.id
        card.revoked_at = None
        card.revoked_by_id = None
    db.flush()
    db.refresh(card)
    record_event(db, "rfid_card.assigned", actor=by, target=card, client=client, details={"employee_id": str(employee.id)})
    return card


def revoke_card(db: Session, card: RfidCard, *, by: Employee, client: ClientInfo) -> None:
    if not card.is_active:
        raise ConflictError("The card is already revoked.")
    card.revoked_at = utcnow()
    card.revoked_by_id = by.id
    record_event(db, "rfid_card.revoked", actor=by, target=card, client=client,
                 details={"employee_id": str(card.employee_id)})  # fmt: skip


@dataclass(frozen=True)
class ScanOutcome:
    scan: RfidScan
    display_name: str | None
    grant: live_sessions.LiveGrant | None


def _lcd_name(employee: Employee) -> str:
    return employee.full_name[:LCD_WIDTH]


def record_scan(db: Session, settings: Settings, device: Device, uid: str, now: datetime) -> ScanOutcome:
    """Check a tap, store it, and open or extend the live session when the card is granted."""
    normalized = normalize_uid(uid)
    card = db.scalar(select(RfidCard).where(RfidCard.uid == normalized))
    if card is None:
        result = "unknown_card"
    elif not card.is_active:
        result = "card_revoked"
    elif not card.employee.is_active:
        result = "employee_inactive"
    else:
        result = "granted"

    scan = RfidScan(
        device_id=device.id,
        uid=normalized,
        card_id=card.id if card else None,
        employee_id=card.employee_id if card else None,
        result=result,
        scanned_at=now,
    )
    db.add(scan)
    if result != "granted" or card is None:
        return ScanOutcome(scan=scan, display_name=None, grant=None)

    grant = live_sessions.grant(db, settings, device, minutes=settings.live_session_minutes, now=now)
    if grant.started:
        device.live_started_by_id = card.employee_id
        record_event(
            db,
            "device.live_session_started",
            actor_type="device",
            target=device,
            details={"trigger": "rfid", "employee_id": str(card.employee_id), "card_id": str(card.id)},
        )
    return ScanOutcome(scan=scan, display_name=_lcd_name(card.employee), grant=grant)
