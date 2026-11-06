"""Authentication for sensor stations.

A station sends `Authorization: Bearer epd_...` on every request. Staff
session cookies are ignored here, and device tokens are never accepted by
staff routes, so neither credential can stand in for the other.
`tests/test_route_protection.py` checks every `/device/*` route refuses
requests without a valid token.

    @router.post("/device/readings")
    def upload(device: CurrentDevice, ...): ...
"""

import re
from typing import Annotated

from fastapi import Depends, Request

from app.auth.service import utcnow
from app.core.errors import NotAuthenticatedError
from app.db.session import SessionDep
from app.models.devices import Device
from app.services.devices import find_by_token

FIRMWARE_HEADER = "X-Device-Firmware"
_FIRMWARE = re.compile(r"^[0-9A-Za-z.+_-]{1,32}$")


class DeviceNotAuthenticatedError(NotAuthenticatedError):
    detail = "The device token is missing, wrong or revoked."


def get_device(request: Request, db: SessionDep) -> Device:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise DeviceNotAuthenticatedError()
    device = find_by_token(db, token.strip())
    if device is None or not device.is_active:
        raise DeviceNotAuthenticatedError()

    device.last_seen_at = utcnow()
    firmware = request.headers.get(FIRMWARE_HEADER, "")
    if _FIRMWARE.match(firmware) and firmware != device.firmware_version:
        device.firmware_version = firmware
    return device


CurrentDevice = Annotated[Device, Depends(get_device)]
