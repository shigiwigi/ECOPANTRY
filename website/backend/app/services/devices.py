"""Sensor-station lifecycle: register, rotate the token, disable, enable, stop a live session.

Used by the admin API and by `python -m app.cli`. Callers commit. A device's
token is returned once, when it is created or rotated; only its SHA-256 is
stored, so a copy of the database can't be used to post readings.
"""

import hashlib
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import utcnow
from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.auth import Employee
from app.models.devices import Device
from app.services.audit import CLI, ActorType, ClientInfo, record_event

TOKEN_PREFIX = "epd_"
NAME_MAX_LENGTH = 80


class InvalidDeviceError(AppError):
    status_code = 400
    code = "invalid_device"


def new_device_token() -> str:
    """256 bits of randomness with a recognisable prefix (so a leaked token is easy to spot)."""
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_device_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def _display_prefix(token: str) -> str:
    return token[: len(TOKEN_PREFIX) + 6]


def find_by_token(db: Session, token: str) -> Device | None:
    if not token.startswith(TOKEN_PREFIX) or len(token) > 128:
        return None
    return db.scalar(select(Device).where(Device.token_hash == hash_device_token(token)))


def get_device(db: Session, device_id: uuid.UUID) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise NotFoundError("No device has that id.")
    return device


def find_by_name(db: Session, name: str) -> Device | None:
    return db.scalar(select(Device).where(Device.name == " ".join(name.split())))


def list_devices(db: Session) -> list[Device]:
    return list(db.scalars(select(Device).order_by(Device.created_at)))


def _validated_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned or len(cleaned) > NAME_MAX_LENGTH:
        raise InvalidDeviceError(f"Enter a name of 1 to {NAME_MAX_LENGTH} characters.")
    return cleaned


def _actor(by: Employee | None, actor_type: ActorType | None) -> ActorType:
    return actor_type or ("employee" if by else "anonymous")


def create_device(
    db: Session,
    name: str,
    *,
    by: Employee | None,
    actor_type: ActorType | None = None,
    client: ClientInfo = CLI,
) -> tuple[Device, str]:
    cleaned = _validated_name(name)
    if find_by_name(db, cleaned) is not None:
        raise ConflictError("A device with that name already exists.")
    token = new_device_token()
    device = Device(
        id=uuid.uuid4(),
        name=cleaned,
        token_hash=hash_device_token(token),
        token_prefix=_display_prefix(token),
        created_by_id=by.id if by else None,
    )
    db.add(device)
    db.flush()
    record_event(db, "device.registered", actor=by, actor_type=_actor(by, actor_type), target=device, client=client,
                 details={"name": cleaned})  # fmt: skip
    return device, token


def rotate_token(
    db: Session, device: Device, *, by: Employee | None, actor_type: ActorType | None = None, client: ClientInfo = CLI
) -> str:
    """Issue a new token. The old one stops working immediately and any live session ends."""
    token = new_device_token()
    device.token_hash = hash_device_token(token)
    device.token_prefix = _display_prefix(token)
    device.live_until = None
    record_event(db, "device.token_rotated", actor=by, actor_type=_actor(by, actor_type), target=device, client=client)
    return token


def disable_device(
    db: Session, device: Device, *, by: Employee | None, actor_type: ActorType | None = None, client: ClientInfo = CLI
) -> None:
    if not device.is_active:
        raise ConflictError("The device is already disabled.")
    device.status = "disabled"
    device.disabled_at = utcnow()
    device.live_until = None
    record_event(db, "device.disabled", actor=by, actor_type=_actor(by, actor_type), target=device, client=client)


def enable_device(
    db: Session, device: Device, *, by: Employee | None, actor_type: ActorType | None = None, client: ClientInfo = CLI
) -> None:
    if device.is_active:
        raise ConflictError("The device is already enabled.")
    device.status = "active"
    device.disabled_at = None
    record_event(db, "device.enabled", actor=by, actor_type=_actor(by, actor_type), target=device, client=client)


def stop_live_session(db: Session, device: Device, *, by: Employee, client: ClientInfo) -> None:
    """End the live session now. The station pauses when its next upload is refused."""
    now = utcnow()
    if not device.is_live(now):
        raise ConflictError("The device isn't live.")
    device.live_until = now
    record_event(db, "device.live_session_stopped", actor=by, target=device, client=client)
