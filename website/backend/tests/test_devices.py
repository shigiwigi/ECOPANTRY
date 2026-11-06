"""Sensor stations: device tokens, live sessions, reading uploads and card taps."""

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.factory import create_app
from app.models.audit import AuditEvent
from app.models.auth import Employee
from app.models.devices import Device, SensorReading
from app.models.rfid import RfidScan

from .conftest import make_settings, sign_in

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
DEVICES = "/api/v1/devices"
SESSION = "/api/v1/device/session"
READINGS = "/api/v1/device/readings"
SCANS = "/api/v1/device/rfid-scans"
CARDS = "/api/v1/rfid/cards"
STATIONS = "/api/v1/sensors/stations"

CARD_UID = "D5:61:E9:E7"


def reading(uptime_ms: int = 10_000, **overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "uptime_ms": uptime_ms,
        "temperature_c": 24.5,
        "humidity_pct": 61.0,
        "weight_g": 412.3,
        "ph_value": 6.6,
        "ph_voltage": 1.12,
        "dht_ok": True,
        "load_cell_ok": True,
    }
    values.update(overrides)
    return values


def batch(*readings: dict[str, Any], sent_uptime_ms: int | None = None) -> dict[str, Any]:
    items = list(readings) or [reading()]
    return {"sent_uptime_ms": sent_uptime_ms or max(r["uptime_ms"] for r in items), "readings": items}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(api: TestClient, make_employee: MakeEmployee) -> dict[str, str]:
    """Signs `api` in as an administrator; returns the CSRF header."""
    employee = make_employee(RoleCode.ADMIN)
    return {"X-CSRF-Token": sign_in(api, employee.email)}


@pytest.fixture
def station(auth_app: FastAPI) -> Iterator[TestClient]:
    """A client with no cookies, like the ESP32."""
    with TestClient(auth_app) as client:
        yield client


@pytest.fixture
def token(api: TestClient, admin: dict[str, str]) -> str:
    response = api.post(DEVICES, json={"name": "Inventory station 1"}, headers=admin)
    assert response.status_code == 201, response.text
    return str(response.json()["token"])


def go_live(station: TestClient, token: str) -> dict[str, Any]:
    response = station.post(SESSION, headers=bearer(token))
    assert response.status_code == 200, response.text
    return dict(response.json())


def assign_card(api: TestClient, admin: dict[str, str], employee: Employee, uid: str = CARD_UID) -> dict[str, Any]:
    response = api.post(CARDS, json={"uid": uid, "employee_id": str(employee.id)}, headers=admin)
    assert response.status_code == 201, response.text
    return dict(response.json())


# --- registering and tokens -------------------------------------------------


def test_registering_a_device_shows_the_token_once(api: TestClient, admin: dict[str, str], db: Session) -> None:
    response = api.post(DEVICES, json={"name": "  Inventory   station 1 "}, headers=admin)

    assert response.status_code == 201
    body = response.json()
    assert body["token"].startswith("epd_")
    assert body["device"]["name"] == "Inventory station 1"
    assert body["token"].startswith(body["device"]["token_prefix"])
    listed = api.get(DEVICES).json()
    assert len(listed) == 1 and "token" not in listed[0] and "token_hash" not in listed[0]
    assert body["token"] not in api.get(DEVICES).text
    device = db.scalars(select(Device)).one()
    assert body["token"].encode() not in device.token_hash
    actions = db.scalars(select(AuditEvent.action)).all()
    assert "device.registered" in actions


def test_duplicate_device_names_are_a_conflict(api: TestClient, admin: dict[str, str], token: str) -> None:
    response = api.post(DEVICES, json={"name": "Inventory station 1"}, headers=admin)

    assert response.status_code == 409


@pytest.mark.parametrize("role", [RoleCode.STOREKEEPER, RoleCode.INSPECTOR])
def test_only_administrators_manage_devices(api: TestClient, make_employee: MakeEmployee, role: RoleCode) -> None:
    csrf = sign_in(api, make_employee(role).email)

    assert api.get(DEVICES).status_code == 403
    assert api.post(DEVICES, json={"name": "x"}, headers={"X-CSRF-Token": csrf}).status_code == 403


def test_device_routes_ignore_staff_sessions(api: TestClient, admin: dict[str, str], token: str) -> None:
    # `api` is signed in as an administrator, but sends no device token.
    for path in (SESSION, READINGS, SCANS):
        response = api.post(path, json={}, headers=admin)
        assert response.status_code == 401, path
        assert response.json()["code"] == "not_authenticated"


def test_staff_routes_ignore_device_tokens(station: TestClient, token: str) -> None:
    assert station.get(STATIONS, headers=bearer(token)).status_code == 401
    assert station.get(DEVICES, headers=bearer(token)).status_code == 401


@pytest.mark.parametrize("header", ["Bearer epd_wrong", "Bearer ", "Basic abc", "epd_wrong", ""])
def test_wrong_device_credentials_are_refused(station: TestClient, token: str, header: str) -> None:
    response = station.post(SESSION, headers={"Authorization": header})

    assert response.status_code == 401


def test_rotating_the_token_stops_the_old_one(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str
) -> None:
    go_live(station, token)
    device_id = api.get(DEVICES).json()[0]["id"]

    response = api.post(f"{DEVICES}/{device_id}/rotate-token", headers=admin)

    assert response.status_code == 200
    new_token = response.json()["token"]
    assert new_token != token
    assert station.post(SESSION, headers=bearer(token)).status_code == 401
    # Rotation also ended the live session; the new token starts a fresh one.
    assert go_live(station, new_token)["live"] is True


def test_a_disabled_device_is_refused_until_enabled(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str
) -> None:
    device_id = api.get(DEVICES).json()[0]["id"]

    assert api.post(f"{DEVICES}/{device_id}/disable", headers=admin).status_code == 200
    assert station.post(SESSION, headers=bearer(token)).status_code == 401

    assert api.post(f"{DEVICES}/{device_id}/enable", headers=admin).status_code == 200
    assert station.post(SESSION, headers=bearer(token)).status_code == 200


def test_firmware_version_and_last_seen_are_recorded(api: TestClient, station: TestClient, token: str) -> None:
    station.post(SESSION, headers={**bearer(token), "X-Device-Firmware": "0.1.0"})

    device = api.get(DEVICES).json()[0]
    assert device["firmware_version"] == "0.1.0"
    assert device["last_seen_at"] is not None


# --- live sessions ------------------------------------------------------------


def test_readings_are_refused_outside_a_live_session(station: TestClient, token: str, db: Session) -> None:
    response = station.post(READINGS, json=batch(), headers=bearer(token))

    assert response.status_code == 409
    assert response.json()["code"] == "session_not_live"
    assert db.scalar(select(func.count()).select_from(SensorReading)) == 0


def test_power_on_opens_a_short_session(station: TestClient, token: str) -> None:
    status = go_live(station, token)

    assert status["live"] is True
    assert 290 <= status["live_seconds_remaining"] <= 300  # DEVICE_BOOT_SESSION_MINUTES = 5
    assert status["budget_exhausted"] is False
    assert status["report_interval_seconds"] == 10


def test_a_reboot_during_a_session_does_not_extend_it(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str, make_employee: MakeEmployee
) -> None:
    assign_card(api, admin, make_employee())
    tapped = station.post(SCANS, json={"uid": CARD_UID}, headers=bearer(token)).json()

    rebooted = go_live(station, token)

    assert tapped["live_seconds_remaining"] > 800
    assert rebooted["live_seconds_remaining"] <= tapped["live_seconds_remaining"]


def test_an_administrator_can_stop_a_live_session(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str
) -> None:
    go_live(station, token)
    device_id = api.get(DEVICES).json()[0]["id"]

    response = api.post(f"{DEVICES}/{device_id}/stop-live", headers=admin)

    assert response.status_code == 200 and response.json()["live"] is False
    assert station.post(READINGS, json=batch(), headers=bearer(token)).json()["code"] == "session_not_live"
    assert api.post(f"{DEVICES}/{device_id}/stop-live", headers=admin).status_code == 409


@pytest.fixture
def tight_budget_station(auth_app: FastAPI, migrated_database_url: str) -> Iterator[TestClient]:
    """Same database, but a one-minute daily budget."""
    app = create_app(make_settings(database_url=migrated_database_url, device_daily_live_minutes=1))
    with TestClient(app) as client:
        yield client
    app.state.database.dispose()


def test_the_daily_budget_caps_live_time(
    api: TestClient,
    admin: dict[str, str],
    token: str,
    tight_budget_station: TestClient,
    make_employee: MakeEmployee,
) -> None:
    first = tight_budget_station.post(SESSION, headers=bearer(token)).json()

    # Five minutes asked for, one minute left in the budget.
    assert first["live"] is True
    assert first["live_seconds_remaining"] <= 60
    assert first["budget_exhausted"] is True

    assign_card(api, admin, make_employee())
    tap = tight_budget_station.post(SCANS, json={"uid": CARD_UID}, headers=bearer(token)).json()
    assert tap["granted"] is True
    assert tap["budget_exhausted"] is True
    assert tap["live_seconds_remaining"] <= 60


# --- uploads ------------------------------------------------------------------


def test_a_live_station_uploads_readings(station: TestClient, token: str, db: Session) -> None:
    go_live(station, token)

    response = station.post(READINGS, json=batch(), headers=bearer(token))

    assert response.status_code == 201
    body = response.json()
    assert body["stored"] == 1 and body["live"] is True
    saved = db.scalars(select(SensorReading)).one()
    assert saved.temperature_c == 24.5 and saved.weight_g == 412.3 and saved.dht_ok is True


def test_uploads_faster_than_the_interval_are_refused(station: TestClient, token: str) -> None:
    go_live(station, token)
    assert station.post(READINGS, json=batch(), headers=bearer(token)).status_code == 201

    response = station.post(READINGS, json=batch(), headers=bearer(token))

    assert response.status_code == 429
    assert response.json()["code"] == "upload_too_soon"
    assert response.headers["retry-after"] == "5"


def test_a_backlog_keeps_its_timing_and_drops_hour_old_samples(station: TestClient, token: str, db: Session) -> None:
    go_live(station, token)
    now_ms = 5_000_000
    body = batch(
        reading(uptime_ms=now_ms - 3_700_000),  # older than an hour: dropped
        reading(uptime_ms=now_ms - 20_000),
        reading(uptime_ms=now_ms),
        sent_uptime_ms=now_ms,
    )

    response = station.post(READINGS, json=body, headers=bearer(token))

    assert response.json()["stored"] == 2
    older, newer = db.scalars(select(SensorReading).order_by(SensorReading.recorded_at)).all()
    gap = (newer.recorded_at - older.recorded_at).total_seconds()
    assert gap == pytest.approx(20, abs=0.01)


@pytest.mark.parametrize(
    "body",
    [
        batch(reading(temperature_c=95.0)),
        batch(reading(humidity_pct=-1)),
        batch(reading(ph_value=15)),
        batch(reading(dht_ok=False)),  # failed sensor must send null, not a stale value
        batch(reading(load_cell_ok=False)),
        batch(reading(uptime_ms=20_000), sent_uptime_ms=10_000),
        batch(reading(extra_field=1)),
        {"sent_uptime_ms": 1, "readings": []},
        batch(*[reading(uptime_ms=i) for i in range(1, 52)]),
    ],
)
def test_invalid_readings_are_rejected(station: TestClient, token: str, body: dict[str, Any]) -> None:
    go_live(station, token)

    response = station.post(READINGS, json=body, headers=bearer(token))

    assert response.status_code == 422


def test_a_failed_sensor_is_stored_as_missing(station: TestClient, token: str, db: Session) -> None:
    go_live(station, token)
    body = batch(reading(temperature_c=None, humidity_pct=None, dht_ok=False, weight_g=None, load_cell_ok=False))

    assert station.post(READINGS, json=body, headers=bearer(token)).status_code == 201

    saved = db.scalars(select(SensorReading)).one()
    assert saved.temperature_c is None and saved.weight_g is None and saved.dht_ok is False


# --- card taps ------------------------------------------------------------------


def test_an_unknown_card_is_denied_and_recorded(station: TestClient, token: str, db: Session) -> None:
    response = station.post(SCANS, json={"uid": "ba e1 20 56"}, headers=bearer(token))

    body = response.json()
    assert response.status_code == 200
    assert body["granted"] is False and body["result"] == "unknown_card"
    assert body["display_name"] is None and body["live"] is False
    assert db.scalars(select(RfidScan.uid)).one() == "BA:E1:20:56"


def test_an_assigned_card_opens_a_live_session(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str, make_employee: MakeEmployee, db: Session
) -> None:
    holder = make_employee(RoleCode.STOREKEEPER)
    assign_card(api, admin, holder)

    response = station.post(SCANS, json={"uid": CARD_UID.lower()}, headers=bearer(token))

    body = response.json()
    assert body["granted"] is True and body["result"] == "granted"
    assert body["display_name"] == holder.full_name[:16]
    assert body["live"] is True and 890 <= body["live_seconds_remaining"] <= 900
    started = db.scalars(select(AuditEvent).where(AuditEvent.action == "device.live_session_started")).one()
    assert started.actor_type == "device" and started.details["trigger"] == "rfid"
    assert started.details["employee_id"] == str(holder.id)


def test_a_revoked_card_is_denied(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str, make_employee: MakeEmployee
) -> None:
    card = assign_card(api, admin, make_employee())
    assert api.post(f"{CARDS}/{card['id']}/revoke", headers=admin).status_code == 200

    body = station.post(SCANS, json={"uid": CARD_UID}, headers=bearer(token)).json()

    assert body["granted"] is False and body["result"] == "card_revoked" and body["live"] is False


def test_a_deactivated_employees_card_is_denied(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str, make_employee: MakeEmployee, db: Session
) -> None:
    holder = make_employee()
    assign_card(api, admin, holder)
    assert api.post(f"/api/v1/employees/{holder.id}/deactivate", headers=admin).status_code == 200

    body = station.post(SCANS, json={"uid": CARD_UID}, headers=bearer(token)).json()

    assert body["granted"] is False and body["result"] == "employee_inactive"


def test_a_malformed_uid_is_rejected(station: TestClient, token: str) -> None:
    response = station.post(SCANS, json={"uid": "not a card uid"}, headers=bearer(token))

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_card_uid"
