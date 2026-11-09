"""The shared list conventions (app/api/v1/pagination.py), tested once on a throwaway route without a database."""

from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, MetaData, String, Table
from sqlalchemy.dialects import postgresql

from app.api.v1.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    Ordering,
    PageParamsDep,
    SearchQuery,
    clean_search,
    contains,
    sort_dependency,
)
from app.core.errors import register_exception_handlers
from app.schemas.pagination import Page

things = Table("things", MetaData(), Column("id", Integer, primary_key=True), Column("name", String))
ThingSort = sort_dependency({"name": things.c.name}, default="name", tiebreaker=things.c.id)


def _sql(clause: object) -> str:
    return str(clause.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))  # type: ignore[attr-defined]


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/things", response_model=Page[str])
    def list_things(page: PageParamsDep, order: Annotated[Ordering, Depends(ThingSort)], q: SearchQuery = None) -> Page[str]:
        names = [order.key, clean_search(q) or ""]
        return Page.of(names, total=99, limit=page.limit, offset=page.offset)

    return TestClient(app)


def test_defaults_apply_when_nothing_is_asked_for(client: TestClient) -> None:
    response = client.get("/things")

    assert response.status_code == 200
    assert response.json() == {"items": ["name", ""], "total": 99, "limit": DEFAULT_LIMIT, "offset": 0}


def test_limit_offset_sort_and_search_are_passed_through(client: TestClient) -> None:
    response = client.get("/things", params={"limit": 5, "offset": 10, "sort": "-name", "q": "  rye   flour "})

    assert response.json() == {"items": ["-name", "rye flour"], "total": 99, "limit": 5, "offset": 10}


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"limit": 0}, "limit"),
        ({"limit": MAX_LIMIT + 1}, "limit"),
        ({"offset": -1}, "offset"),
        ({"sort": "password_hash"}, "sort"),  # not on the whitelist
        ({"sort": "--name"}, "sort"),
        ({"q": "x" * 101}, "q"),
    ],
)
def test_invalid_list_parameters_are_validation_errors(client: TestClient, params: dict[str, object], field: str) -> None:
    response = client.get("/things", params=params)

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["errors"][0]["loc"] == ["query", field]


def test_the_sort_whitelist_is_an_enum_in_the_openapi_schema(client: TestClient) -> None:
    parameters = client.app.openapi()["paths"]["/things"]["get"]["parameters"]  # type: ignore[attr-defined]
    sort = next(parameter for parameter in parameters if parameter["name"] == "sort")

    assert sort["schema"]["enum"] == ["name", "-name"]


def test_ordering_adds_a_stable_tiebreaker_in_the_same_direction() -> None:
    ascending = ThingSort(sort="name")
    descending = ThingSort(sort="-name")

    assert [_sql(clause) for clause in ascending.clauses] == ["things.name ASC", "things.id ASC"]
    assert [_sql(clause) for clause in descending.clauses] == ["things.name DESC", "things.id DESC"]


def test_a_default_outside_the_whitelist_is_a_programming_error() -> None:
    with pytest.raises(ValueError):
        sort_dependency({"name": things.c.name}, default="id", tiebreaker=things.c.id)


def test_search_treats_like_wildcards_literally() -> None:
    compiled = contains(things.c.name, "50%_off\\").compile(dialect=postgresql.dialect())

    assert list(compiled.params.values()) == ["%50\\%\\_off\\\\%"]
    assert "ILIKE" in str(compiled)
    assert "ESCAPE '\\'" in str(compiled)


@pytest.mark.parametrize(("raw", "cleaned"), [(None, None), ("", None), ("   ", None), (" a  b ", "a b")])
def test_clean_search(raw: str | None, cleaned: str | None) -> None:
    assert clean_search(raw) == cleaned
