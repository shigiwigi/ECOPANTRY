"""Portal side of the stations: latest readings, history, and RFID card management."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.models.audit import AuditEvent
from app.models.auth import Employee

from .conftest import sign_in
from .test_devices import CARD_UID, CARDS, DEVICES, READINGS, SCANS, STATIONS, batch, bearer, go_live, reading

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]


@pytest.fixture
def admin(api: TestClient, make_employee: MakeEmployee) -> dict[str, str]:
    employee = make_employee(RoleCode.ADMIN)
    return {"X-CSRF-Token": sign_in(api, employee.email)}


@pytest.fixture
def station(auth_app):  # type: ignore[no-untyped-def]
    with TestClient(auth_app) as client:
        yield client


@pytest.fixture
def token(api: TestClient, admin: dict[str, str]) -> str:
    return str(api.post(DEVICES, json={"name": "Inventory station 1"}, headers=admin).json()["token"])


# --- latest readings ------------------------------------------------------------


def test_stations_without_readings_are_stale_and_paused(api: TestClient, token: str) -> None:
    body = api.get(STATIONS).json()

    (only,) = body["stations"]
    assert only["latest"] is None and only["stale"] is True and only["live"] is False


@pytest.mark.parametrize("role", list(RoleCode))
def test_every_role_sees_the_latest_reading(
    api: TestClient, station: TestClient, token: str, make_employee: MakeEmployee, role: RoleCode
) -> None:
    go_live(station, token)
    station.post(READINGS, json=batch(), headers=bearer(token))
    sign_in(api, make_employee(role).email)

    (only,) = api.get(STATIONS).json()["stations"]

    assert only["live"] is True and only["stale"] is False
    latest = only["latest"]
    assert latest["temperature_c"] == 24.5 and latest["humidity_pct"] == 61.0
    assert latest["weight_g"] == 412.3 and latest["ph_value"] == 6.6


def test_station_responses_never_carry_device_secrets(api: TestClient, token: str) -> None:
    text = api.get(STATIONS).text

    assert token not in text and "token" not in text


# --- history ----------------------------------------------------------------------


def test_history_buckets_one_metric(api: TestClient, station: TestClient, token: str) -> None:
    go_live(station, token)
    body = batch(
        reading(uptime_ms=1_000, temperature_c=20.0),
        reading(uptime_ms=31_000, temperature_c=22.0),
        reading(uptime_ms=61_000, temperature_c=None, humidity_pct=None, dht_ok=False),
        sent_uptime_ms=61_000,
    )
    station.post(READINGS, json=body, headers=bearer(token))
    device_id = api.get(STATIONS).json()["stations"][0]["id"]

    response = api.get(f"{STATIONS}/{device_id}/history", params={"metric": "temperature_c", "range": "24h"})

    assert response.status_code == 200
    history = response.json()
    assert history["bucket_seconds"] == 300
    points = history["points"]
    assert sum(point["count"] for point in points) == 2  # the failed read isn't a point
    assert min(point["min"] for point in points) == 20.0
    assert max(point["max"] for point in points) == 22.0


def test_history_rejects_unknown_metrics_and_ranges(api: TestClient, token: str) -> None:
    device_id = api.get(STATIONS).json()["stations"][0]["id"]

    assert api.get(f"{STATIONS}/{device_id}/history", params={"metric": "password"}).status_code == 422
    assert api.get(f"{STATIONS}/{device_id}/history", params={"metric": "weight_g", "range": "1y"}).status_code == 422


def test_history_of_an_unknown_station_is_404(api: TestClient, admin: dict[str, str]) -> None:
    response = api.get(f"{STATIONS}/00000000-0000-0000-0000-000000000000/history", params={"metric": "weight_g"})

    assert response.status_code == 404


# --- cards ------------------------------------------------------------------------


def test_assigning_a_card_normalises_the_uid_and_is_audited(
    api: TestClient, admin: dict[str, str], make_employee: MakeEmployee, db: Session
) -> None:
    holder = make_employee()

    response = api.post(CARDS, json={"uid": "d5-61-e9-e7", "employee_id": str(holder.id)}, headers=admin)

    assert response.status_code == 201
    card = response.json()
    assert card["uid"] == CARD_UID and card["active"] is True and card["employee"]["id"] == str(holder.id)
    assert "rfid_card.assigned" in db.scalars(select(AuditEvent.action)).all()


def test_a_card_can_only_belong_to_one_person(api: TestClient, admin: dict[str, str], make_employee: MakeEmployee) -> None:
    first, second = make_employee(), make_employee()
    card = api.post(CARDS, json={"uid": CARD_UID, "employee_id": str(first.id)}, headers=admin).json()

    taken = api.post(CARDS, json={"uid": CARD_UID, "employee_id": str(second.id)}, headers=admin)
    assert taken.status_code == 409

    api.post(f"{CARDS}/{card['id']}/revoke", headers=admin)
    moved = api.post(CARDS, json={"uid": CARD_UID, "employee_id": str(second.id)}, headers=admin)
    assert moved.status_code == 201 and moved.json()["employee"]["id"] == str(second.id)
    assert moved.json()["id"] == card["id"]  # the same card row, reassigned


def test_inactive_accounts_cannot_get_cards(api: TestClient, admin: dict[str, str], make_employee: MakeEmployee) -> None:
    holder = make_employee(active=False)

    response = api.post(CARDS, json={"uid": CARD_UID, "employee_id": str(holder.id)}, headers=admin)

    assert response.status_code == 409


@pytest.mark.parametrize("uid", ["D5:61:E9", "ZZ:61:E9:E7", "D5:61:E9:E7:00"])
def test_invalid_card_uids_are_rejected(
    api: TestClient, admin: dict[str, str], make_employee: MakeEmployee, uid: str
) -> None:
    response = api.post(CARDS, json={"uid": uid, "employee_id": str(make_employee().id)}, headers=admin)

    assert response.status_code in (400, 422)


def test_storekeepers_cannot_manage_cards(api: TestClient, make_employee: MakeEmployee) -> None:
    csrf = sign_in(api, make_employee(RoleCode.STOREKEEPER).email)

    assert api.get(CARDS).status_code == 403
    assert api.post(CARDS, json={"uid": CARD_UID, "employee_id": str(make_employee().id)},
                    headers={"X-CSRF-Token": csrf}).status_code == 403  # fmt: skip


def test_recent_scans_show_unknown_cards_for_assigning(
    api: TestClient, admin: dict[str, str], station: TestClient, token: str
) -> None:
    station.post(SCANS, json={"uid": "BA:E1:20:56"}, headers=bearer(token))

    scans: list[dict[str, Any]] = api.get("/api/v1/rfid/scans").json()

    assert scans[0]["uid"] == "BA:E1:20:56" and scans[0]["result"] == "unknown_card"
    assert scans[0]["employee_name"] is None
