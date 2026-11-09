"""Inventory reference data: units (read-only), ingredients and storage areas.

Reading needs `inventory.view` (every role); changes need `inventory.manage`
(administrators and storekeepers, never inspectors). Nothing is deleted:
ingredients and storage areas are deactivated and can be reactivated.
List endpoints follow the shared conventions in `app/api/v1/pagination.py`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func

from app.api.v1.pagination import Ordering, PageParamsDep, SearchQuery, clean_search, paginate, sort_dependency
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.inventory import Ingredient, StorageArea
from app.schemas.errors import ErrorResponse
from app.schemas.inventory import (
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    StorageAreaCreate,
    StorageAreaKind,
    StorageAreaOut,
    StorageAreaUpdate,
    UnitOut,
)
from app.schemas.pagination import Page
from app.services import inventory as service
from app.services.audit import ClientInfo

router = APIRouter(
    tags=["inventory"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.INVENTORY_VIEW))]
Manager = Annotated[Principal, Depends(require_permission(Permission.INVENTORY_MANAGE))]
ActiveFilter = Annotated[bool | None, Query(description="Only active (`true`) or deactivated (`false`) entries.")]

WRITE_ERRORS: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorResponse, "description": "Invalid value, e.g. a blank name or an unknown unit"},
    409: {"model": ErrorResponse, "description": "The name is taken, or the unit can't change"},
}
NOT_FOUND: dict[int | str, dict[str, object]] = {404: {"model": ErrorResponse, "description": "No such entry"}}

IngredientSort = sort_dependency(
    {"name": func.lower(Ingredient.name), "created_at": Ingredient.created_at, "updated_at": Ingredient.updated_at},
    default="name",
    tiebreaker=Ingredient.id,
)
StorageAreaSort = sort_dependency(
    {"name": func.lower(StorageArea.name), "kind": StorageArea.kind, "created_at": StorageArea.created_at},
    default="name",
    tiebreaker=StorageArea.id,
)


# --- units ------------------------------------------------------------------


@router.get("/units", response_model=list[UnitOut], summary="List the units ingredients can be counted in")
def list_units(_: Viewer, db: SessionDep) -> list[UnitOut]:
    return [UnitOut.from_unit(unit) for unit in service.list_units(db)]


# --- ingredients ------------------------------------------------------------


@router.get("/ingredients", response_model=Page[IngredientOut], summary="List ingredients")
def list_ingredients(
    _: Viewer,
    db: SessionDep,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(IngredientSort)],
    active: ActiveFilter = None,
    q: SearchQuery = None,
    unit: Annotated[str | None, Query(max_length=8, description="Only ingredients counted in this unit code.")] = None,
) -> Page[IngredientOut]:
    statement = service.ingredients_query(active=active, search=clean_search(q), unit=unit)
    items, total = paginate(db, statement, page, order)
    return Page.of([IngredientOut.from_ingredient(i) for i in items], total=total, limit=page.limit, offset=page.offset)


@router.get("/ingredients/{ingredient_id}", response_model=IngredientOut, summary="Get one ingredient", responses=NOT_FOUND)
def get_ingredient(ingredient_id: uuid.UUID, _: Viewer, db: SessionDep) -> IngredientOut:
    return IngredientOut.from_ingredient(service.get_ingredient(db, ingredient_id))


@router.post(
    "/ingredients",
    response_model=IngredientOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add an ingredient",
    responses=WRITE_ERRORS,
)
def create_ingredient(body: IngredientCreate, request: Request, principal: Manager, db: SessionDep) -> IngredientOut:
    ingredient = service.create_ingredient(
        db, body.model_dump(), by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return IngredientOut.from_ingredient(ingredient)


@router.patch(
    "/ingredients/{ingredient_id}",
    response_model=IngredientOut,
    summary="Change an ingredient. Only the fields sent change.",
    responses={**WRITE_ERRORS, **NOT_FOUND},
)
def update_ingredient(
    ingredient_id: uuid.UUID, body: IngredientUpdate, request: Request, principal: Manager, db: SessionDep
) -> IngredientOut:
    ingredient = service.get_ingredient(db, ingredient_id)
    changes = body.model_dump(include=body.model_fields_set)
    service.update_ingredient(db, ingredient, changes, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return IngredientOut.from_ingredient(ingredient)


@router.post(
    "/ingredients/{ingredient_id}/deactivate",
    response_model=IngredientOut,
    summary="Deactivate an ingredient (it stays in history; nothing is deleted)",
    responses=NOT_FOUND,
)
def deactivate_ingredient(ingredient_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> IngredientOut:
    ingredient = service.get_ingredient(db, ingredient_id)
    service.set_ingredient_active(db, ingredient, False, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return IngredientOut.from_ingredient(ingredient)


@router.post(
    "/ingredients/{ingredient_id}/reactivate",
    response_model=IngredientOut,
    summary="Reactivate a deactivated ingredient",
    responses=NOT_FOUND,
)
def reactivate_ingredient(ingredient_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> IngredientOut:
    ingredient = service.get_ingredient(db, ingredient_id)
    service.set_ingredient_active(db, ingredient, True, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return IngredientOut.from_ingredient(ingredient)


# --- storage areas ----------------------------------------------------------


@router.get("/storage-areas", response_model=Page[StorageAreaOut], summary="List storage areas")
def list_storage_areas(
    _: Viewer,
    db: SessionDep,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(StorageAreaSort)],
    active: ActiveFilter = None,
    q: SearchQuery = None,
    kind: StorageAreaKind | None = None,
) -> Page[StorageAreaOut]:
    statement = service.storage_areas_query(active=active, search=clean_search(q), kind=kind)
    items, total = paginate(db, statement, page, order)
    return Page.of([StorageAreaOut.from_area(a) for a in items], total=total, limit=page.limit, offset=page.offset)


@router.get(
    "/storage-areas/{area_id}", response_model=StorageAreaOut, summary="Get one storage area", responses=NOT_FOUND
)
def get_storage_area(area_id: uuid.UUID, _: Viewer, db: SessionDep) -> StorageAreaOut:
    return StorageAreaOut.from_area(service.get_storage_area(db, area_id))


@router.post(
    "/storage-areas",
    response_model=StorageAreaOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a storage area",
    responses=WRITE_ERRORS,
)
def create_storage_area(body: StorageAreaCreate, request: Request, principal: Manager, db: SessionDep) -> StorageAreaOut:
    area = service.create_storage_area(db, body.model_dump(), by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return StorageAreaOut.from_area(area)


@router.patch(
    "/storage-areas/{area_id}",
    response_model=StorageAreaOut,
    summary="Change a storage area. Only the fields sent change.",
    responses={**WRITE_ERRORS, **NOT_FOUND},
)
def update_storage_area(
    area_id: uuid.UUID, body: StorageAreaUpdate, request: Request, principal: Manager, db: SessionDep
) -> StorageAreaOut:
    area = service.get_storage_area(db, area_id)
    changes = body.model_dump(include=body.model_fields_set)
    service.update_storage_area(db, area, changes, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return StorageAreaOut.from_area(area)


@router.post(
    "/storage-areas/{area_id}/deactivate",
    response_model=StorageAreaOut,
    summary="Deactivate a storage area (it stays in history; nothing is deleted)",
    responses=NOT_FOUND,
)
def deactivate_storage_area(area_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> StorageAreaOut:
    area = service.get_storage_area(db, area_id)
    service.set_storage_area_active(db, area, False, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return StorageAreaOut.from_area(area)


@router.post(
    "/storage-areas/{area_id}/reactivate",
    response_model=StorageAreaOut,
    summary="Reactivate a deactivated storage area",
    responses=NOT_FOUND,
)
def reactivate_storage_area(area_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> StorageAreaOut:
    area = service.get_storage_area(db, area_id)
    service.set_storage_area_active(db, area, True, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return StorageAreaOut.from_area(area)
