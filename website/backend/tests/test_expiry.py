"""Expiry lists and FEFO (M7). Batches are inserted directly; no batch endpoints are needed."""

import uuid
from collections.abc import Callable, Iterator
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.routes.expiry import current_date
from app.auth.permissions import RoleCode
from app.models.auth import Employee
from app.models.inventory import Batch, Ingredient, StorageArea, Unit
from app.services.expiry import FefoBatch, fefo_plan

from .conftest import sign_in

TODAY = date(2026, 11, 10)
D = Decimal


def fb(code: str, expiry: date, remaining: str, received: date = date(2026, 10, 1), id: uuid.UUID | None = None) -> FefoBatch:
    return FefoBatch(id or uuid.uuid4(), code, received, expiry, D(remaining))


# --- pure FEFO ----------------------------------------------------------------


def test_orders_by_earliest_expiry() -> None:
    a, b, c = fb("A", TODAY + timedelta(5), "1"), fb("B", TODAY + timedelta(1), "1"), fb("C", TODAY + timedelta(3), "1")
    assert [x.label_code for x in fefo_plan([a, b, c], today=TODAY).usable] == ["B", "C", "A"]


def test_equal_expiry_uses_older_received_then_id() -> None:
    low, high = uuid.UUID(int=1), uuid.UUID(int=2)
    newer = fb("N", TODAY + timedelta(2), "1", received=date(2026, 11, 5))
    older = fb("O", TODAY + timedelta(2), "1", received=date(2026, 11, 1))
    tie_high = fb("H", TODAY + timedelta(2), "1", received=date(2026, 11, 1), id=high)
    tie_low = fb("L", TODAY + timedelta(2), "1", received=date(2026, 11, 1), id=low)
    result = fefo_plan([newer, tie_high, tie_low], today=TODAY).usable
    assert [x.label_code for x in result] == ["L", "H", "N"]
    assert fefo_plan([tie_low, tie_high, newer, older], today=TODAY).usable[-1].label_code == "N"


def test_expired_are_excluded_and_reported_separately() -> None:
    gone, fine = fb("G", TODAY - timedelta(1), "2"), fb("F", TODAY + timedelta(1), "2")
    plan = fefo_plan([gone, fine], today=TODAY)
    assert [x.label_code for x in plan.usable] == ["F"]
    assert [x.label_code for x in plan.expired] == ["G"]


def test_expiry_today_is_still_usable() -> None:
    plan = fefo_plan([fb("T", TODAY, "1")], today=TODAY)
    assert [x.label_code for x in plan.usable] == ["T"]
    assert plan.expired == []


def test_zero_remaining_is_excluded_everywhere() -> None:
    plan = fefo_plan([fb("Z", TODAY + timedelta(1), "0"), fb("Y", TODAY - timedelta(1), "0")], today=TODAY)
    assert plan.usable == [] and plan.expired == []


def test_no_batches() -> None:
    plan = fefo_plan([], today=TODAY, quantity=D("3"))
    assert plan.usable == [] and plan.pick == []
    assert plan.allocated == 0 and plan.shortfall == 3 and plan.sufficient is False


def test_no_quantity_means_no_pick() -> None:
    plan = fefo_plan([fb("A", TODAY, "1")], today=TODAY)
    assert plan.requested is None and plan.shortfall is None and plan.sufficient is None


def test_pick_spans_batches_in_fefo_order_with_partial_remaining() -> None:
    first, second, third = fb("A", TODAY + timedelta(1), "1.250"), fb("B", TODAY + timedelta(2), "2"), fb("C", TODAY + timedelta(3), "5")
    plan = fefo_plan([third, second, first], today=TODAY, quantity=D("2.500"))
    assert [(p.batch.label_code, p.take) for p in plan.pick] == [("A", D("1.250")), ("B", D("1.250"))]
    assert plan.allocated == D("2.500") and plan.shortfall == 0 and plan.sufficient is True


def test_exact_amount_stops_at_the_batch_that_covers_it() -> None:
    plan = fefo_plan([fb("A", TODAY, "2"), fb("B", TODAY + timedelta(1), "2")], today=TODAY, quantity=D("2"))
    assert [p.batch.label_code for p in plan.pick] == ["A"]


def test_insufficient_stock_ignores_expired_batches() -> None:
    plan = fefo_plan(
        [fb("A", TODAY + timedelta(1), "1"), fb("G", TODAY - timedelta(1), "10")], today=TODAY, quantity=D("4")
    )
    assert plan.allocated == 1 and plan.shortfall == 3 and plan.sufficient is False
    assert [p.take for p in plan.pick] == [D("1")]


# --- API ----------------------------------------------------------------------


MakeEmployee = Callable[..., Employee]


@pytest.fixture(autouse=False)
def dated(api: TestClient) -> Iterator[None]:
    api.app.dependency_overrides[current_date] = lambda: TODAY  # type: ignore[attr-defined]
    yield
    api.app.dependency_overrides.pop(current_date, None)  # type: ignore[attr-defined]


class Shop:
    def __init__(self, db: Session, owner: Employee) -> None:
        self.db, self.owner, self.n = db, owner, 0
        unit = db.scalars(select(Unit).where(Unit.code == "kg")).one()
        self.flour = Ingredient(name="Flour", unit_id=unit.id)
        self.butter = Ingredient(name="Butter", unit_id=unit.id)
        self.fridge = StorageArea(name="Fridge", kind="fridge")
        self.shelf = StorageArea(name="Shelf", kind="shelf")
        db.add_all([self.flour, self.butter, self.fridge, self.shelf])
        db.commit()

    def batch(self, ingredient: Ingredient, days: int, remaining: str, area: StorageArea | None = None, qty: str = "10") -> Batch:
        self.n += 1
        row = Batch(
            ingredient_id=ingredient.id,
            storage_area_id=area.id if area else None,
            label_code=f"ABCDEFGH{self.n:02d}",
            received_on=TODAY - timedelta(days=20),
            expiry_on=TODAY + timedelta(days=days),
            quantity=D(qty),
            remaining_quantity=D(remaining),
            created_by_id=self.owner.id,
        )
        self.db.add(row)
        self.db.commit()
        return row


@pytest.fixture
def shop(db: Session, make_employee: MakeEmployee, dated: None) -> Shop:
    return Shop(db, make_employee(RoleCode.ADMIN))


@pytest.fixture
def inspector(api: TestClient, make_employee: MakeEmployee) -> None:
    sign_in(api, make_employee(RoleCode.INSPECTOR).email)


@pytest.mark.integration
def test_near_list_is_sorted_and_bounded(api: TestClient, shop: Shop, inspector: None) -> None:
    shop.batch(shop.flour, 5, "3")
    shop.batch(shop.butter, 0, "1")  # today: near
    shop.batch(shop.flour, 7, "1")  # last day of the window
    shop.batch(shop.flour, 8, "1")  # outside
    shop.batch(shop.flour, 2, "0")  # depleted
    shop.batch(shop.flour, -1, "1")  # expired

    body = api.get("/api/v1/expiry/near").json()

    assert body["total"] == 3
    assert [i["days_left"] for i in body["items"]] == [0, 5, 7]
    assert body["items"][0]["ingredient"] == {"id": str(shop.butter.id), "name": "Butter", "unit": "kg"}
    assert body["items"][0]["storage_area"] is None
    assert api.get("/api/v1/expiry/near?days=1").json()["total"] == 1
    assert api.get("/api/v1/expiry/near?days=8").json()["total"] == 4


@pytest.mark.integration
def test_expired_lists_only_stocked_past_batches(api: TestClient, shop: Shop, inspector: None) -> None:
    shop.batch(shop.flour, -1, "2")
    shop.batch(shop.flour, -9, "2")
    shop.batch(shop.flour, -3, "0")
    shop.batch(shop.flour, 0, "2")

    body = api.get("/api/v1/expiry/expired").json()

    assert [i["days_left"] for i in body["items"]] == [-9, -1]
    assert body["total"] == 2


@pytest.mark.integration
def test_filters_search_and_paging(api: TestClient, shop: Shop, inspector: None) -> None:
    shop.batch(shop.flour, 1, "1", area=shop.shelf)
    shop.batch(shop.butter, 2, "1", area=shop.fridge)
    shop.batch(shop.butter, 3, "1", area=shop.fridge)

    by_ingredient = api.get(f"/api/v1/expiry/near?ingredient_id={shop.butter.id}").json()
    by_area = api.get(f"/api/v1/expiry/near?storage_area_id={shop.shelf.id}").json()
    searched = api.get("/api/v1/expiry/near?q=but").json()
    paged = api.get("/api/v1/expiry/near?limit=1&offset=1").json()

    assert by_ingredient["total"] == 2 and by_area["total"] == 1 and searched["total"] == 2
    assert by_area["items"][0]["storage_area"]["name"] == "Shelf"
    assert paged["total"] == 3 and len(paged["items"]) == 1 and paged["items"][0]["days_left"] == 2
    assert api.get("/api/v1/expiry/near?sort=-expiry_on").json()["items"][0]["days_left"] == 3


@pytest.mark.integration
def test_summary_counts_with_windows(api: TestClient, shop: Shop, inspector: None) -> None:
    shop.batch(shop.flour, 2, "1")
    shop.batch(shop.flour, 20, "1")
    shop.batch(shop.flour, -2, "1")

    assert api.get("/api/v1/expiry/summary").json() == {
        "today": "2026-11-10", "window_days": 7, "near_expiry": 1, "expired": 1,
    }  # fmt: skip
    assert api.get("/api/v1/expiry/summary?days=30").json()["near_expiry"] == 2


@pytest.mark.integration
@pytest.mark.parametrize("query", ["days=0", "days=91", "limit=0", "sort=bogus"])
def test_invalid_parameters_are_rejected(api: TestClient, inspector: None, shop: Shop, query: str) -> None:
    assert api.get(f"/api/v1/expiry/near?{query}").status_code == 422


@pytest.mark.integration
def test_fefo_endpoint_order_expired_and_pick(api: TestClient, shop: Shop, inspector: None) -> None:
    late = shop.batch(shop.flour, 9, "4")
    soon = shop.batch(shop.flour, 1, "1.5", qty="5")  # partially used
    shop.batch(shop.flour, -2, "7")  # expired but in stock
    shop.batch(shop.flour, 3, "0")  # depleted
    shop.batch(shop.butter, 1, "9")  # other ingredient

    body = api.get(f"/api/v1/expiry/fefo?ingredient_id={shop.flour.id}&quantity=3").json()

    assert [b["id"] for b in body["usable"]] == [str(soon.id), str(late.id)]
    assert body["usable"][0]["remaining_quantity"] == "1.500"
    assert len(body["expired"]) == 1 and body["expired"][0]["days_left"] == -2
    assert [(p["batch"]["id"], p["take"]) for p in body["pick"]] == [(str(soon.id), "1.500"), (str(late.id), "1.500")]
    assert body["sufficient"] is True and body["shortfall"] == "0.000"

    short = api.get(f"/api/v1/expiry/fefo?ingredient_id={shop.flour.id}&quantity=100").json()
    assert short["sufficient"] is False and short["allocated"] == "5.500" and short["shortfall"] == "94.500"

    plain = api.get(f"/api/v1/expiry/fefo?ingredient_id={shop.flour.id}").json()
    assert plain["pick"] is None and plain["sufficient"] is None


@pytest.mark.integration
def test_fefo_unknown_ingredient_and_bad_quantity(api: TestClient, shop: Shop, inspector: None) -> None:
    assert api.get(f"/api/v1/expiry/fefo?ingredient_id={uuid.uuid4()}").status_code == 404
    assert api.get(f"/api/v1/expiry/fefo?ingredient_id={shop.flour.id}&quantity=0").status_code == 422
    assert api.get("/api/v1/expiry/fefo").status_code == 422


@pytest.mark.integration
@pytest.mark.parametrize("role", list(RoleCode))
def test_every_role_can_read_and_anonymous_cannot(api: TestClient, make_employee: MakeEmployee, shop: Shop, role: RoleCode) -> None:
    assert api.get("/api/v1/expiry/summary").status_code == 401
    sign_in(api, make_employee(role).email)
    assert api.get("/api/v1/expiry/summary").status_code == 200
    assert api.get("/api/v1/expiry/near").status_code == 200
