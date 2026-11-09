"""GET /dashboard/summary: counts from seeded rows, per-role masking, protection."""

from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from itertools import count

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.routes.expiry import current_date
from app.auth.permissions import RoleCode
from app.models.alerts import Alert, Threshold
from app.models.auth import Employee
from app.models.devices import Device
from app.models.inventory import Batch, Ingredient, Unit

from .conftest import sign_in

TODAY = date(2026, 11, 10)
URL = "/api/v1/dashboard/summary"
D = Decimal
LABELS = count(1)

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]


@pytest.fixture(autouse=True)
def dated(api: TestClient) -> Iterator[None]:
    api.app.dependency_overrides[current_date] = lambda: TODAY  # type: ignore[attr-defined]
    yield
    api.app.dependency_overrides.pop(current_date, None)  # type: ignore[attr-defined]


def ingredient(db: Session, name: str, reorder: str | None, *, active: bool = True) -> Ingredient:
    unit = db.scalars(select(Unit).where(Unit.code == "kg")).one()
    row = Ingredient(name=name, unit_id=unit.id, reorder_level=D(reorder) if reorder is not None else None, is_active=active)
    if not active:
        row.deactivated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    return row


def batch(db: Session, owner: Employee, ing: Ingredient, days: int, remaining: str) -> None:
    db.add(
        Batch(
            ingredient_id=ing.id,
            label_code=f"DASHBRD{next(LABELS):03d}",
            received_on=TODAY - timedelta(days=20),
            expiry_on=TODAY + timedelta(days=days),
            quantity=max(D("10"), D(remaining)),
            remaining_quantity=D(remaining),
            created_by_id=owner.id,
        )
    )
    db.commit()


def device(db: Session, name: str) -> Device:
    row = Device(name=name, token_hash=name.encode().ljust(32, b"x"), token_prefix=name[:8])
    db.add(row)
    db.commit()
    return row


def make_alert(
    db: Session, dev: Device, threshold: Threshold, metric: str, severity: str, status: str, minutes: int = 1
) -> None:
    now = datetime.now(timezone.utc)
    db.add(
        Alert(
            threshold_id=threshold.id,
            device_id=dev.id,
            metric=metric,
            severity=severity,
            message="x",
            status=status,
            trigger_value=2100.0,
            last_value=2100.0,
            opened_at=now - timedelta(minutes=minutes),
            acknowledged_at=now if status == "acknowledged" else None,
            acknowledged_by_id=db.scalars(select(Employee.id)).first() if status == "acknowledged" else None,
            resolved_at=now if status == "resolved" else None,
        )
    )
    db.commit()


def test_needs_a_session(api: TestClient) -> None:
    assert api.get(URL).status_code == 401


def test_an_empty_database_is_all_zeros(api: TestClient, make_employee: MakeEmployee) -> None:
    sign_in(api, make_employee(RoleCode.ADMIN).email)

    body = api.get(URL).json()

    assert body["low_stock_ingredients"] == 0 and body["near_expiry_batches"] == 0 and body["expired_batches"] == 0
    assert body["open_alerts"] == 0 and body["acknowledged_alerts"] == 0 and body["top_alert"] is None
    assert body["active_staff"] == 1  # the signed-in administrator
    assert body["today"] == "2026-11-10" and body["server_time"] and body["expiry_window_days"] == 7


def test_counts_from_seeded_data(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    admin = make_employee(RoleCode.ADMIN)
    make_employee(RoleCode.STOREKEEPER)
    make_employee(RoleCode.INSPECTOR, active=False)
    flour = ingredient(db, "Flour", "5")  # 3 usable (+100 expired, which doesn't count): low
    butter = ingredient(db, "Butter", "5")  # 10 usable: fine
    ingredient(db, "Salt", None)  # no level: never low
    sugar = ingredient(db, "Sugar", "5", active=False)  # inactive: ignored
    ingredient(db, "Yeast", "0")  # no stock, level 0: low (0 <= 0), as in the ingredients list
    batch(db, admin, flour, 3, "3")
    batch(db, admin, flour, -2, "100")
    batch(db, admin, butter, 1, "9")
    batch(db, admin, butter, 7, "1")  # last day of the window
    batch(db, admin, butter, 8, "1")  # outside the window
    batch(db, admin, butter, 2, "0")  # depleted
    batch(db, admin, sugar, -1, "1")
    sign_in(api, admin.email)

    body = api.get(URL).json()

    assert body["low_stock_ingredients"] == 2
    assert body["near_expiry_batches"] == 3
    assert body["expired_batches"] == 2
    assert body["active_staff"] == 2


def test_alert_counts_and_the_most_urgent_open_alert(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    admin = make_employee(RoleCode.ADMIN)
    bin_threshold = db.scalars(select(Threshold)).one()
    temperature = Threshold(label="Fridge too warm", metric="temperature_c", max_value=8.0, severity="warning")
    humidity = Threshold(label="Room too damp", metric="humidity_pct", max_value=70.0, severity="warning")
    db.add_all([temperature, humidity])
    db.commit()
    stations = [device(db, f"Station {i}") for i in range(1, 5)]
    # Same severity: the waste bin wins even though the humidity alert is newer.
    make_alert(db, stations[0], humidity, "humidity_pct", "warning", "open", 1)
    make_alert(db, stations[1], bin_threshold, "weight_g", "warning", "open", 30)
    make_alert(db, stations[2], temperature, "temperature_c", "warning", "acknowledged", 5)
    sign_in(api, admin.email)

    body = api.get(URL).json()

    assert (body["open_alerts"], body["acknowledged_alerts"]) == (2, 1)
    assert body["top_alert"]["label"] == "Waste bin nearly full"
    assert body["top_alert"]["metric"] == "weight_g" and body["top_alert"]["value"] == 2100.0

    # A critical alert outranks the waste bin.
    make_alert(db, stations[3], temperature, "temperature_c", "critical", "open", 2)
    assert api.get(URL).json()["top_alert"]["label"] == "Fridge too warm"


def test_resolved_alerts_are_not_counted(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    admin = make_employee(RoleCode.ADMIN)
    make_alert(db, device(db, "Station"), db.scalars(select(Threshold)).one(), "weight_g", "warning", "resolved")
    sign_in(api, admin.email)

    body = api.get(URL).json()

    assert body["open_alerts"] == 0 and body["acknowledged_alerts"] == 0 and body["top_alert"] is None


@pytest.mark.parametrize(
    ("role", "hidden"),
    [
        (RoleCode.ADMIN, set()),
        (RoleCode.STOREKEEPER, {"active_staff"}),  # employees.view is administrators and inspectors
        (RoleCode.INSPECTOR, set()),
    ],
)
def test_figures_follow_the_roles_permissions(
    api: TestClient, make_employee: MakeEmployee, role: RoleCode, hidden: set[str]
) -> None:
    sign_in(api, make_employee(role).email)

    body = api.get(URL).json()

    figures = ["low_stock_ingredients", "near_expiry_batches", "expired_batches", "open_alerts", "acknowledged_alerts", "active_staff"]
    for name in figures:
        assert (body[name] is None) == (name in hidden), name


def test_masked_figures_stay_null_even_when_data_exists(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    owner = make_employee(RoleCode.ADMIN)
    batch(db, owner, ingredient(db, "Flour", "5"), 1, "1")
    sign_in(api, make_employee(RoleCode.STOREKEEPER).email)

    body = api.get(URL).json()

    assert body["active_staff"] is None
    assert body["near_expiry_batches"] == 1
