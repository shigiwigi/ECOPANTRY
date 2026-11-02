"""Public catalogue: staff management (administrators only) and the public read endpoints."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.models.audit import AuditEvent
from app.models.auth import Employee
from app.models.catalogue import CatalogueProduct
from app.services.catalogue import slugify

from .conftest import sign_in

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
PRODUCTS = "/api/v1/catalogue/products"
CATEGORIES = "/api/v1/catalogue/categories"
PUBLIC = "/api/v1/public/catalogue"

PUBLIC_PRODUCT_FIELDS = {"slug", "name", "summary", "category", "price", "currency"}


@pytest.fixture
def admin(api: TestClient, make_employee: MakeEmployee) -> dict[str, str]:
    """Signs `api` in as an administrator; returns the CSRF header."""
    employee = make_employee(RoleCode.ADMIN)
    return {"X-CSRF-Token": sign_in(api, employee.email)}


def add_product(api: TestClient, headers: dict[str, str], **fields: Any) -> dict[str, Any]:
    response = api.post(PRODUCTS, json={"name": "Sourdough loaf", **fields}, headers=headers)
    assert response.status_code == 201, response.text
    return dict(response.json())


def add_category(api: TestClient, headers: dict[str, str], name: str = "Breads") -> dict[str, Any]:
    response = api.post(CATEGORIES, json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return dict(response.json())


def audit_actions(db: Session) -> list[str]:
    db.expire_all()
    return list(db.scalars(select(AuditEvent.action).order_by(AuditEvent.id)))


# --- public endpoints -------------------------------------------------------


def test_public_catalogue_is_empty_until_products_are_published(api: TestClient) -> None:
    response = api.get(PUBLIC)

    assert response.status_code == 200
    assert response.json() == {"categories": [], "products": []}


def test_public_catalogue_shows_published_products_only(auth_app: FastAPI, api: TestClient, admin: dict[str, str]) -> None:
    breads = add_category(api, admin, "Breads")
    add_category(api, admin, "Cakes")  # only drafts below, so it stays hidden
    cakes = api.get(CATEGORIES).json()[1]
    add_product(api, admin, name="Sourdough loaf", category_id=breads["id"], is_published=True, price="4.5", currency="eur")
    add_product(api, admin, name="Secret recipe cake", category_id=cakes["id"])

    with TestClient(auth_app) as visitor:  # no cookie at all
        body = visitor.get(PUBLIC).json()

    assert [product["name"] for product in body["products"]] == ["Sourdough loaf"]
    assert body["categories"] == [{"slug": "breads", "name": "Breads"}]
    product = body["products"][0]
    assert set(product) == PUBLIC_PRODUCT_FIELDS
    assert product["price"] == "4.50"
    assert product["currency"] == "EUR"
    assert product["category"] == {"slug": "breads", "name": "Breads"}
    assert "Secret recipe" not in visitor.get(PUBLIC).text


def test_public_product_detail_adds_only_the_description(auth_app: FastAPI, api: TestClient, admin: dict[str, str]) -> None:
    add_product(api, admin, name="Rye bread", description="Dense.\n\nBaked daily.", is_published=True)

    with TestClient(auth_app) as visitor:
        response = visitor.get(f"{PUBLIC}/products/rye-bread")

    assert response.status_code == 200
    assert set(response.json()) == PUBLIC_PRODUCT_FIELDS | {"description"}
    assert response.json()["description"] == "Dense.\n\nBaked daily."
    assert response.json()["price"] is None


def test_draft_products_answer_like_missing_ones(auth_app: FastAPI, api: TestClient, admin: dict[str, str]) -> None:
    add_product(api, admin, name="Unreleased tart")

    with TestClient(auth_app) as visitor:
        draft = visitor.get(f"{PUBLIC}/products/unreleased-tart")
        missing = visitor.get(f"{PUBLIC}/products/no-such-product")

    assert draft.status_code == missing.status_code == 404
    assert draft.json() == missing.json() == {"detail": "That product isn't available.", "code": "not_found"}


def test_public_endpoints_ignore_staff_cookies(auth_app: FastAPI) -> None:
    with TestClient(auth_app, cookies={"ecopantry_session": "made-up"}) as visitor:
        response = visitor.get(PUBLIC)

    assert response.status_code == 200
    assert "set-cookie" not in response.headers


# --- who may manage the catalogue -------------------------------------------


@pytest.mark.parametrize("role", [RoleCode.STOREKEEPER, RoleCode.INSPECTOR])
def test_only_administrators_manage_the_catalogue(
    api: TestClient, db: Session, make_employee: MakeEmployee, role: RoleCode
) -> None:
    headers = {"X-CSRF-Token": sign_in(api, make_employee(role).email)}
    some_id = "00000000-0000-4000-8000-000000000000"
    requests = [
        ("GET", PRODUCTS, None),
        ("POST", PRODUCTS, {"name": "Bun"}),
        ("PATCH", f"{PRODUCTS}/{some_id}", {"name": "Bun"}),
        ("DELETE", f"{PRODUCTS}/{some_id}", None),
        ("GET", CATEGORIES, None),
        ("POST", CATEGORIES, {"name": "Buns"}),
        ("PATCH", f"{CATEGORIES}/{some_id}", {"name": "Buns"}),
        ("DELETE", f"{CATEGORIES}/{some_id}", None),
    ]
    for method, url, body in requests:
        response = api.request(method, url, json=body, headers=headers)
        assert response.status_code == 403, f"{method} {url}"
        assert response.json()["code"] == "forbidden"

    assert db.scalars(select(CatalogueProduct)).all() == []


def test_changes_need_the_csrf_token(api: TestClient, admin: dict[str, str]) -> None:
    response = api.post(PRODUCTS, json={"name": "Bun"})

    assert response.status_code == 403
    assert response.json()["code"] == "csrf_failed"


# --- products ---------------------------------------------------------------


def test_creating_a_product_makes_a_draft_with_a_slug_from_the_name(api: TestClient, db: Session, admin: dict[str, str]) -> None:
    product = add_product(api, admin, name="  Pain   au chocolat  ", summary=" Buttery,  flaky ")

    assert product["name"] == "Pain au chocolat"
    assert product["slug"] == "pain-au-chocolat"
    assert product["summary"] == "Buttery, flaky"
    assert product["is_published"] is False
    assert product["published_at"] is None
    assert "catalogue.product_created" in audit_actions(db)
    event = db.scalars(select(AuditEvent).where(AuditEvent.action == "catalogue.product_created")).one()
    assert (event.target_type, event.target_id) == ("catalogue_product", product["id"])


def test_duplicate_names_get_numbered_slugs(api: TestClient, admin: dict[str, str]) -> None:
    first = add_product(api, admin, name="Croissant")
    second = add_product(api, admin, name="Croissant")

    assert (first["slug"], second["slug"]) == ("croissant", "croissant-2")


def test_explicit_slugs_are_checked(api: TestClient, admin: dict[str, str]) -> None:
    add_product(api, admin, name="Croissant", slug="butter-croissant")

    taken = api.post(PRODUCTS, json={"name": "Other", "slug": "butter-croissant"}, headers=admin)
    invalid = api.post(PRODUCTS, json={"name": "Other", "slug": "Not valid!"}, headers=admin)

    assert taken.status_code == 409
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "invalid_catalogue_entry"


def test_names_without_latin_letters_still_get_a_slug(api: TestClient, admin: dict[str, str]) -> None:
    product = add_product(api, admin, name="කේක්")

    assert product["slug"].startswith("product-")
    assert slugify("Crème brûlée") == "creme-brulee"


@pytest.mark.parametrize(
    ("fields", "status"),
    [
        ({"price": "2.50"}, 400),  # price without currency
        ({"currency": "EUR"}, 400),  # currency without price
        ({"price": "-1", "currency": "EUR"}, 422),
        ({"price": "1.005", "currency": "EUR"}, 422),
        ({"price": "2", "currency": "EURO"}, 422),
        ({"name": "   "}, 400),
        ({"summary": "x" * 201}, 400),
        ({"category_id": "00000000-0000-4000-8000-000000000000"}, 404),
    ],
)
def test_invalid_products_are_refused(api: TestClient, db: Session, admin: dict[str, str], fields: dict[str, Any], status: int) -> None:
    response = api.post(PRODUCTS, json={"name": "Bun", **fields}, headers=admin)

    assert response.status_code == status, response.text
    assert db.scalars(select(CatalogueProduct)).all() == []


def test_validation_errors_do_not_echo_input(api: TestClient, admin: dict[str, str]) -> None:
    response = api.post(PRODUCTS, json={"name": "Bun", "price": "-123.45", "currency": "ZZZZ"}, headers=admin)

    assert response.status_code == 422
    assert "123.45" not in response.text
    assert "ZZZZ" not in response.text


def test_patch_changes_only_the_fields_sent(api: TestClient, db: Session, admin: dict[str, str]) -> None:
    product = add_product(api, admin, name="Bagel", summary="Chewy", price="1.20", currency="EUR")

    response = api.patch(f"{PRODUCTS}/{product['id']}", json={"summary": None, "price": "1.40"}, headers=admin)

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["summary"], body["price"], body["currency"]) == ("Bagel", None, "1.40", "EUR")
    assert body["slug"] == "bagel"  # renaming never changes the address unless asked
    event = db.scalars(select(AuditEvent).where(AuditEvent.action == "catalogue.product_updated")).one()
    assert event.details == {"fields": ["price", "summary"]}


def test_clearing_the_price_needs_the_currency_cleared_too(api: TestClient, admin: dict[str, str]) -> None:
    product = add_product(api, admin, price="3", currency="EUR")
    url = f"{PRODUCTS}/{product['id']}"

    assert api.patch(url, json={"price": None}, headers=admin).status_code == 400
    response = api.patch(url, json={"price": None, "currency": None}, headers=admin)
    assert (response.json()["price"], response.json()["currency"]) == (None, None)


def test_a_product_name_cannot_be_cleared(api: TestClient, admin: dict[str, str]) -> None:
    product = add_product(api, admin)

    response = api.patch(f"{PRODUCTS}/{product['id']}", json={"name": None}, headers=admin)

    assert response.status_code == 400


def test_publishing_and_unpublishing(auth_app: FastAPI, api: TestClient, db: Session, admin: dict[str, str]) -> None:
    product = add_product(api, admin, name="Focaccia")
    url = f"{PRODUCTS}/{product['id']}"

    published = api.patch(url, json={"is_published": True}, headers=admin).json()
    with TestClient(auth_app) as visitor:
        assert visitor.get(f"{PUBLIC}/products/focaccia").status_code == 200
    unpublished = api.patch(url, json={"is_published": False}, headers=admin).json()
    with TestClient(auth_app) as visitor:
        assert visitor.get(f"{PUBLIC}/products/focaccia").status_code == 404

    assert published["is_published"] is True and published["published_at"] is not None
    assert unpublished["is_published"] is False and unpublished["published_at"] is None
    actions = audit_actions(db)
    assert actions.index("catalogue.product_published") < actions.index("catalogue.product_unpublished")


def test_an_unchanged_patch_records_nothing(api: TestClient, db: Session, admin: dict[str, str]) -> None:
    product = add_product(api, admin, name="Brioche")
    before = audit_actions(db)

    response = api.patch(f"{PRODUCTS}/{product['id']}", json={"name": "Brioche", "is_published": False}, headers=admin)

    assert response.status_code == 200
    assert audit_actions(db) == before


def test_deleting_a_product(auth_app: FastAPI, api: TestClient, db: Session, admin: dict[str, str]) -> None:
    product = add_product(api, admin, name="Scone", is_published=True)

    response = api.delete(f"{PRODUCTS}/{product['id']}", headers=admin)

    assert response.status_code == 204
    assert api.get(PRODUCTS).json() == []
    with TestClient(auth_app) as visitor:
        assert visitor.get(f"{PUBLIC}/products/scone").status_code == 404
    event = db.scalars(select(AuditEvent).where(AuditEvent.action == "catalogue.product_deleted")).one()
    assert event.details == {"name": "Scone", "slug": "scone"}
    assert api.delete(f"{PRODUCTS}/{product['id']}", headers=admin).status_code == 404


def test_staff_list_includes_drafts(api: TestClient, admin: dict[str, str]) -> None:
    add_product(api, admin, name="B draft")
    add_product(api, admin, name="a published", is_published=True)

    names = [product["name"] for product in api.get(PRODUCTS).json()]

    assert names == ["a published", "B draft"]


# --- categories -------------------------------------------------------------


def test_category_lifecycle(api: TestClient, db: Session, admin: dict[str, str]) -> None:
    category = add_category(api, admin, "Pastries")
    assert (category["slug"], category["product_count"]) == ("pastries", 0)

    renamed = api.patch(f"{CATEGORIES}/{category['id']}", json={"name": "Viennoiserie"}, headers=admin)
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["slug"]) == ("Viennoiserie", "viennoiserie")

    assert api.delete(f"{CATEGORIES}/{category['id']}", headers=admin).status_code == 204
    assert api.get(CATEGORIES).json() == []
    assert audit_actions(db)[-3:] == [
        "catalogue.category_created", "catalogue.category_renamed", "catalogue.category_deleted",
    ]  # fmt: skip


def test_category_names_are_unique_ignoring_case(api: TestClient, admin: dict[str, str]) -> None:
    add_category(api, admin, "Breads")

    response = api.post(CATEGORIES, json={"name": "  BREADS "}, headers=admin)

    assert response.status_code == 409


def test_a_category_in_use_cannot_be_deleted(api: TestClient, admin: dict[str, str]) -> None:
    category = add_category(api, admin)
    add_product(api, admin, category_id=category["id"])

    response = api.delete(f"{CATEGORIES}/{category['id']}", headers=admin)

    assert response.status_code == 409
    assert api.get(CATEGORIES).json()[0]["product_count"] == 1


def test_moving_a_product_between_categories(api: TestClient, admin: dict[str, str]) -> None:
    breads = add_category(api, admin, "Breads")
    cakes = add_category(api, admin, "Cakes")
    product = add_product(api, admin, category_id=breads["id"])

    moved = api.patch(f"{PRODUCTS}/{product['id']}", json={"category_id": cakes["id"]}, headers=admin).json()
    cleared = api.patch(f"{PRODUCTS}/{product['id']}", json={"category_id": None}, headers=admin).json()

    assert moved["category_name"] == "Cakes"
    assert (cleared["category_id"], cleared["category_name"]) == (None, None)
