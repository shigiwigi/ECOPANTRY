"""Shared list conventions: `limit`/`offset` pagination, whitelisted `sort`, simple search.

Every list endpoint that can grow returns `Page[T]` (`app/schemas/pagination.py`):
`{"items": [...], "total": 42, "limit": 50, "offset": 0}`.

    Sort = sort_dependency({"name": Ingredient.name, "created_at": Ingredient.created_at},
                           default="name", tiebreaker=Ingredient.id)

    @router.get("/ingredients", response_model=Page[IngredientOut])
    def list_ingredients(page: PageParamsDep, order: Annotated[Ordering, Depends(Sort)], db: SessionDep, ...):
        statement = select(Ingredient).where(...)
        items, total = paginate(db, statement, page, order)
        return Page.of([...], total=total, limit=page.limit, offset=page.offset)

Query parameters:

- `limit`: 1-200, default 50. `offset`: 0-100000, default 0.
- `sort`: one key from the endpoint's whitelist, `-` in front for descending
  (`sort=-created_at`). Anything else is a 422 `validation_error`, like any
  invalid parameter, and the allowed values appear as an enum in the OpenAPI
  schema. A unique tiebreaker column is always appended so pages are stable.
- Filters are plain optional query parameters named after the field
  (`active=true`, `kind=fridge`); `q` is a case-insensitive "contains" search
  on the endpoint's name column, with `%` and `_` matched literally.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import Depends, Query
from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MAX_OFFSET = 100_000
SEARCH_MAX_LENGTH = 100


@dataclass(frozen=True)
class PageParams:
    limit: int
    offset: int


def page_params(
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT, description="Page size.")] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0, le=MAX_OFFSET, description="How many items to skip.")] = 0,
) -> PageParams:
    return PageParams(limit=limit, offset=offset)


PageParamsDep = Annotated[PageParams, Depends(page_params)]

SortColumn = InstrumentedAttribute[Any] | ColumnElement[Any]


@dataclass(frozen=True)
class Ordering:
    """The validated `sort` value and the ORDER BY clauses it stands for."""

    key: str
    clauses: tuple[ColumnElement[Any], ...]


def sort_dependency(
    columns: Mapping[str, SortColumn], *, default: str, tiebreaker: SortColumn
) -> Callable[..., Ordering]:
    """A dependency reading `sort` from the query string, limited to `columns` (each also allowed with `-`)."""
    allowed = tuple(option for key in columns for option in (key, f"-{key}"))
    if default not in allowed:
        raise ValueError(f"default sort {default!r} is not one of {allowed}")
    sort_values = Literal.__getitem__(allowed)  # type: ignore[attr-defined]

    def dependency(
        sort: Annotated[  # type: ignore[valid-type]
            sort_values,
            Query(description="Sort key; prefix with `-` for descending order."),
        ] = default,
    ) -> Ordering:
        return ordering(columns, str(sort), tiebreaker=tiebreaker)

    return dependency


def ordering(columns: Mapping[str, SortColumn], key: str, *, tiebreaker: SortColumn) -> Ordering:
    descending = key.startswith("-")
    column = columns[key.removeprefix("-")]
    primary = column.desc() if descending else column.asc()
    return Ordering(key=key, clauses=(primary, tiebreaker.desc() if descending else tiebreaker.asc()))


def paginate(db: Session, statement: Select[Any], page: PageParams, order: Ordering) -> tuple[list[Any], int]:
    """Run `statement` (a `select(Model)` with filters, no ORDER BY) for one page. Returns (items, total)."""
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    items = db.scalars(statement.order_by(*order.clauses).limit(page.limit).offset(page.offset)).unique().all()
    return list(items), int(total)


def contains(column: SortColumn, text: str) -> ColumnElement[bool]:
    """Case-insensitive substring match with LIKE wildcards in `text` taken literally."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")


SearchQuery = Annotated[
    str | None,
    Query(max_length=SEARCH_MAX_LENGTH, description="Case-insensitive search in the name."),
]


def clean_search(q: str | None) -> str | None:
    """Collapse whitespace; an empty search means no search."""
    if q is None:
        return None
    cleaned = " ".join(q.split())
    return cleaned or None

