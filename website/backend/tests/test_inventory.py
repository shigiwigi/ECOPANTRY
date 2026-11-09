"""Inventory reference data: units, ingredients and storage areas (M5)."""

import uuid
from collections.abc import Callable
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.models.audit import AuditEvent
from app.models.auth import Employee
from app.models.inventory import Batch, Ingredient

from .conftest import sign_in

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
UNITS = "/api/v1/units"
INGREDIENTS = "/api/v1/ingredients"
AREAS = "/api/v1/storage-areas"


def signed_in(api: TestClient, make_employee: MakeEmployee, role: RoleCode) -> dict[str, str]:
    employee = make_employee(role)
    return {"X-CSRF-Token": sign_in(api, employee.email)}


@pytest.fixture
def keeper(api: TestClient, make_employee: MakeEmployee) -> dict[str, str]:
    """Signs `api` in as a storekeeper; returns the CSRF header."""
    return signed_in(api, make_employee, RoleCode.STOREKEEPER)


def add_ingredient(api: TestClient, headers: dict[str, str], **fields: Any) -> dict[str, Any]:
    response = api.post(INGREDIENTS, json={"name": "Wheat flour", "unit": "kg", **fields}, headers=headers)
    assert response.status_code == 201, response.text
    return dict(response.json())


def add_area(api: TestClient, headers: dict[str, str], **fields: Any) -> dict[str, Any]:
    response = api.post(AREAS, json={"name": "Walk-in fridge", "kind": "fridge", **fields}, headers=headers)
    assert response.status_code == 201, response.text
    return dict(response.json())


def audit_trail(db: Session) -> list[tuple[str, str | None, str | None, dict[str, Any]]]:
    db.expire_all()
    events = db.scalars(select(AuditEvent).where(AuditEvent.action.like("inventory.%")).order_by(AuditEvent.id))
    return [(e.action, e.target_type, e.target_id, e.details) for e in events]


# --- units ------------------------------------------------------------------


def test_units_are_the_seeded_reference_list(api: TestClient, make_employee: MakeEmployee) -> None:
    signed_in(api, make_employee, RoleCode.INSPECTOR)

    response = api.get(UNITS)

    assert response.status_code == 200
    assert {unit["code"]: unit["kind"] for unit in response.json()} == {
        "g": "mass", "kg": "mass", "ml": "volume", "l": "volume", "pcs": "count",
    }  # fmt: skip


# --- ingredients ------------------------------------------------------------


def test_storekeeper_adds_an_ingredient_and_it_is_audited(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    created = add_ingredient(
        api, keeper, name="  Rye   flour ", unit="KG", reorder_level="2.5", notes="  Keep dry.\r\n\r\n\r\n\r\nTop shelf.  "
    )

    assert created["name"] == "Rye flour"
    assert created["unit"] == {"code": "kg", "name": "Kilogram", "kind": "mass"}
    assert created["reorder_level"] == "2.500"
    assert created["notes"] == "Keep dry.\n\nTop shelf."
    assert created["is_active"] is True
    assert created["deactivated_at"] is None
    assert api.get(f"{INGREDIENTS}/{created['id']}").json() == created
    assert audit_trail(db) == [
        ("inventory.ingredient_created", "ingredient", created["id"], {"name": "Rye flour", "unit": "kg"})
    ]


def test_ingredient_names_are_unique_ignoring_case(api: TestClient, keeper: dict[str, str]) -> None:
    add_ingredient(api, keeper, name="Butter")

    response = api.post(INGREDIENTS, json={"name": "BUTTER", "unit": "g"}, headers=keeper)

    assert response.status_code == 409
    assert response.json()["code"] == "name_taken"


@pytest.mark.parametrize(
    ("fields", "status", "code"),
    [
        ({"name": "   "}, 400, "invalid_inventory_entry"),
        ({"name": "x" * 121}, 400, "invalid_inventory_entry"),
        ({"unit": "stone"}, 400, "unknown_unit"),
        ({"reorder_level": "-1"}, 422, "validation_error"),
        ({"reorder_level": "1.2345"}, 422, "validation_error"),
        ({"notes": "n" * 1001}, 400, "invalid_inventory_entry"),
        ({"unit": None}, 422, "validation_error"),
    ],
)
def test_invalid_ingredients_are_rejected(
    api: TestClient, keeper: dict[str, str], db: Session, fields: dict[str, Any], status: int, code: str
) -> None:
    response = api.post(INGREDIENTS, json={"name": "Sugar", "unit": "kg", **fields}, headers=keeper)

    assert response.status_code == status, response.text
    assert response.json()["code"] == code
    assert db.scalar(select(Ingredient.id)) is None


def test_update_changes_only_the_fields_sent(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    ingredient = add_ingredient(api, keeper, reorder_level="5", notes="Organic")

    response = api.patch(f"{INGREDIENTS}/{ingredient['id']}", json={"name": "Bread flour", "notes": None}, headers=keeper)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["name"], body["notes"], body["reorder_level"], body["unit"]["code"]) == ("Bread flour", None, "5.000", "kg")
    assert audit_trail(db)[-1] == (
        "inventory.ingredient_updated", "ingredient", ingredient["id"], {"fields": ["name", "notes"]}
    )


def test_an_update_that_changes_nothing_records_nothing(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    ingredient = add_ingredient(api, keeper)

    response = api.patch(f"{INGREDIENTS}/{ingredient['id']}", json={"name": "Wheat  flour", "unit": "kg"}, headers=keeper)

    assert response.status_code == 200
    assert [event[0] for event in audit_trail(db)] == ["inventory.ingredient_created"]


def test_renaming_onto_another_ingredient_is_a_conflict(api: TestClient, keeper: dict[str, str]) -> None:
    add_ingredient(api, keeper, name="Salt")
    sugar = add_ingredient(api, keeper, name="Sugar")

    response = api.patch(f"{INGREDIENTS}/{sugar['id']}", json={"name": "salt"}, headers=keeper)

    assert response.status_code == 409


def test_the_unit_is_fixed_once_the_ingredient_has_batches(
    api: TestClient, keeper: dict[str, str], db: Session, make_employee: MakeEmployee
) -> None:
    ingredient = add_ingredient(api, keeper)
    assert api.patch(f"{INGREDIENTS}/{ingredient['id']}", json={"unit": "g"}, headers=keeper).status_code == 200
    owner = make_employee(RoleCode.ADMIN)
    db.add(Batch(
        ingredient_id=uuid.UUID(ingredient["id"]), label_code="ABCDEFGH12", received_on=date(2026, 11, 1),
        expiry_on=date(2026, 12, 1), quantity=1, remaining_quantity=1, created_by_id=owner.id,
    ))  # fmt: skip
    db.commit()

    response = api.patch(f"{INGREDIENTS}/{ingredient['id']}", json={"unit": "kg"}, headers=keeper)

    assert response.status_code == 409
    assert response.json()["code"] == "unit_in_use"


def test_deactivate_and_reactivate_never_delete(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    ingredient = add_ingredient(api, keeper)
    url = f"{INGREDIENTS}/{ingredient['id']}"

    off = api.post(f"{url}/deactivate", headers=keeper)
    again = api.post(f"{url}/deactivate", headers=keeper)  # idempotent, not audited twice
    on = api.post(f"{url}/reactivate", headers=keeper)

    assert off.status_code == again.status_code == on.status_code == 200
    assert off.json()["is_active"] is False and off.json()["deactivated_at"] is not None
    assert on.json()["is_active"] is True and on.json()["deactivated_at"] is None
    assert api.delete(url, headers=keeper).status_code == 405
    assert [event[0] for event in audit_trail(db)] == [
        "inventory.ingredient_created", "inventory.ingredient_deactivated", "inventory.ingredient_reactivated",
    ]  # fmt: skip


def test_list_paginates_filters_searches_and_sorts(api: TestClient, keeper: dict[str, str]) -> None:
    for name, unit in [("Wheat flour", "kg"), ("rye flour", "kg"), ("Eggs", "pcs"), ("Milk", "l"), ("100% cocoa", "g")]:
        add_ingredient(api, keeper, name=name, unit=unit)
    milk = next(item for item in api.get(INGREDIENTS).json()["items"] if item["name"] == "Milk")
    api.post(f"{INGREDIENTS}/{milk['id']}/deactivate", headers=keeper)

    def names(**params: Any) -> tuple[list[str], int]:
        body = api.get(INGREDIENTS, params=params).json()
        return [item["name"] for item in body["items"]], body["total"]

    assert names() == (["100% cocoa", "Eggs", "Milk", "rye flour", "Wheat flour"], 5)  # case-insensitive name order
    assert names(limit=2, offset=1) == (["Eggs", "Milk"], 5)
    assert names(sort="-name", limit=1) == (["Wheat flour"], 5)
    assert names(active=True) == (["100% cocoa", "Eggs", "rye flour", "Wheat flour"], 4)
    assert names(active=False) == (["Milk"], 1)
    assert names(q="FLOUR") == (["rye flour", "Wheat flour"], 2)
    assert names(q="%") == (["100% cocoa"], 1)  # wildcards are literal
    assert names(unit="kg", sort="-created_at") == (["rye flour", "Wheat flour"], 2)
    assert api.get(INGREDIENTS, params={"sort": "notes"}).status_code == 422


def test_unknown_ingredient_is_404(api: TestClient, keeper: dict[str, str]) -> None:
    missing = f"{INGREDIENTS}/{uuid.uuid4()}"

    assert api.get(missing).json()["code"] == "not_found"
    assert api.patch(missing, json={"name": "x"}, headers=keeper).status_code == 404
    assert api.post(f"{missing}/deactivate", headers=keeper).status_code == 404


# --- storage areas ----------------------------------------------------------


def test_storage_area_lifecycle(api: TestClient, keeper: dict[str, str], db: Session) -> None:
    area = add_area(api, keeper, notes="Back room")
    add_area(api, keeper, name="Dry store", kind="shelf")

    changed = api.patch(f"{AREAS}/{area['id']}", json={"kind": "freezer", "name": "Chest freezer"}, headers=keeper)
    duplicate = api.post(AREAS, json={"name": "dry STORE", "kind": "other"}, headers=keeper)
    bad_kind = api.post(AREAS, json={"name": "Cellar", "kind": "cellar"}, headers=keeper)
    off = api.post(f"{AREAS}/{area['id']}/deactivate", headers=keeper)

    assert changed.status_code == 200
    assert (changed.json()["name"], changed.json()["kind"]) == ("Chest freezer", "freezer")
    assert duplicate.status_code == 409
    assert bad_kind.status_code == 422
    assert off.json()["is_active"] is False
    body = api.get(AREAS, params={"kind": "shelf"}).json()
    assert ([item["name"] for item in body["items"]], body["total"]) == (["Dry store"], 1)
    assert api.get(AREAS, params={"active": True}).json()["total"] == 1
    assert [(action, details) for action, _, _, details in audit_trail(db)] == [
        ("inventory.storage_area_created", {"name": "Walk-in fridge", "kind": "fridge"}),
        ("inventory.storage_area_created", {"name": "Dry store", "kind": "shelf"}),
        ("inventory.storage_area_updated", {"fields": ["kind", "name"]}),
        ("inventory.storage_area_deactivated", {"name": "Chest freezer"}),
    ]


# --- permissions and CSRF ---------------------------------------------------

WRITES = [
    ("post", INGREDIENTS, {"name": "Yeast", "unit": "g"}),
    ("post", AREAS, {"name": "Shelf 2", "kind": "shelf"}),
]


@pytest.mark.parametrize(("method", "url", "body"), WRITES)
def test_inspectors_can_read_but_not_change_inventory(
    api: TestClient, make_employee: MakeEmployee, db: Session, method: str, url: str, body: dict[str, Any]
) -> None:
    headers = signed_in(api, make_employee, RoleCode.INSPECTOR)

    assert api.get(url).status_code == 200
    response = api.request(method.upper(), url, json=body, headers=headers)

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
    assert audit_trail(db) == []


def test_inspectors_cannot_update_or_deactivate(
    api: TestClient, keeper: dict[str, str], make_employee: MakeEmployee
) -> None:
    ingredient = add_ingredient(api, keeper)
    area = add_area(api, keeper)
    api.post("/api/v1/auth/logout", headers=keeper)
    inspector = signed_in(api, make_employee, RoleCode.INSPECTOR)

    for method, url in [
        ("PATCH", f"{INGREDIENTS}/{ingredient['id']}"),
        ("POST", f"{INGREDIENTS}/{ingredient['id']}/deactivate"),
        ("PATCH", f"{AREAS}/{area['id']}"),
        ("POST", f"{AREAS}/{area['id']}/deactivate"),
    ]:
        assert api.request(method, url, json={"name": "Changed"}, headers=inspector).status_code == 403, url


def test_administrators_manage_inventory_too(api: TestClient, make_employee: MakeEmployee) -> None:
    admin = signed_in(api, make_employee, RoleCode.ADMIN)

    assert add_ingredient(api, admin)["name"] == "Wheat flour"


@pytest.mark.parametrize(("method", "url", "body"), WRITES)
def test_changes_need_the_csrf_token(
    api: TestClient, keeper: dict[str, str], method: str, url: str, body: dict[str, Any]
) -> None:
    missing = api.request(method.upper(), url, json=body)
    wrong = api.request(method.upper(), url, json=body, headers={"X-CSRF-Token": "not-the-token"})

    assert missing.status_code == wrong.status_code == 403
    assert missing.json()["code"] == "csrf_failed"
