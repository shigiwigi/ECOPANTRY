"""Sensor-station management for administrators: register, rotate tokens, disable, stop a live session."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal, utcnow
from app.db.session import SessionDep
from app.schemas.devices import DeviceCreate, DeviceOut, DeviceWithToken
from app.schemas.errors import ErrorResponse
from app.services import devices as service
from app.services.audit import ClientInfo

router = APIRouter(
    prefix="/devices",
    tags=["devices"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.DEVICES_VIEW))]
Manager = Annotated[Principal, Depends(require_permission(Permission.DEVICES_MANAGE))]


@router.get("", response_model=list[DeviceOut], summary="List sensor stations")
def list_devices(_: Viewer, db: SessionDep) -> list[DeviceOut]:
    now = utcnow()
    return [DeviceOut.from_device(device, now) for device in service.list_devices(db)]


@router.post(
    "",
    response_model=DeviceWithToken,
    status_code=status.HTTP_201_CREATED,
    summary="Register a station. The token is shown once.",
    responses={409: {"model": ErrorResponse, "description": "A device with that name exists"}},
)
def create_device(body: DeviceCreate, request: Request, principal: Manager, db: SessionDep) -> DeviceWithToken:
    device, token = service.create_device(db, body.name, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return DeviceWithToken(device=DeviceOut.from_device(device, utcnow()), token=token)


@router.post(
    "/{device_id}/rotate-token",
    response_model=DeviceWithToken,
    summary="Issue a new token. The old one stops working at once.",
)
def rotate_token(device_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> DeviceWithToken:
    device = service.get_device(db, device_id)
    token = service.rotate_token(db, device, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return DeviceWithToken(device=DeviceOut.from_device(device, utcnow()), token=token)


@router.post("/{device_id}/disable", response_model=DeviceOut, summary="Refuse everything from this station")
def disable_device(device_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> DeviceOut:
    device = service.get_device(db, device_id)
    service.disable_device(db, device, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return DeviceOut.from_device(device, utcnow())


@router.post("/{device_id}/enable", response_model=DeviceOut, summary="Accept a disabled station again")
def enable_device(device_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> DeviceOut:
    device = service.get_device(db, device_id)
    service.enable_device(db, device, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return DeviceOut.from_device(device, utcnow())


@router.post(
    "/{device_id}/stop-live",
    response_model=DeviceOut,
    summary="End the live session now; the station pauses on its next upload",
)
def stop_live(device_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> DeviceOut:
    device = service.get_device(db, device_id)
    service.stop_live_session(db, device, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return DeviceOut.from_device(device, utcnow())
