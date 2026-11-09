"""Expiry lists and FEFO recommendations (M7). Read-only; needs `expiry.view` (every role).

Rules (usable through the whole expiry date, FEFO tie-breaks, ...) are in
`app/services/expiry.py`. "Today" comes from the `current_date` dependency so
tests can override it with `app.dependency_overrides`.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func

from app.api.v1.pagination import Ordering, PageParamsDep, SearchQuery, clean_search, paginate, sort_dependency
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.inventory import Batch, Ingredient
from app.schemas.errors import ErrorResponse
from app.schemas.expiry import ExpiryBatchOut, ExpiryIngredient, ExpirySummary, FefoOut
from app.schemas.inventory import MAX_QUANTITY
from app.schemas.pagination import Page
from app.services import expiry as service
from app.services import inventory as inventory_service

router = APIRouter(
    prefix="/expiry",
    tags=["expiry"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.EXPIRY_VIEW))]


def current_date() -> date:
    return date.today()


Today = Annotated[date, Depends(current_date)]
Days = Annotated[
    int,
    Query(ge=1, le=service.MAX_WINDOW_DAYS, description="Near-expiry window: expiry today or within this many days."),
]
IngredientFilter = Annotated[uuid.UUID | None, Query(description="Only this ingredient's batches.")]
AreaFilter = Annotated[uuid.UUID | None, Query(description="Only batches in this storage area.")]

ExpirySort = sort_dependency(
    {
        "expiry_on": Batch.expiry_on,
        "ingredient": func.lower(Ingredient.name),
        "remaining": Batch.remaining_quantity,
        "label_code": Batch.label_code,
    },
    default="expiry_on",
    tiebreaker=Batch.id,
)


@router.get("/near", response_model=Page[ExpiryBatchOut], summary="Batches with stock expiring soon")
def near_expiry(
    _: Viewer,
    db: SessionDep,
    today: Today,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(ExpirySort)],
    days: Days = service.DEFAULT_WINDOW_DAYS,
    ingredient_id: IngredientFilter = None,
    storage_area_id: AreaFilter = None,
    q: SearchQuery = None,
) -> Page[ExpiryBatchOut]:
    statement = service.near_expiry_query(
        today=today, days=days, ingredient_id=ingredient_id, storage_area_id=storage_area_id, search=clean_search(q)
    )
    items, total = paginate(db, statement, page, order)
    return Page.of([ExpiryBatchOut.from_batch(b, today) for b in items], total=total, limit=page.limit, offset=page.offset)


@router.get("/expired", response_model=Page[ExpiryBatchOut], summary="Batches still in stock past their expiry date")
def expired(
    _: Viewer,
    db: SessionDep,
    today: Today,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(ExpirySort)],
    ingredient_id: IngredientFilter = None,
    storage_area_id: AreaFilter = None,
    q: SearchQuery = None,
) -> Page[ExpiryBatchOut]:
    statement = service.expired_query(
        today=today, ingredient_id=ingredient_id, storage_area_id=storage_area_id, search=clean_search(q)
    )
    items, total = paginate(db, statement, page, order)
    return Page.of([ExpiryBatchOut.from_batch(b, today) for b in items], total=total, limit=page.limit, offset=page.offset)


@router.get("/summary", response_model=ExpirySummary, summary="How many batches are near expiry or expired")
def summary(
    _: Viewer,
    db: SessionDep,
    today: Today,
    days: Days = service.DEFAULT_WINDOW_DAYS,
    ingredient_id: IngredientFilter = None,
    storage_area_id: AreaFilter = None,
) -> ExpirySummary:
    near = service.near_expiry_query(today=today, days=days, ingredient_id=ingredient_id, storage_area_id=storage_area_id)
    gone = service.expired_query(today=today, ingredient_id=ingredient_id, storage_area_id=storage_area_id)
    return ExpirySummary(
        today=today,
        window_days=days,
        near_expiry=service.count_rows(db, near),
        expired=service.count_rows(db, gone),
    )


@router.get(
    "/fefo",
    response_model=FefoOut,
    summary="FEFO recommendation: the order to use one ingredient's batches",
    responses={404: {"model": ErrorResponse, "description": "No such ingredient"}},
)
def fefo(
    _: Viewer,
    db: SessionDep,
    today: Today,
    ingredient_id: Annotated[uuid.UUID, Query(description="The ingredient to plan for.")],
    quantity: Annotated[
        Decimal | None,
        Query(gt=0, le=MAX_QUANTITY, decimal_places=3, description="Optional amount to pick, in the ingredient's unit."),
    ] = None,
) -> FefoOut:
    ingredient = inventory_service.get_ingredient(db, ingredient_id)
    batches = [
        service.FefoBatch(b.id, b.label_code, b.received_on, b.expiry_on, b.remaining_quantity)
        for b in service.fefo_batches(db, ingredient.id)
    ]
    plan = service.fefo_plan(batches, today=today, quantity=quantity)
    return FefoOut.of(plan, ExpiryIngredient(id=ingredient.id, name=ingredient.name, unit=ingredient.unit.code), today)
