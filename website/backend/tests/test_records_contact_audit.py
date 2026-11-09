"""Waste and pH records, the public contact form and admin inbox, the audit viewer, retention commands."""

import io
import uuid
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.auth.service import utcnow
from app.cli import main
from app.core.config import Settings
from app.models.alerts import Alert  # noqa: F401  (keeps the mapper registry complete)
from app.models.audit import AuditEvent
from app.models.auth import Employee
from app.models.devices import SensorReading
from app.models.enquiries import Enquiry
from app.models.inventory import Batch, Ingredient
from app.models.ph import PhRecord
from app.services import devices as device_service

from .conftest import sign_in

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
WASTE = "/api/v1/waste/records"
PH = "/api/v1/ph/records"
ENQ = "/api/v1/public/enquiries"
INBOX = "/api/v1/enquiries"
AUDIT = "/api/v1/audit"


def as_role(api: TestClient, make_employee: MakeEmployee, role: RoleCode) -> tuple[dict[str, str], Employee]:
    employee = make_employee(role)
    return {"X-CSRF-Token": sign_in(api, employee.email)}, employee


def actions(db: Session, prefix: str) -> list[str]:
    db.expire_all()
    return list(db.scalars(select(AuditEvent.action).where(AuditEvent.action.like(f"{prefix}%")).order_by(AuditEvent.id)))


def make_batch(db: Session, owner: Employee) -> Batch:
    ingredient = Ingredient(name="Flour", unit_id=db.scalar(text("SELECT id FROM units WHERE code = 'kg'")))
    db.add(ingredient)
    db.flush()
    batch = Batch(
        ingredient_id=ingredient.id, label_code="WASTE00001", received_on=date(2026, 11, 1),
        expiry_on=date(2026, 12, 1), quantity=1, remaining_quantity=1, created_by_id=owner.id,
    )  # fmt: skip
    db.add(batch)
    db.commit()
    return batch


# --- waste ------------------------------------------------------------------


def test_record_waste_is_attributed_and_audited(api: TestClient, make_employee: MakeEmployee, db: Session) -> None:
    headers, keeper = as_role(api, make_employee, RoleCode.STOREKEEPER)

    response = api.post(WASTE, json={"category": "spoiled", "reason": "  Mould  on the\n loaf ", "weight_kg": "1.25"}, headers=headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["employee"] == {"id": str(keeper.id), "full_name": keeper.full_name}
    assert body["reason"] == "Mould on the loaf"
    assert body["weight_kg"] == "1.250"
    assert actions(db, "waste.") == ["waste.recorded"]


def test_waste_validation(api: TestClient, make_employee: MakeEmployee, db: Session) -> None:
    headers, keeper = as_role(api, make_employee, RoleCode.STOREKEEPER)

    assert api.post(WASTE, json={"category": "nope"}, headers=headers).status_code == 422
    assert api.post(WASTE, json={"category": "spoiled", "weight_kg": "-1"}, headers=headers).status_code == 422
    other = api.post(WASTE, json={"category": "other", "reason": "   "}, headers=headers)
    assert (other.status_code, other.json()["code"]) == (400, "reason_required")
    ghost = api.post(WASTE, json={"category": "damaged", "batch_id": str(uuid.uuid4())}, headers=headers)
    assert (ghost.status_code, ghost.json()["code"]) == (400, "unknown_batch")
    future = api.post(WASTE, json={"category": "damaged", "recorded_at": (utcnow() + timedelta(days=2)).isoformat()}, headers=headers)
    assert future.status_code == 400
    batch = make_batch(db, keeper)
    assert api.post(WASTE, json={"category": "expired", "batch_id": str(batch.id)}, headers=headers).status_code == 201


def test_waste_list_filters_and_summary(api: TestClient, make_employee: MakeEmployee) -> None:
    headers, keeper = as_role(api, make_employee, RoleCode.STOREKEEPER)
    old = (utcnow() - timedelta(days=10)).isoformat()
    for body in (
        {"category": "spoiled", "weight_kg": "2.000"},
        {"category": "spoiled", "weight_kg": "0.500"},
        {"category": "expired"},
        {"category": "damaged", "weight_kg": "1.000", "recorded_at": old},
    ):
        assert api.post(WASTE, json=body, headers=headers).status_code == 201

    everything = api.get(WASTE).json()
    assert everything["total"] == 4
    assert everything["items"][-1]["category"] == "damaged"  # oldest last: newest first
    assert api.get(WASTE, params={"category": "spoiled"}).json()["total"] == 2
    assert api.get(WASTE, params={"employee_id": str(uuid.uuid4())}).json()["total"] == 0
    assert api.get(WASTE, params={"employee_id": str(keeper.id)}).json()["total"] == 4
    today = date.today().isoformat()
    assert api.get(WASTE, params={"date_from": today}).json()["total"] == 3
    assert api.get(WASTE, params={"date_to": (date.today() - timedelta(days=5)).isoformat()}).json()["total"] == 1
    assert api.get(WASTE, params={"limit": 2}).json()["items"].__len__() == 2

    summary = api.get("/api/v1/waste/summary", params={"date_from": today}).json()
    by = {row["category"]: row for row in summary["by_category"]}
    assert (summary["records"], summary["weight_kg"]) == (3, "2.500")
    assert (by["spoiled"]["records"], by["spoiled"]["weight_kg"]) == (2, "2.500")
    assert (by["expired"]["records"], by["damaged"]["records"]) == (1, 0)
    assert api.get("/api/v1/waste/summary").json()["weight_kg"] == "3.500"


# --- pH ---------------------------------------------------------------------


def test_record_ph_is_experimental_and_has_no_verdict(api: TestClient, make_employee: MakeEmployee, db: Session) -> None:
    headers, keeper = as_role(api, make_employee, RoleCode.STOREKEEPER)

    response = api.post(
        PH,
        json={"sample_description": "Sourdough starter", "ph_value": "4.256", "reference_min": "3.5",
              "reference_max": "4.5", "calibration_note": "Two-point, pH 4 and 7"},
        headers=headers,
    )  # fmt: skip

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["ph_value"] == "4.26" and body["operator"]["id"] == str(keeper.id)
    assert body["experimental"] is True and "never a verdict" in body["note"]
    assert not {"safe", "spoiled", "verdict", "status", "pass"} & set(body)
    assert actions(db, "ph.") == ["ph.recorded"]
    listing = api.get(PH).json()
    assert listing["total"] == 1 and listing["items"][0]["experimental"] is True


@pytest.mark.parametrize(
    "extra",
    [
        {"ph_value": "14.5"},
        {"ph_value": "-1"},
        {"reference_min": "5"},
        {"reference_min": "6", "reference_max": "5"},
    ],
)
def test_ph_validation(api: TestClient, make_employee: MakeEmployee, extra: dict[str, Any]) -> None:
    headers, _ = as_role(api, make_employee, RoleCode.STOREKEEPER)

    response = api.post(PH, json={"sample_description": "Dough", "ph_value": "5", **extra}, headers=headers)

    assert response.status_code in (400, 422)
    assert api.get(PH).json()["total"] == 0


def test_ph_blank_sample_and_unknown_reading(api: TestClient, make_employee: MakeEmployee) -> None:
    headers, _ = as_role(api, make_employee, RoleCode.STOREKEEPER)

    assert api.post(PH, json={"sample_description": "  ", "ph_value": "5"}, headers=headers).status_code == 400
    missing = api.post(PH, json={"sample_description": "Dough", "ph_value": "5", "sensor_reading_id": 999}, headers=headers)
    assert missing.json()["code"] == "unknown_reading"


# --- role matrix and CSRF ---------------------------------------------------


def test_inspector_views_but_cannot_record(api: TestClient, make_employee: MakeEmployee) -> None:
    headers, _ = as_role(api, make_employee, RoleCode.INSPECTOR)

    assert api.get(WASTE).status_code == 200
    assert api.get(PH).status_code == 200
    assert api.get("/api/v1/waste/summary").status_code == 200
    assert api.post(WASTE, json={"category": "spoiled"}, headers=headers).status_code == 403
    assert api.post(PH, json={"sample_description": "x", "ph_value": "5"}, headers=headers).status_code == 403


def test_recording_needs_the_csrf_token(api: TestClient, make_employee: MakeEmployee) -> None:
    as_role(api, make_employee, RoleCode.STOREKEEPER)

    assert api.post(WASTE, json={"category": "spoiled"}).status_code == 403
    assert api.post(PH, json={"sample_description": "x", "ph_value": "5"}).status_code == 403


# --- public contact form ----------------------------------------------------

GOOD = {"name": "Sam Customer", "email": "Sam@Example.test", "message": "Do you do gluten free?"}


def test_enquiry_is_stored_without_echo_or_cookie(api: TestClient, db: Session) -> None:
    response = api.post(ENQ, json=GOOD)

    assert response.status_code == 202
    assert response.json() == {"accepted": True}
    assert "Sam" not in response.text and "gluten" not in response.text
    assert "set-cookie" not in response.headers
    enquiry = db.scalars(select(Enquiry)).one()
    assert (enquiry.name, enquiry.email, enquiry.read_at) == ("Sam Customer", "sam@example.test", None)


def test_enquiry_ignores_the_session_cookie(api: TestClient, make_employee: MakeEmployee, db: Session) -> None:
    as_role(api, make_employee, RoleCode.ADMIN)

    assert api.post(ENQ, json=GOOD).status_code == 202  # no CSRF header needed, none checked
    assert db.scalar(select(func.count()).select_from(Enquiry)) == 1


@pytest.mark.parametrize(
    "change",
    [{"name": "   "}, {"email": "not-an-email"}, {"message": "  "}, {"message": "x" * 5001}, {"name": "n" * 121}],
)
def test_enquiry_validation(api: TestClient, db: Session, change: dict[str, str]) -> None:
    response = api.post(ENQ, json={**GOOD, **change})

    assert response.status_code in (400, 422)
    assert db.scalar(select(func.count()).select_from(Enquiry)) == 0


def test_honeypot_looks_accepted_but_stores_nothing(api: TestClient, db: Session) -> None:
    response = api.post(ENQ, json={**GOOD, "website": "http://spam.test"})

    assert (response.status_code, response.json()) == (202, {"accepted": True})
    assert db.scalar(select(func.count()).select_from(Enquiry)) == 0


def test_enquiry_rate_limit_per_ip(api: TestClient, db: Session) -> None:
    with TestClient(api.app, client=("203.0.113.7", 50000)) as visitor:
        for number in range(5):
            assert visitor.post(ENQ, json={**GOOD, "email": f"p{number}@example.test"}).status_code == 202
        blocked = visitor.post(ENQ, json={**GOOD, "email": "fresh@example.test"})  # same IP, new email

    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    assert blocked.json()["code"] == "too_many_requests"
    assert "fresh@" not in blocked.text
    assert db.scalar(select(func.count()).select_from(Enquiry)) == 5
    with TestClient(api.app, client=("203.0.113.8", 50000)) as other:  # another address is unaffected
        assert other.post(ENQ, json={**GOOD, "email": "fresh@example.test"}).status_code == 202


def test_enquiry_rate_limit_per_email(api: TestClient, db: Session) -> None:
    for number in range(5):
        with TestClient(api.app, client=(f"198.51.100.{number}", 50000)) as visitor:
            assert visitor.post(ENQ, json=GOOD).status_code == 202
    with TestClient(api.app, client=("198.51.100.99", 50000)) as another_address:
        assert another_address.post(ENQ, json={**GOOD, "email": " SAM@example.test "}).status_code == 429
    assert db.scalar(select(func.count()).select_from(Enquiry)) == 5


# --- admin inbox ------------------------------------------------------------


def test_inbox_is_admin_only_paginated_and_marks_read(api: TestClient, make_employee: MakeEmployee, db: Session) -> None:
    for number in range(3):
        api.post(ENQ, json={**GOOD, "email": f"c{number}@example.test", "message": f"Message {number}"})
    keeper_headers, _ = as_role(api, make_employee, RoleCode.STOREKEEPER)
    assert api.get(INBOX).status_code == 403
    inspector_headers, _ = as_role(api, make_employee, RoleCode.INSPECTOR)
    assert api.get(INBOX).status_code == 403
    assert keeper_headers and inspector_headers
    headers, _ = as_role(api, make_employee, RoleCode.ADMIN)

    page = api.get(INBOX, params={"limit": 2}).json()
    assert (page["total"], len(page["items"])) == (3, 2)
    assert page["items"][0]["message"] == "Message 2"  # newest first
    target = page["items"][0]["id"]

    assert api.post(f"{INBOX}/{target}/read").status_code == 403  # CSRF
    first = api.post(f"{INBOX}/{target}/read", headers=headers)
    api.post(f"{INBOX}/{target}/read", headers=headers)  # idempotent, audited once
    assert first.status_code == 200 and first.json()["read_at"] is not None
    assert api.get(INBOX, params={"unread": "true"}).json()["total"] == 2
    assert api.get(INBOX, params={"unread": "false"}).json()["total"] == 1
    assert api.post(f"{INBOX}/{uuid.uuid4()}/read", headers=headers).status_code == 404
    assert actions(db, "enquiry.") == ["enquiry.read"]
    details = db.scalars(select(AuditEvent.details).where(AuditEvent.action == "enquiry.read")).one()
    assert details == {}  # no personal data in the audit trail


# --- audit viewer -----------------------------------------------------------


def test_audit_viewer_roles_filters_and_shape(api: TestClient, make_employee: MakeEmployee) -> None:
    keeper_headers, keeper = as_role(api, make_employee, RoleCode.STOREKEEPER)
    api.post(WASTE, json={"category": "spoiled"}, headers=keeper_headers)
    api.post(PH, json={"sample_description": "x", "ph_value": "5"}, headers=keeper_headers)
    assert api.get(AUDIT).status_code == 403  # storekeepers can't view the audit log

    _, _inspector = as_role(api, make_employee, RoleCode.INSPECTOR)
    everything = api.get(AUDIT).json()
    assert everything["total"] >= 2
    times = [item["occurred_at"] for item in everything["items"]]
    assert times == sorted(times, reverse=True)
    assert all({"ip_address", "user_agent"}.isdisjoint(item) for item in everything["items"])

    waste = api.get(AUDIT, params={"action": "waste.recorded"}).json()
    assert waste["total"] == 1
    assert waste["items"][0]["actor"]["id"] == str(keeper.id)
    assert waste["items"][0]["target_type"] == "waste_record"
    assert api.get(AUDIT, params={"target_type": "ph_record"}).json()["total"] == 1
    assert api.get(AUDIT, params={"actor_id": str(keeper.id)}).json()["total"] >= 2
    assert api.get(AUDIT, params={"actor_id": str(uuid.uuid4())}).json()["total"] == 0
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    assert api.get(AUDIT, params={"date_from": tomorrow}).json()["total"] == 0
    assert api.get(AUDIT, params={"date_to": tomorrow}).json()["total"] == everything["total"]
    assert api.get(AUDIT, params={"limit": 1}).json()["items"].__len__() == 1


def test_audit_viewer_is_open_to_admins(api: TestClient, make_employee: MakeEmployee) -> None:
    as_role(api, make_employee, RoleCode.ADMIN)

    assert api.get(AUDIT).status_code == 200


# --- retention commands -----------------------------------------------------


def run(settings: Settings, *args: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(list(args), settings=settings, stdin=io.StringIO(""), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_purge_enquiries_keeps_recent_messages(auth_settings: Settings, db: Session) -> None:
    now = utcnow()
    for email, age in (("old@example.test", 400), ("recent@example.test", 100)):
        db.add(Enquiry(name="N", email=email, message="m", created_at=now - timedelta(days=age)))
    db.commit()

    code, out, _ = run(auth_settings, "purge-enquiries", "--months", "12")

    assert code == 0 and "Deleted 1" in out
    db.expire_all()
    assert list(db.scalars(select(Enquiry.email))) == ["recent@example.test"]
    assert run(auth_settings, "purge-enquiries", "--months", "0")[0] == 1


def test_purge_readings_chunks_and_keeps_referenced_readings(
    auth_settings: Settings, db: Session, make_employee: MakeEmployee, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.cli as cli

    monkeypatch.setattr(cli, "READINGS_CHUNK", 2)
    owner = make_employee(RoleCode.ADMIN)
    device, _token = device_service.create_device(db, "Station", by=None, actor_type="cli")
    now = utcnow()

    def reading(age_days: int) -> SensorReading:
        item = SensorReading(device_id=device.id, recorded_at=now - timedelta(days=age_days), dht_ok=True, load_cell_ok=True)
        db.add(item)
        db.flush()
        return item

    old = [reading(200) for _ in range(5)]
    reading(1)
    db.add(PhRecord(sample_description="kept", ph_value=5, operator_id=owner.id, sensor_reading_id=old[0].id))
    db.commit()

    code, out, _ = run(auth_settings, "purge-readings", "--days", "90")

    assert code == 0 and "Deleted 4 " in out
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(SensorReading)) == 2  # the recent one and the referenced one
    assert run(auth_settings, "purge-readings", "--days", "0")[0] == 1
