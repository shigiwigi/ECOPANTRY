"""Threshold evaluation on readings, alerts and the threshold API (migration 0007 seeds the 2 kg bin threshold)."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.models.alerts import Alert
from app.models.audit import AuditEvent
from app.models.auth import Employee
from app.models.devices import Device, SensorReading

from .conftest import sign_in
from .test_devices import DEVICES, READINGS, STATIONS, batch, bearer, go_live, reading

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
ALERTS = "/api/v1/alerts"
THRESHOLDS = "/api/v1/thresholds"


@pytest.fixture
def admin(api: TestClient, make_employee: MakeEmployee) -> dict[str, str]:
    return {"X-CSRF-Token": sign_in(api, make_employee(RoleCode.ADMIN).email)}


@pytest.fixture
def station(auth_app: FastAPI):  # type: ignore[no-untyped-def]
    with TestClient(auth_app) as client:
        yield client


@pytest.fixture
def token(api: TestClient, admin: dict[str, str]) -> str:
    return str(api.post(DEVICES, json={"name": "Inventory station 1"}, headers=admin).json()["token"])


@pytest.fixture
def send(station: TestClient, db: Session) -> Callable[..., Any]:
    """Upload one weight in grams (None: failed load cell), skipping the upload-rate limit between calls."""

    def upload(token: str, weight_g: float | None) -> Any:
        db.execute(update(Device).values(last_reading_at=None))
        db.commit()
        item = reading(weight_g=weight_g, load_cell_ok=weight_g is not None)
        response = station.post(READINGS, json=batch(item), headers=bearer(token))
        assert response.status_code == 201, response.text
        db.expire_all()
        return response

    return upload


def alerts(db: Session) -> list[Alert]:
    return list(db.scalars(select(Alert).order_by(Alert.opened_at)).unique())


def test_the_seeded_threshold_exists(api: TestClient, admin: dict[str, str]) -> None:
    (threshold,) = api.get(THRESHOLDS).json()

    assert threshold["label"] == "Waste bin nearly full"
    assert threshold["metric"] == "weight_g" and threshold["max_value"] == 2000.0 and threshold["clear_value"] == 1500.0
    assert threshold["device_id"] is None and threshold["enabled"] is True


# --- evaluation --------------------------------------------------------------


def test_a_weight_under_the_limit_opens_nothing(station: TestClient, token: str, send: Callable[..., Any], db: Session) -> None:
    go_live(station, token)
    send(token, 1900.0)

    assert alerts(db) == []


def test_crossing_the_limit_opens_exactly_one_alert_and_repeats_do_not_add_more(
    station: TestClient, token: str, send: Callable[..., Any], db: Session
) -> None:
    go_live(station, token)
    send(token, 1900.0)
    send(token, 2050.0)
    for _ in range(3):
        send(token, 2100.0)

    (alert,) = alerts(db)
    assert alert.status == "open" and alert.metric == "weight_g" and alert.severity == "warning"
    assert alert.trigger_value == 2050.0 and alert.last_value == 2100.0
    assert "2.05 kg" in alert.message
    opened = db.scalars(select(AuditEvent).where(AuditEvent.action == "alert.opened")).all()
    assert len(opened) == 1 and opened[0].actor_type == "device" and opened[0].target_id == str(alert.id)


def test_hysteresis_keeps_the_alert_until_the_value_passes_the_clear_value(
    station: TestClient, token: str, send: Callable[..., Any], db: Session
) -> None:
    go_live(station, token)
    send(token, 2050.0)

    send(token, 1600.0)  # between clear (1500) and trip (2000)
    assert [a.status for a in alerts(db)] == ["open"]

    send(token, 1400.0)
    (alert,) = alerts(db)
    assert alert.status == "resolved" and alert.resolved_at is not None and alert.resolved_by_id is None
    assert db.scalars(select(AuditEvent).where(AuditEvent.action == "alert.resolved")).one().actor_type == "device"

    send(token, 2200.0)  # a new breach opens a new alert; the old one stays in history
    assert [a.status for a in alerts(db)] == ["resolved", "open"]


def test_a_failed_load_cell_changes_nothing(station: TestClient, token: str, send: Callable[..., Any], db: Session) -> None:
    go_live(station, token)
    send(token, None)
    assert alerts(db) == []

    send(token, 2050.0)
    send(token, None)  # not "back to normal"
    assert [a.status for a in alerts(db)] == ["open"]


def test_each_station_gets_its_own_alert(
    api: TestClient, station: TestClient, admin: dict[str, str], token: str, send: Callable[..., Any], db: Session
) -> None:
    second = str(api.post(DEVICES, json={"name": "Inventory station 2"}, headers=admin).json()["token"])
    go_live(station, token)
    go_live(station, second)

    send(token, 2050.0)
    send(second, 2300.0)

    assert sorted(a.device.name for a in alerts(db)) == ["Inventory station 1", "Inventory station 2"]


def test_a_threshold_for_one_station_ignores_the_others(
    api: TestClient, station: TestClient, admin: dict[str, str], token: str, send: Callable[..., Any], db: Session
) -> None:
    second = str(api.post(DEVICES, json={"name": "Inventory station 2"}, headers=admin).json()["token"])
    only_first = api.get(STATIONS).json()["stations"][0]["id"]
    api.post(f"{THRESHOLDS}/{api.get(THRESHOLDS).json()[0]['id']}/disable", headers=admin)
    api.post(
        THRESHOLDS,
        json={"label": "Hot", "metric": "temperature_c", "device_id": only_first, "max_value": 30, "severity": "critical"},
        headers=admin,
    )
    go_live(station, token)
    go_live(station, second)
    for t, name in ((token, "first"), (second, "second")):
        db.execute(update(Device).values(last_reading_at=None))
        db.commit()
        assert station.post(READINGS, json=batch(reading(temperature_c=35.0)), headers=bearer(t)).status_code == 201, name

    (alert,) = alerts(db)
    assert str(alert.device_id) == only_first and alert.severity == "critical" and alert.metric == "temperature_c"


def test_a_disabled_threshold_opens_nothing(
    api: TestClient, station: TestClient, admin: dict[str, str], token: str, send: Callable[..., Any], db: Session
) -> None:
    threshold_id = api.get(THRESHOLDS).json()[0]["id"]
    assert api.post(f"{THRESHOLDS}/{threshold_id}/disable", headers=admin).json()["enabled"] is False
    go_live(station, token)

    send(token, 3000.0)

    assert alerts(db) == []


def test_readings_outside_a_live_session_are_refused_and_evaluate_nothing(
    station: TestClient, token: str, db: Session
) -> None:
    response = station.post(READINGS, json=batch(reading(weight_g=3000.0)), headers=bearer(token))

    assert response.status_code == 409 and response.json()["code"] == "session_not_live"
    assert alerts(db) == []
    assert db.scalars(select(SensorReading)).all() == []


def test_a_backlog_is_evaluated_once_from_its_newest_reading(
    station: TestClient, token: str, db: Session
) -> None:
    go_live(station, token)
    body = batch(
        reading(uptime_ms=1_000, weight_g=2500.0),
        reading(uptime_ms=31_000, weight_g=1000.0),
        sent_uptime_ms=31_000,
    )

    assert station.post(READINGS, json=body, headers=bearer(token)).status_code == 201

    assert alerts(db) == []  # the newest sample is back under the limit


# --- portal API ----------------------------------------------------------------


def _open_one(station: TestClient, token: str, send: Callable[..., Any]) -> None:
    go_live(station, token)
    send(token, 2050.0)


def test_listing_filters_and_summary(
    api: TestClient, station: TestClient, admin: dict[str, str], token: str, send: Callable[..., Any]
) -> None:
    _open_one(station, token, send)

    page = api.get(ALERTS).json()
    assert page["total"] == 1
    (item,) = page["items"]
    assert item["status"] == "open" and item["device_name"] == "Inventory station 1" and item["acknowledged_by_name"] is None
    assert api.get(ALERTS, params={"status": "resolved"}).json()["total"] == 0
    assert api.get(ALERTS, params={"status": "active", "metric": "weight_g"}).json()["total"] == 1
    assert api.get(ALERTS, params={"metric": "temperature_c"}).json()["total"] == 0
    assert api.get(ALERTS, params={"status": "nonsense"}).status_code == 422
    assert api.get(f"{ALERTS}/summary").json() == {
        "open": 1,
        "acknowledged": 0,
        "unresolved": 1,
        "by_severity": {"info": 0, "warning": 1, "critical": 0},
    }


def test_acknowledging_attributes_it_keeps_it_unresolved_and_is_audited(
    api: TestClient,
    station: TestClient,
    admin: dict[str, str],
    token: str,
    send: Callable[..., Any],
    db: Session,
    make_employee: MakeEmployee,
) -> None:
    _open_one(station, token, send)
    alert_id = api.get(ALERTS).json()["items"][0]["id"]

    response = api.post(f"{ALERTS}/{alert_id}/acknowledge", headers=admin)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "acknowledged" and body["acknowledged_by_name"].startswith("Test Admin")
    (alert,) = alerts(db)
    assert alert.acknowledged_by_id is not None and alert.resolved_at is None
    assert db.scalars(select(AuditEvent).where(AuditEvent.action == "alert.acknowledged")).one().actor_employee_id == alert.acknowledged_by_id
    assert api.get(f"{ALERTS}/summary").json()["acknowledged"] == 1

    send(token, 2100.0)  # still breached: stays acknowledged, no second alert
    assert [a.status for a in alerts(db)] == ["acknowledged"]

    send(token, 1000.0)
    assert [a.status for a in alerts(db)] == ["resolved"]
    assert api.post(f"{ALERTS}/{alert_id}/acknowledge", headers=admin).status_code == 409


def test_acknowledging_needs_a_csrf_token_and_a_real_alert(api: TestClient, admin: dict[str, str]) -> None:
    missing = "00000000-0000-0000-0000-000000000000"

    assert api.post(f"{ALERTS}/{missing}/acknowledge").status_code == 403
    assert api.post(f"{ALERTS}/{missing}/acknowledge", headers=admin).status_code == 404


def test_storekeepers_acknowledge_but_do_not_manage_thresholds(
    api: TestClient, station: TestClient, admin: dict[str, str], token: str, send: Callable[..., Any], make_employee: MakeEmployee
) -> None:
    _open_one(station, token, send)
    alert_id = api.get(ALERTS).json()["items"][0]["id"]
    threshold_id = api.get(THRESHOLDS).json()[0]["id"]
    csrf = {"X-CSRF-Token": sign_in(api, make_employee(RoleCode.STOREKEEPER).email)}

    assert api.get(THRESHOLDS).status_code == 200
    assert api.post(f"{THRESHOLDS}/{threshold_id}/disable", headers=csrf).status_code == 403
    assert api.patch(f"{THRESHOLDS}/{threshold_id}", json={"label": "x"}, headers=csrf).status_code == 403
    assert api.post(f"{ALERTS}/{alert_id}/acknowledge", headers=csrf).status_code == 200


def test_inspectors_view_but_cannot_acknowledge_or_manage(
    api: TestClient, station: TestClient, admin: dict[str, str], token: str, send: Callable[..., Any], make_employee: MakeEmployee
) -> None:
    _open_one(station, token, send)
    alert_id = api.get(ALERTS).json()["items"][0]["id"]
    threshold_id = api.get(THRESHOLDS).json()[0]["id"]
    csrf = {"X-CSRF-Token": sign_in(api, make_employee(RoleCode.INSPECTOR).email)}

    assert api.get(ALERTS).status_code == 200
    assert api.get(f"{ALERTS}/summary").status_code == 200
    assert api.get(THRESHOLDS).status_code == 200
    assert api.post(f"{ALERTS}/{alert_id}/acknowledge", headers=csrf).status_code == 403
    assert api.post(THRESHOLDS, json={"label": "x", "metric": "weight_g", "max_value": 5}, headers=csrf).status_code == 403
    assert api.post(f"{THRESHOLDS}/{threshold_id}/enable", headers=csrf).status_code == 403
    assert [a["status"] for a in api.get(ALERTS).json()["items"]] == ["open"]


# --- threshold management ----------------------------------------------------------


def make(api: TestClient, admin: dict[str, str], **fields: Any) -> Any:
    body = {"label": "Fridge too warm", "metric": "temperature_c", "max_value": 8.0, "clear_value": 6.0, **fields}
    return api.post(THRESHOLDS, json=body, headers=admin)


def test_creating_updating_and_toggling_a_threshold_is_audited(
    api: TestClient, admin: dict[str, str], db: Session
) -> None:
    created = make(api, admin)
    assert created.status_code == 201
    threshold = created.json()
    assert threshold["enabled"] is True and threshold["severity"] == "warning" and threshold["device_name"] is None

    updated = api.patch(f"{THRESHOLDS}/{threshold['id']}", json={"max_value": 9.0, "severity": "critical"}, headers=admin)
    assert updated.status_code == 200 and updated.json()["max_value"] == 9.0 and updated.json()["severity"] == "critical"
    assert api.post(f"{THRESHOLDS}/{threshold['id']}/disable", headers=admin).json()["enabled"] is False
    assert api.post(f"{THRESHOLDS}/{threshold['id']}/enable", headers=admin).json()["enabled"] is True

    actions = db.scalars(select(AuditEvent.action).where(AuditEvent.action.like("threshold.%"))).all()
    assert sorted(actions) == ["threshold.created", "threshold.disabled", "threshold.enabled", "threshold.updated"]


@pytest.mark.parametrize(
    "fields",
    [
        {"min_value": 2.0},  # both limits
        {"max_value": None},  # neither limit
        {"clear_value": 9.0},  # above a maximum
        {"max_value": None, "min_value": 2.0, "clear_value": 1.0},  # below a minimum
        {"max_value": 500.0},  # outside the sensor's range
        {"label": "   "},
        {"device_id": "00000000-0000-0000-0000-000000000000"},
    ],
)
def test_invalid_thresholds_are_rejected(api: TestClient, admin: dict[str, str], fields: dict[str, Any]) -> None:
    response = make(api, admin, **fields)

    assert response.status_code in (400, 422), response.text
    if response.status_code == 400:
        assert response.json()["code"] == "invalid_threshold"


def test_an_update_cannot_leave_a_threshold_invalid(api: TestClient, admin: dict[str, str]) -> None:
    threshold = make(api, admin).json()

    both = api.patch(f"{THRESHOLDS}/{threshold['id']}", json={"min_value": 1.0}, headers=admin)
    assert both.status_code == 400 and both.json()["code"] == "invalid_threshold"
    switched = api.patch(
        f"{THRESHOLDS}/{threshold['id']}", json={"max_value": None, "min_value": 2.0, "clear_value": 3.0}, headers=admin
    )
    assert switched.status_code == 200 and switched.json()["min_value"] == 2.0 and switched.json()["max_value"] is None
    assert api.get(THRESHOLDS).json()[-1]["min_value"] == 2.0


def test_a_minimum_threshold_opens_when_the_value_falls_to_it(
    api: TestClient, station: TestClient, admin: dict[str, str], token: str, db: Session
) -> None:
    make(api, admin, label="Fridge too cold", max_value=None, min_value=1.0, clear_value=3.0)
    go_live(station, token)

    for temperature, expected in ((5.0, []), (0.5, ["open"]), (2.0, ["open"]), (3.5, ["resolved"])):
        db.execute(update(Device).values(last_reading_at=None))
        db.commit()
        station.post(READINGS, json=batch(reading(temperature_c=temperature, weight_g=100.0)), headers=bearer(token))
        db.expire_all()
        assert [a.status for a in alerts(db)] == expected, temperature
