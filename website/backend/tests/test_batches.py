"""Batches, stock movements, low-stock status and label lookup (M6)."""

import threading
from collections.abc import Callable
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.permissions import RoleCode
from app.models.audit import AuditEvent
from app.models.auth import Employee
from app.models.inventory import Batch, StockMovement
from app.services import batches as service
from app.services.audit import ClientInfo
from app.services.batch_labels import is_valid_code

from .conftest import sign_in
from .test_inventory import add_area, add_ingredient

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
BATCHES = "/api/v1/batches"
INGREDIENTS = "/api/v1/ingredients"
TODAY = date.today()


@pytest.fixture
def keeper(api: TestClient, make_employee: MakeEmployee) -> dict[str, str]:
    return {"X-CSRF-Token": sign_in(api, make_employee(RoleCode.STOREKEEPER).email)}


def receive(api: TestClient, headers: dict[str, str], ingredient_id: str, **fields: Any) -> dict[str, Any]:
    body = {"ingredient_id": ingredient_id, "quantity": "10", "expiry_on": str(TODAY + timedelta(days=30)), **fields}
    response = api.post(BATCHES, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return dict(response.json())


def events(db: Session, action: str) -> list[AuditEvent]:
    db.expire_all()
    return list(db.scalars(select(AuditEvent).where(AuditEvent.action == action).order_by(AuditEvent.id)))


# --- receiving --------------------------------------------------------------


def test_receive_creates_batch_label_movement_and_audit(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    ingredient = add_ingredient(api, keeper)
    area = add_area(api, keeper)

    batch = receive(api, keeper, ingredient["id"], storage_area_id=area["id"], quantity="12.5", notes="  Pallet 3 ")

    assert is_valid_code(batch["label_code"])
    assert batch["quantity"] == "12.500" and batch["remaining_quantity"] == "12.500"
    assert batch["status"] == "available"
    assert batch["received_on"] == str(TODAY)
    assert batch["notes"] == "Pallet 3"
    assert batch["ingredient"] == {"id": ingredient["id"], "name": "Wheat flour", "unit": "kg"}
    assert batch["storage_area"] == {"id": area["id"], "name": "Walk-in fridge"}
    [movement] = batch["movements"]
    assert (movement["kind"], movement["quantity_delta"], movement["remaining_after"]) == ("in", "12.500", "12.500")
    [event] = events(db, "inventory.batch_received")
    assert (event.target_type, event.target_id) == ("batch", batch["id"])
    assert event.details["quantity"] == "12.500"
    assert api.get(f"{BATCHES}/{batch['id']}").json() == batch


def test_each_batch_gets_its_own_label_code(api: TestClient, keeper: dict[str, str]) -> None:
    ingredient = add_ingredient(api, keeper)

    codes = {receive(api, keeper, ingredient["id"])["label_code"] for _ in range(5)}

    assert len(codes) == 5


@pytest.mark.parametrize(
    ("fields", "status", "code"),
    [
        ({"quantity": "0"}, 422, "validation_error"),
        ({"quantity": "-1"}, 422, "validation_error"),
        ({"quantity": "1.2345"}, 422, "validation_error"),
        ({"expiry_on": str(TODAY - timedelta(days=1))}, 400, "expiry_before_received"),
        ({"ingredient_id": "00000000-0000-4000-8000-000000000000"}, 404, "not_found"),
        ({"storage_area_id": "00000000-0000-4000-8000-000000000000"}, 404, "not_found"),
    ],
)
def test_invalid_receipts_are_refused(
    api: TestClient, keeper: dict[str, str], db: Session, fields: dict[str, Any], status: int, code: str
) -> None:
    ingredient = add_ingredient(api, keeper)
    body = {"ingredient_id": ingredient["id"], "quantity": "5", "expiry_on": str(TODAY + timedelta(days=5)), **fields}

    response = api.post(BATCHES, json=body, headers=keeper)

    assert response.status_code == status, response.text
    assert response.json()["code"] == code
    assert db.scalar(select(Batch.id)) is None


def test_deactivated_ingredient_cannot_be_received(api: TestClient, keeper: dict[str, str]) -> None:
    ingredient = add_ingredient(api, keeper)
    api.post(f"{INGREDIENTS}/{ingredient['id']}/deactivate", headers=keeper)

    response = api.post(
        BATCHES,
        json={"ingredient_id": ingredient["id"], "quantity": "1", "expiry_on": str(TODAY + timedelta(days=5))},
        headers=keeper,
    )

    assert response.status_code == 400
    assert response.json()["code"] == "ingredient_inactive"


# --- consuming and adjusting ------------------------------------------------


def test_consume_writes_movement_attribution_and_audit(
    api: TestClient, make_employee: MakeEmployee, db: Session
) -> None:
    employee = make_employee(RoleCode.STOREKEEPER)
    headers = {"X-CSRF-Token": sign_in(api, employee.email)}
    batch = receive(api, headers, add_ingredient(api, headers)["id"])

    response = api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": "3.250", "reason": "Morning bake"}, headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["remaining_quantity"] == "6.750"
    out, received = body["movements"]
    assert (out["kind"], out["quantity_delta"], out["remaining_after"], out["reason"]) == (
        "out", "-3.250", "6.750", "Morning bake",
    )  # fmt: skip
    assert out["employee_name"] == employee.full_name
    assert received["kind"] == "in"
    [event] = events(db, "inventory.stock_consumed")
    assert event.actor_employee_id == employee.id
    assert event.details["delta"] == "-3.250" and event.details["remaining_after"] == "6.750"


def test_consuming_everything_depletes_and_more_is_refused(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"], quantity="4")

    over = api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": "4.001"}, headers=keeper)
    exact = api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": "4"}, headers=keeper)
    again = api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": "0.001"}, headers=keeper)

    assert over.status_code == 409 and over.json()["code"] == "insufficient_stock"
    assert exact.status_code == 200 and exact.json()["status"] == "depleted"
    assert exact.json()["remaining_quantity"] == "0.000"
    assert again.status_code == 409 and again.json()["code"] == "insufficient_stock"
    assert len(events(db, "inventory.stock_consumed")) == 1
    assert db.scalar(select(Batch.remaining_quantity)) == Decimal("0")


@pytest.mark.parametrize("quantity", ["0", "-1", "abc"])
def test_consume_needs_a_positive_quantity(api: TestClient, keeper: dict[str, str], quantity: str) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"])

    response = api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": quantity}, headers=keeper)

    assert response.status_code == 422


def test_adjust_requires_a_reason_and_is_audited(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"], quantity="10")
    url = f"{BATCHES}/{batch['id']}/adjust"

    no_reason = api.post(url, json={"delta": "-1"}, headers=keeper)
    blank = api.post(url, json={"delta": "-1", "reason": "   "}, headers=keeper)
    zero = api.post(url, json={"delta": "0", "reason": "Recount"}, headers=keeper)
    ok = api.post(url, json={"delta": "-2.5", "reason": "Spilled"}, headers=keeper)

    assert no_reason.status_code == 422
    assert blank.status_code == 400 and blank.json()["code"] == "reason_required"
    assert zero.status_code == 400 and zero.json()["code"] == "zero_adjustment"
    assert ok.status_code == 200
    assert ok.json()["remaining_quantity"] == "7.500"
    assert ok.json()["movements"][0]["kind"] == "adjust"
    [event] = events(db, "inventory.stock_adjusted")
    assert event.details["reason"] == "Spilled"


def test_adjust_cannot_go_below_zero_or_above_the_received_quantity(api: TestClient, keeper: dict[str, str]) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"], quantity="10")
    url = f"{BATCHES}/{batch['id']}/adjust"

    below = api.post(url, json={"delta": "-10.001", "reason": "Recount"}, headers=keeper)
    above = api.post(url, json={"delta": "0.001", "reason": "Recount"}, headers=keeper)

    assert below.status_code == 409 and below.json()["code"] == "insufficient_stock"
    assert above.status_code == 409 and above.json()["code"] == "exceeds_received_quantity"
    assert api.get(f"{BATCHES}/{batch['id']}").json()["remaining_quantity"] == "10.000"


def test_the_ledger_always_adds_up_to_the_remaining_quantity(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"], quantity="10")
    api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": "3"}, headers=keeper)
    api.post(f"{BATCHES}/{batch['id']}/adjust", json={"delta": "-1.5", "reason": "Dropped"}, headers=keeper)
    api.post(f"{BATCHES}/{batch['id']}/adjust", json={"delta": "0.5", "reason": "Found"}, headers=keeper)

    db.expire_all()
    stored = db.scalars(select(Batch)).one()
    total = sum(m.quantity_delta for m in db.scalars(select(StockMovement)))
    assert total == stored.remaining_quantity == Decimal("6.000")


def test_concurrent_consumption_never_oversells(api: TestClient, make_employee: MakeEmployee, db: Session) -> None:
    employee = make_employee(RoleCode.STOREKEEPER)
    headers = {"X-CSRF-Token": sign_in(api, employee.email)}
    batch = receive(api, headers, add_ingredient(api, headers)["id"], quantity="10")
    factory = sessionmaker(bind=db.get_bind())
    results: list[str] = []

    def worker() -> None:
        with factory() as session:
            try:
                actor = session.get(Employee, employee.id)
                assert actor is not None
                service.consume(session, batch["id"], Decimal("4"), reason=None, by=actor, client=ClientInfo())
                session.commit()
                results.append("ok")
            except service.InsufficientStockError:
                session.rollback()
                results.append("refused")

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results) == ["ok", "ok", "refused", "refused", "refused"]
    db.expire_all()
    assert db.scalars(select(Batch.remaining_quantity)).one() == Decimal("2")


# --- listing ----------------------------------------------------------------


def test_list_filters_search_and_fefo_order(api: TestClient, keeper: dict[str, str]) -> None:
    flour = add_ingredient(api, keeper, name="Flour")
    butter = add_ingredient(api, keeper, name="Butter", unit="g")
    fridge = add_area(api, keeper)
    late = receive(api, keeper, flour["id"], expiry_on=str(TODAY + timedelta(days=40)))
    soon = receive(api, keeper, flour["id"], expiry_on=str(TODAY + timedelta(days=3)), storage_area_id=fridge["id"])
    used = receive(api, keeper, butter["id"], quantity="2", expiry_on=str(TODAY + timedelta(days=20)))
    api.post(f"{BATCHES}/{used['id']}/consume", json={"quantity": "2"}, headers=keeper)

    def ids(**params: Any) -> list[str]:
        response = api.get(BATCHES, params=params)
        assert response.status_code == 200, response.text
        return [b["id"] for b in response.json()["items"]]

    assert ids() == [soon["id"], used["id"], late["id"]]
    assert api.get(BATCHES).json()["total"] == 3
    assert ids(ingredient_id=flour["id"]) == [soon["id"], late["id"]]
    assert ids(storage_area_id=fridge["id"]) == [soon["id"]]
    assert ids(has_stock="true") == [soon["id"], late["id"]]
    assert ids(has_stock="false") == [used["id"]]
    assert ids(status="near_expiry") == [soon["id"]]
    assert ids(status="depleted") == [used["id"]]
    assert ids(status="available") == [late["id"]]
    assert ids(status="expired") == []
    assert ids(q="butt") == [used["id"]]
    assert ids(q=soon["label_code"]) == [soon["id"]]
    assert ids(sort="-expiry_on", limit=1) == [late["id"]]
    assert api.get(BATCHES, params={"status": "bogus"}).status_code == 422


def test_expired_status_is_derived_from_the_date(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"])
    row = db.get(Batch, batch["id"])
    assert row is not None
    row.received_on = TODAY - timedelta(days=20)
    row.expiry_on = TODAY - timedelta(days=1)
    db.commit()

    assert api.get(f"{BATCHES}/{batch['id']}").json()["status"] == "expired"
    assert [b["id"] for b in api.get(BATCHES, params={"status": "expired"}).json()["items"]] == [batch["id"]]


# --- low stock --------------------------------------------------------------


def test_ingredient_low_stock_follows_the_reorder_level(api: TestClient, keeper: dict[str, str]) -> None:
    flour = add_ingredient(api, keeper, reorder_level="10")
    plain = add_ingredient(api, keeper, name="Salt")
    assert api.get(f"{INGREDIENTS}/{flour['id']}").json()["low_stock"] is True  # nothing in stock yet

    first = receive(api, keeper, flour["id"], quantity="6")
    after_first = api.get(f"{INGREDIENTS}/{flour['id']}").json()
    receive(api, keeper, flour["id"], quantity="5")
    after_second = api.get(f"{INGREDIENTS}/{flour['id']}").json()
    api.post(f"{BATCHES}/{first['id']}/consume", json={"quantity": "1.5"}, headers=keeper)
    listed = {i["id"]: i for i in api.get(INGREDIENTS).json()["items"]}

    assert (after_first["total_remaining"], after_first["low_stock"]) == ("6.000", True)
    assert (after_second["total_remaining"], after_second["low_stock"]) == ("11.000", False)
    assert (listed[flour["id"]]["total_remaining"], listed[flour["id"]]["low_stock"]) == ("9.500", True)
    assert listed[plain["id"]]["low_stock"] is False  # no reorder level: never low


def test_exactly_at_the_reorder_level_is_low(api: TestClient, keeper: dict[str, str]) -> None:
    flour = add_ingredient(api, keeper, reorder_level="5")
    receive(api, keeper, flour["id"], quantity="5")

    assert api.get(f"{INGREDIENTS}/{flour['id']}").json()["low_stock"] is True


# --- label lookup -----------------------------------------------------------


def test_lookup_by_label_returns_the_batch_without_changing_it(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    area = add_area(api, keeper, name="Dry store", kind="shelf")
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"], storage_area_id=area["id"])
    before = (len(list(db.scalars(select(StockMovement)))), len(list(db.scalars(select(AuditEvent)))))

    response = api.get(f"{BATCHES}/by-label/{batch['label_code']}")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "batch_id": batch["id"], "code": batch["label_code"], "ingredient_name": "Wheat flour",
        "received_on": str(TODAY), "expires_on": batch["expiry_on"], "status": "in_stock",
        "remaining_quantity": "10.000", "unit": "kg", "storage_location": "Dry store",
    }  # fmt: skip
    db.expire_all()
    assert before == (len(list(db.scalars(select(StockMovement)))), len(list(db.scalars(select(AuditEvent)))))


def test_lookup_reports_used_up_batches(api: TestClient, keeper: dict[str, str]) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"], quantity="1")
    api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": "1"}, headers=keeper)

    assert api.get(f"{BATCHES}/by-label/{batch['label_code']}").json()["status"] == "used_up"


def test_lookup_unknown_code_is_404_and_bad_format_is_422(api: TestClient, keeper: dict[str, str]) -> None:
    unknown = api.get(f"{BATCHES}/by-label/ABCDEFGHJK")
    malformed = api.get(f"{BATCHES}/by-label/not-a-code")

    assert unknown.status_code == 404 and unknown.json()["code"] == "batch_not_found"
    assert "ABCDEFGHJK" not in unknown.text
    assert malformed.status_code == 422


# --- permissions ------------------------------------------------------------


def test_inspector_can_read_but_not_change_stock(api: TestClient, make_employee: MakeEmployee) -> None:
    keeper_headers = {"X-CSRF-Token": sign_in(api, make_employee(RoleCode.STOREKEEPER).email)}
    batch = receive(api, keeper_headers, add_ingredient(api, keeper_headers)["id"])
    inspector = {"X-CSRF-Token": sign_in(api, make_employee(RoleCode.INSPECTOR).email)}

    assert api.get(BATCHES).status_code == 200
    assert api.get(f"{BATCHES}/{batch['id']}").status_code == 200
    assert api.get(f"{BATCHES}/by-label/{batch['label_code']}").status_code == 200
    writes = [
        (BATCHES, {"ingredient_id": batch["ingredient"]["id"], "quantity": "1", "expiry_on": str(TODAY)}),
        (f"{BATCHES}/{batch['id']}/consume", {"quantity": "1"}),
        (f"{BATCHES}/{batch['id']}/adjust", {"delta": "-1", "reason": "x"}),
    ]
    for url, body in writes:
        response = api.post(url, json=body, headers=inspector)
        assert response.status_code == 403, url
    assert api.get(f"{BATCHES}/{batch['id']}").json()["remaining_quantity"] == "10.000"


def test_changes_need_the_csrf_token(api: TestClient, keeper: dict[str, str]) -> None:
    batch = receive(api, keeper, add_ingredient(api, keeper)["id"])

    response = api.post(f"{BATCHES}/{batch['id']}/consume", json={"quantity": "1"})

    assert response.status_code == 403
    assert api.get(f"{BATCHES}/{batch['id']}").json()["remaining_quantity"] == "10.000"


def test_unknown_batch_is_404(api: TestClient, keeper: dict[str, str]) -> None:
    missing = "00000000-0000-4000-8000-000000000000"

    assert api.get(f"{BATCHES}/{missing}").status_code == 404
    assert api.post(f"{BATCHES}/{missing}/consume", json={"quantity": "1"}, headers=keeper).status_code == 404
