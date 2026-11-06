"""Live sessions: the only time a sensor station may upload readings.

A session opens from a physical action at the station (power-on, or an
authorised RFID card) and lasts a few minutes. A tap while live pushes the
end out to `now + minutes`; taps don't stack beyond that. Every second granted
counts against a per-device daily budget, so neither a reboot loop nor
repeated taps can keep the free-tier database awake all day.

Outside a session the backend refuses readings (409 `session_not_live`), so
even firmware that ignores the timer can't keep writing.
"""

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ConflictError
from app.models.devices import Device, DeviceLiveUsage


class SessionNotLiveError(ConflictError):
    code = "session_not_live"
    detail = "The station isn't in a live session. Tap an authorised card on the station to go live."


@dataclass(frozen=True)
class LiveGrant:
    live_until: datetime | None
    # True when the daily budget stopped the session from being opened or extended in full.
    budget_exhausted: bool
    # True when the station wasn't live before this grant.
    started: bool


def _usage_for_update(db: Session, device: Device, day: date) -> DeviceLiveUsage:
    db.execute(
        insert(DeviceLiveUsage).values(device_id=device.id, day=day, live_seconds=0).on_conflict_do_nothing()
    )
    return db.scalars(
        select(DeviceLiveUsage)
        .where(DeviceLiveUsage.device_id == device.id, DeviceLiveUsage.day == day)
        .with_for_update()
    ).one()


def used_seconds(db: Session, device: Device, day: date) -> int:
    used = db.scalar(
        select(DeviceLiveUsage.live_seconds).where(DeviceLiveUsage.device_id == device.id, DeviceLiveUsage.day == day)
    )
    return used or 0


def grant(db: Session, settings: Settings, device: Device, *, minutes: int, now: datetime) -> LiveGrant:
    """Open the session, or extend it to `now + minutes`, within today's budget."""
    was_live = device.is_live(now)
    base = device.live_until if was_live and device.live_until is not None else now
    target = now + timedelta(minutes=minutes)
    if target <= base:
        # Already live for at least that long (for example a reboot during a session).
        return LiveGrant(live_until=device.live_until, budget_exhausted=False, started=False)

    usage = _usage_for_update(db, device, now.date())
    remaining = settings.device_daily_live_minutes * 60 - usage.live_seconds
    if remaining <= 0:
        return LiveGrant(live_until=device.live_until if was_live else None, budget_exhausted=True, started=False)

    wanted = (target - base).total_seconds()
    extra = min(wanted, float(remaining))
    usage.live_seconds += math.ceil(extra)
    device.live_until = base + timedelta(seconds=extra)
    if not was_live:
        device.live_started_at = now
    return LiveGrant(live_until=device.live_until, budget_exhausted=extra < wanted, started=not was_live)


def remaining_seconds(device: Device, now: datetime) -> int:
    if not device.is_live(now) or device.live_until is None:
        return 0
    return max(0, math.floor((device.live_until - now).total_seconds()))


def require_live(device: Device, now: datetime) -> None:
    if not device.is_live(now):
        raise SessionNotLiveError()
