"""Camera relay. The ESP32-CAM pushes JPEG frames; signed-in staff fetch the latest one.

Frames live in memory only (nothing is stored or recorded) and no database is
touched, so an idle camera never wakes Neon. The camera sends frames only while a
staff member is watching (they fetched a frame in the last WATCH_SECONDS).
The camera authenticates with one shared secret (CAMERA_DEVICE_SECRET), separate
from staff sessions and from sensor-station tokens.
"""

import hmac
import time
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.auth.dependencies import CurrentPrincipal, SettingsDep
from app.auth.device import DeviceNotAuthenticatedError
from app.core.errors import AppError

WATCH_SECONDS = 30
FRESH_SECONDS = 10
MAX_FRAME_BYTES = 256 * 1024


@dataclass
class _Relay:
    frame: bytes = b""
    frame_at: float = 0.0
    watch_until: float = 0.0


_relay = _Relay()


class FrameTooLargeError(AppError):
    status_code = 413
    code = "frame_too_large"
    detail = "The frame is too large."


def _camera_auth(request: Request, settings: SettingsDep) -> None:
    secret = settings.camera_device_secret
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if secret is None or scheme.lower() != "bearer" or not token:
        raise DeviceNotAuthenticatedError()
    if not hmac.compare_digest(token.strip().encode(), secret.get_secret_value().encode()):
        raise DeviceNotAuthenticatedError()


CameraAuth = Annotated[None, Depends(_camera_auth)]

# Staff side: any signed-in employee, like the other monitoring pages.
router = APIRouter(prefix="/camera", tags=["camera"])
# Camera side: shared-secret bearer only.
device_router = APIRouter(prefix="/device/camera", tags=["device"])


@router.get("/frame", summary="Latest camera frame (JPEG); 204 when the camera isn't sending")
def latest_frame(_: CurrentPrincipal) -> Response:
    now = time.monotonic()
    _relay.watch_until = now + WATCH_SECONDS
    if not _relay.frame or now - _relay.frame_at > FRESH_SECONDS:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    return Response(_relay.frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@device_router.get("/want", summary="Should the camera be sending frames?")
def want(_: CameraAuth) -> dict[str, bool]:
    return {"watch": time.monotonic() < _relay.watch_until}


@device_router.post("/frame", summary="Push one JPEG frame")
async def push_frame(request: Request, _: CameraAuth) -> dict[str, bool]:
    body = await request.body()
    if len(body) > MAX_FRAME_BYTES:
        raise FrameTooLargeError()
    if body[:2] == b"\xff\xd8":  # JPEG start marker; ignore anything else
        _relay.frame = body
        _relay.frame_at = time.monotonic()
    return {"watch": time.monotonic() < _relay.watch_until}
