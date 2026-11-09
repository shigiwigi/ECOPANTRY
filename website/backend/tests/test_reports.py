"""Reports (M13): stock, expiry, environment and waste as JSON, CSV and PDF."""

import csv
import io
import os
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.routes.expiry import current_date
from app.auth.permissions import RoleCode
from app.models.alerts import Alert, Threshold
from app.models.audit import AuditEvent
from app.models.auth import Employee
from app.models.devices import Device, SensorReading
from app.models.inventory import Batch, Ingredient, Unit
from app.models.waste import WasteRecord
from app.services import report_files
from app.services import reports as service
from app.services.reports import Report, Section

from .conftest import sign_in

TODAY = date(2026, 11, 10)
D = Decimal
KINDS = ("stock", "expiry", "environment", "waste")
URL = "/api/v1/reports"

MakeEmployee = Callable[..., Employee]


def at(day: date, hour: int = 12) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


@pytest.fixture
def dated(api: TestClient) -> Iterator[None]:
    api.app.dependency_overrides[current_date] = lambda: TODAY  # type: ignore[attr-defined]
    yield
    api.app.dependency_overrides.pop(current_date, None)  # type: ignore[attr-defined]


@pytest.fixture
def admin(api: TestClient, make_employee: MakeEmployee, dated: None) -> Employee:
    employee = make_employee(RoleCode.ADMIN)
    sign_in(api, employee.email)
    return employee


def sign_in_as(api: TestClient, make_employee: MakeEmployee, role: RoleCode) -> None:
    sign_in(api, make_employee(role).email)


@pytest.fixture
def shop(db: Session, admin: Employee) -> dict[str, Any]:
    """Two ingredients, three batches (usable, expiring, expired), two sensor days, waste, alerts."""
    kg = db.scalars(select(Unit).where(Unit.code == "kg")).one()
    flour = Ingredient(name="Flour", unit_id=kg.id, reorder_level=D("5"))
    butter = Ingredient(name="=Butter", unit_id=kg.id)
    db.add_all([flour, butter])
    db.flush()

    def batch(code: str, ing: Ingredient, days: int, remaining: str) -> Batch:
        row = Batch(
            ingredient_id=ing.id,
            label_code=code,
            received_on=TODAY - timedelta(days=30),
            expiry_on=TODAY + timedelta(days=days),
            quantity=D("10"),
            remaining_quantity=D(remaining),
            created_by_id=admin.id,
        )
        db.add(row)
        return row

    fresh = batch("ABCDEFGH01", flour, 30, "4")
    soon = batch("ABCDEFGH02", flour, 3, "2")
    gone = batch("ABCDEFGH03", butter, -2, "1.5")
    batch("ABCDEFGH04", butter, 1, "0")  # depleted: never listed

    station = Device(name="Station A", token_hash=os.urandom(32), token_prefix="abcd")
    db.add(station)
    db.flush()
    for day, hour, temp, hum in [(TODAY - timedelta(1), 9, 4.0, 50.0), (TODAY - timedelta(1), 10, 8.0, 60.0), (TODAY - timedelta(20), 9, 30.0, 90.0)]:
        db.add(
            SensorReading(
                device_id=station.id, recorded_at=at(day, hour), temperature_c=temp, humidity_pct=hum, dht_ok=True, load_cell_ok=True
            )
        )
    # A pH-only reading must never show in reports.
    db.add(SensorReading(device_id=station.id, recorded_at=at(TODAY), ph_value=6.1, dht_ok=False, load_cell_ok=False))

    temp_limit = Threshold(label="Fridge warm", metric="temperature_c", max_value=7.0)
    db.add(temp_limit)
    db.flush()
    weight_limit = db.scalars(select(Threshold).where(Threshold.metric == "weight_g")).first()
    assert weight_limit is not None
    db.add(Alert(threshold_id=temp_limit.id, device_id=station.id, metric="temperature_c", severity="warning", message="Fridge warm: 8.0", trigger_value=8.0, opened_at=at(TODAY - timedelta(1), 10)))
    db.add(Alert(threshold_id=weight_limit.id, device_id=station.id, metric="weight_g", severity="warning", message="Bin nearly full", trigger_value=2100.0, opened_at=at(TODAY - timedelta(2), 10)))

    db.add_all(
        [
            WasteRecord(category="expired", weight_kg=D("1.250"), batch_id=gone.id, employee_id=admin.id, recorded_at=at(TODAY - timedelta(1))),
            WasteRecord(category="expired", weight_kg=D("0.750"), employee_id=admin.id, recorded_at=at(TODAY - timedelta(2))),
            WasteRecord(category="other", reason="=HYPERLINK(\"x\")", employee_id=admin.id, recorded_at=at(TODAY - timedelta(3))),
            WasteRecord(category="spoiled", weight_kg=D("9"), employee_id=admin.id, recorded_at=at(TODAY - timedelta(25))),
        ]
    )
    db.commit()
    return {"fresh": fresh, "soon": soon, "gone": gone}


def parse_csv(response: Any) -> list[list[str]]:
    text = response.content.decode("utf-8")
    assert text.startswith("﻿")
    return list(csv.reader(io.StringIO(text[1:])))


def section(report: dict[str, Any], title: str) -> dict[str, Any]:
    return next(s for s in report["sections"] if s["title"] == title)


# --- content -------------------------------------------------------------------


def test_stock_preview(api: TestClient, shop: dict[str, Any]) -> None:
    report = api.get(f"{URL}/stock").json()
    assert report["kind"] == "stock"
    ingredients = {r[0]: r for r in section(report, "Ingredients")["rows"]}
    # Flour: 4 + 2 usable = 6 > reorder level 5. Butter: only an expired batch is left, so 0 usable.
    assert ingredients["Flour"][3:] == ["6.000", "OK"]
    assert ingredients["=Butter"][3:] == ["0.000", "OK"]
    batches = section(report, "Batches in stock")["rows"]
    assert {r[0] for r in batches} == {"ABCDEFGH01", "ABCDEFGH02", "ABCDEFGH03"}
    assert next(r for r in batches if r[0] == "ABCDEFGH03")[-1] == "Expired"


def test_stock_flags_low_stock(api: TestClient, db: Session, shop: dict[str, Any]) -> None:
    shop["fresh"].remaining_quantity = D("1")
    db.commit()
    rows = {r[0]: r for r in section(api.get(f"{URL}/stock").json(), "Ingredients")["rows"]}
    assert rows["Flour"][3:] == ["3.000", "Low"]


def test_expiry_preview_window(api: TestClient, shop: dict[str, Any]) -> None:
    report = api.get(f"{URL}/expiry").json()
    assert [r[0] for r in section(report, "Expiring within 7 days")["rows"]] == ["ABCDEFGH02"]
    assert [r[0] for r in section(report, "Expired, still in stock")["rows"]] == ["ABCDEFGH03"]
    wide = api.get(f"{URL}/expiry", params={"days": 90}).json()
    assert {r[0] for r in section(wide, "Expiring within 90 days")["rows"]} == {"ABCDEFGH01", "ABCDEFGH02"}
    assert api.get(f"{URL}/expiry", params={"days": 91}).status_code == 422
    assert api.get(f"{URL}/expiry", params={"days": 0}).status_code == 422


def test_environment_aggregates_and_excludes_ph(api: TestClient, shop: dict[str, Any]) -> None:
    report = api.get(f"{URL}/environment").json()  # default: last 7 days
    rows = section(report, "Readings summary")["rows"]
    assert rows == [
        ["Station A", "Temperature (°C)", "2", "4.0", "6.0", "8.0"],
        ["Station A", "Humidity (%RH)", "2", "50.0", "55.0", "60.0"],
    ]
    alerts = section(report, "Alerts opened")["rows"]
    assert [r[2] for r in alerts] == ["temperature_c"]  # the weight alert belongs to the waste report
    assert "6.1" not in str(report)  # the pH sample's value
    assert report["notes"][0].endswith("pH is experimental and is not reported.")


def test_environment_range_picks_up_older_days(api: TestClient, shop: dict[str, Any]) -> None:
    params = {"date_from": (TODAY - timedelta(25)).isoformat(), "date_to": TODAY.isoformat()}
    rows = section(api.get(f"{URL}/environment", params=params).json(), "Readings summary")["rows"]
    assert rows[0][2] == "3"


def test_waste_groups_by_category_within_range(api: TestClient, shop: dict[str, Any]) -> None:
    report = api.get(f"{URL}/waste").json()
    categories = {r[0]: r for r in section(report, "Waste by category")["rows"]}
    assert categories["expired"] == ["expired", "2", "2", "2.000"]
    assert categories["other"] == ["other", "1", "0", "0.000"]
    assert "spoiled" not in categories  # 25 days ago, outside the default 7 days
    assert len(section(report, "Waste records")["rows"]) == 3
    assert [r[2] for r in section(report, "Waste bin weight alerts")["rows"]] == ["weight_g"]


def test_range_is_inclusive_of_both_whole_days(api: TestClient, db: Session, shop: dict[str, Any], admin: Employee) -> None:
    db.add(WasteRecord(category="damaged", employee_id=admin.id, recorded_at=datetime(2026, 11, 4, 23, 59, tzinfo=UTC)))
    db.add(WasteRecord(category="damaged", employee_id=admin.id, recorded_at=datetime(2026, 11, 5, 0, 0, tzinfo=UTC)))
    db.commit()
    params = {"date_from": "2026-11-04", "date_to": "2026-11-04"}
    rows = section(api.get(f"{URL}/waste", params=params).json(), "Waste records")["rows"]
    assert [r[0] for r in rows] == ["2026-11-04 23:59"]


# --- validation ----------------------------------------------------------------


@pytest.mark.parametrize("kind", ["environment", "waste"])
def test_range_validation(api: TestClient, admin: Employee, kind: str) -> None:
    reversed_ = api.get(f"{URL}/{kind}", params={"date_from": "2026-11-10", "date_to": "2026-11-01"})
    assert reversed_.status_code == 422 and reversed_.json()["code"] == "validation_error"
    too_long = api.get(f"{URL}/{kind}", params={"date_from": "2026-10-01", "date_to": "2026-11-10"})
    assert too_long.status_code == 422
    exactly_31 = api.get(f"{URL}/{kind}", params={"date_from": "2026-10-11", "date_to": "2026-11-10"})
    assert exactly_31.status_code == 200
    assert api.get(f"{URL}/{kind}", params={"date_from": "nope"}).status_code == 422
    assert api.get(f"{URL}/{kind}", params={"date_from": "2026-10-01", "date_to": "2026-11-10", "format": "csv"}).status_code == 422


def test_unknown_kind_and_format_are_rejected(api: TestClient, admin: Employee) -> None:
    assert api.get(f"{URL}/payroll").status_code == 422
    assert api.get(f"{URL}/stock", params={"format": "xml"}).status_code == 422


# --- files ---------------------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
def test_csv_download(api: TestClient, shop: dict[str, Any], kind: str, db: Session) -> None:
    response = api.get(f"{URL}/{kind}", params={"format": "csv"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == f'attachment; filename="ecopantry-{kind}-2026-11-10.csv"'
    assert response.headers["cache-control"] == "no-store"
    rows = parse_csv(response)
    assert rows[0][0].lower().startswith(kind)
    assert any(r and r[0] == "Note" and "not a certified food-safety system" in r[1] for r in rows)
    flat = [cell for r in rows for cell in r]
    if kind == "stock":
        assert "ABCDEFGH01" in flat and "Flour" in flat
    if kind == "expiry":
        assert "ABCDEFGH02" in flat and "ABCDEFGH01" not in flat
    if kind == "environment":
        assert "Station A" in flat and "6.0" in flat
    if kind == "waste":
        assert "expired" in flat and "1.250" in flat


@pytest.mark.parametrize("kind", KINDS)
def test_pdf_download(api: TestClient, shop: dict[str, Any], kind: str) -> None:
    response = api.get(f"{URL}/{kind}", params={"format": "pdf"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == f'attachment; filename="ecopantry-{kind}-2026-11-10.pdf"'
    assert response.content.startswith(b"%PDF") and len(response.content) > 1500


def test_empty_database_still_renders(api: TestClient, admin: Employee) -> None:
    for kind in KINDS:
        assert api.get(f"{URL}/{kind}").status_code == 200
        assert api.get(f"{URL}/{kind}", params={"format": "pdf"}).content.startswith(b"%PDF")


def test_csv_neutralises_formulas(api: TestClient, shop: dict[str, Any]) -> None:
    flat = [cell for r in parse_csv(api.get(f"{URL}/stock", params={"format": "csv"})) for cell in r]
    assert "'=Butter" in flat and "=Butter" not in flat
    waste = parse_csv(api.get(f"{URL}/waste", params={"format": "csv"}))
    assert any(cell == "'=HYPERLINK(\"x\")" for r in waste for cell in r)


def test_safe_cell_keeps_plain_numbers_and_quotes_formulas() -> None:
    assert report_files.safe_cell("-3.5") == "-3.5"
    assert report_files.safe_cell("+7") == "+7"
    for dangerous in ("=1+1", "+cmd|x", "-1+2", "@SUM(A1)", "\t=1", "-"):
        assert report_files.safe_cell(dangerous) == "'" + dangerous
    assert report_files.safe_cell("Flour") == "Flour"


def test_truncation_is_flagged_in_every_format(
    api: TestClient, shop: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "MAX_ROWS", 2)
    report = api.get(f"{URL}/stock").json()
    batches = section(report, "Batches in stock")
    assert len(batches["rows"]) == 2 and batches["total_rows"] == 3 and batches["truncated"] is True
    assert any("Truncated" in n and "2 of 3" in n for n in report["notes"])
    assert not section(report, "Ingredients")["truncated"]  # exactly 2 ingredients fit
    csv_rows = parse_csv(api.get(f"{URL}/stock", params={"format": "csv"}))
    assert any(r[0] == "Note" and "Truncated" in r[1] for r in csv_rows)


def test_pdf_paginates_many_rows() -> None:
    rows = [[f"Row {i}", "x"] for i in range(400)]
    report = Report("stock", "Big", datetime(2026, 11, 10, tzinfo=UTC), [], [Section("T", ["A", "B"], rows, 400)], [])
    pdf = report_files.to_pdf(report)
    assert pdf.count(b"/Type /Page\n") + pdf.count(b"/Type /Page ") >= 3


# --- access and audit ----------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
def test_a_session_is_required(api: TestClient, kind: str) -> None:
    assert api.get(f"{URL}/{kind}").status_code == 401
    assert api.get(f"{URL}/{kind}", params={"format": "csv"}).status_code == 401


@pytest.mark.parametrize("format", ["json", "csv", "pdf"])
def test_inspector_may_view_and_export(api: TestClient, make_employee: MakeEmployee, dated: None, format: str) -> None:
    sign_in_as(api, make_employee, RoleCode.INSPECTOR)  # the seed gives inspectors reports.view and reports.export
    assert api.get(f"{URL}/stock", params={"format": format}).status_code == 200


@pytest.mark.parametrize("format", ["json", "csv", "pdf"])
def test_storekeeper_has_no_reports_access(api: TestClient, make_employee: MakeEmployee, dated: None, format: str) -> None:
    sign_in_as(api, make_employee, RoleCode.STOREKEEPER)  # the seed gives storekeepers neither permission
    assert api.get(f"{URL}/stock", params={"format": format}).status_code == 403


def test_exports_are_audited_without_personal_data(api: TestClient, db: Session, admin: Employee, shop: dict[str, Any]) -> None:
    api.get(f"{URL}/waste", params={"format": "csv", "date_from": "2026-11-01", "date_to": "2026-11-10"})
    api.get(f"{URL}/expiry", params={"format": "pdf", "days": 14})
    api.get(f"{URL}/stock")  # a preview is not an export
    db.expire_all()
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.action == "report.exported").order_by(AuditEvent.id)))
    assert [e.details for e in events] == [
        {"kind": "waste", "format": "csv", "date_from": "2026-11-01", "date_to": "2026-11-10"},
        {"kind": "expiry", "format": "pdf", "days": 14},
    ]
    assert all(e.actor_employee_id == admin.id for e in events)


def test_a_refused_export_writes_no_audit_event(api: TestClient, db: Session, make_employee: MakeEmployee, dated: None) -> None:
    before = len(list(db.scalars(select(AuditEvent).where(AuditEvent.action == "report.exported"))))
    sign_in_as(api, make_employee, RoleCode.STOREKEEPER)
    assert api.get(f"{URL}/stock", params={"format": "csv"}).status_code == 403
    db.expire_all()
    assert len(list(db.scalars(select(AuditEvent).where(AuditEvent.action == "report.exported")))) == before
