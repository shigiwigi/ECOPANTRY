"""Endpoints for sensor stations (ESP32). Bearer device token only; no staff session, no CSRF.

A station only uploads during a live session. It asks for a short one when it
powers on (`POST /device/session`), and an authorised card tap opens or
extends one (`POST /device/rfid-scans`). Outside a session, `POST
/device/readings` answers 409 `session_not_live` and the station pauses until
the next tap or reboot. See docs/HARDWARE_INTEGRATION.md.
"""

from fastapi import APIRouter, status

from app.auth.dependencies import SettingsDep
from app.auth.device import CurrentDevice
from app.auth.service import utcnow
from app.core.config import Settings
from app.core.errors import AppError
from app.db.session import SessionDep
from app.models.devices import Device
from app.schemas.devices import LiveStatusOut, ReadingBatchIn, ReadingsAccepted, RfidScanIn, RfidScanOut
from app.schemas.errors import ErrorResponse
from app.services import live_sessions, readings, rfid
from app.services.audit import record_event

router = APIRouter(
    prefix="/device",
    tags=["device"],
    responses={401: {"model": ErrorResponse, "description": "Missing, wrong or revoked device token, or the device is disabled"}},
)


def _status(device: Device, settings: Settings, *, budget_exhausted: bool = False) -> dict[str, object]:
    now = utcnow()
    return {
        "live": device.is_live(now),
        "live_seconds_remaining": live_sessions.remaining_seconds(device, now),
        "budget_exhausted": budget_exhausted,
        "report_interval_seconds": settings.device_report_interval_seconds,
    }


@router.post(
    "/session",
    response_model=LiveStatusOut,
    summary="Ask for a short live session after power-on",
    description="Opens a session of DEVICE_BOOT_SESSION_MINUTES unless the station is already live for longer. "
    "Counts against the daily budget, so a reboot loop can't keep the station live.",
)
def start_boot_session(device: CurrentDevice, db: SessionDep, settings: SettingsDep) -> LiveStatusOut:
    now = utcnow()
    grant = live_sessions.grant(db, settings, device, minutes=settings.device_boot_session_minutes, now=now)
    if grant.started:
        record_event(db, "device.live_session_started", actor_type="device", target=device, details={"trigger": "boot"})
    db.commit()
    return LiveStatusOut.model_validate(_status(device, settings, budget_exhausted=grant.budget_exhausted))


@router.post(
    "/readings",
    response_model=ReadingsAccepted,
    status_code=status.HTTP_201_CREATED,
    summary="Upload one reading, or a backlog of up to 50",
    responses={
        409: {"model": ErrorResponse, "description": "Not in a live session (`session_not_live`): stop uploading"},
        429: {"model": ErrorResponse, "description": "Uploading faster than the report interval (`upload_too_soon`)"},
    },
)
def upload_readings(body: ReadingBatchIn, device: CurrentDevice, db: SessionDep, settings: SettingsDep) -> ReadingsAccepted:
    try:
        stored = readings.ingest(db, settings, device, body, utcnow())
    except AppError:
        # Refused before anything was added: keep last_seen_at so the portal knows the station is reachable.
        db.commit()
        raise
    db.commit()
    return ReadingsAccepted.model_validate({**_status(device, settings), "stored": stored})


@router.post(
    "/rfid-scans",
    response_model=RfidScanOut,
    summary="Check a card tap; a granted card opens or extends the live session",
    responses={400: {"model": ErrorResponse, "description": "Not a card UID (`invalid_card_uid`)"}},
)
def scan_card(body: RfidScanIn, device: CurrentDevice, db: SessionDep, settings: SettingsDep) -> RfidScanOut:
    outcome = rfid.record_scan(db, settings, device, body.uid, utcnow())
    db.commit()
    exhausted = outcome.grant.budget_exhausted if outcome.grant else False
    return RfidScanOut.model_validate(
        {
            **_status(device, settings, budget_exhausted=exhausted),
            "result": outcome.scan.result,
            "granted": outcome.scan.granted,
            "display_name": outcome.display_name,
        }
    )
