"""Catalogue management for staff. Every endpoint needs `catalogue.manage` (administrators).

The customer website reads the catalogue through `routes/public.py`, which
returns published products only.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.schemas.catalogue import CategoryIn, CategoryOut, ProductCreate, ProductOut, ProductUpdate
from app.schemas.errors import ErrorResponse
from app.services import catalogue as service
from app.services.audit import ClientInfo

router = APIRouter(
    prefix="/catalogue",
    tags=["catalogue"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

Manager = Annotated[Principal, Depends(require_permission(Permission.CATALOGUE_MANAGE))]


# --- categories -------------------------------------------------------------


@router.get("/categories", response_model=list[CategoryOut], summary="List categories with product counts")
def list_categories(_: Manager, db: SessionDep) -> list[CategoryOut]:
    return [CategoryOut.from_category(category, count) for category, count in service.list_categories(db)]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED, summary="Add a category")
def create_category(body: CategoryIn, request: Request, principal: Manager, db: SessionDep) -> CategoryOut:
    category = service.create_category(db, body.name, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return CategoryOut.from_category(category, 0)


@router.patch("/categories/{category_id}", response_model=CategoryOut, summary="Rename a category")
def rename_category(
    category_id: uuid.UUID, body: CategoryIn, request: Request, principal: Manager, db: SessionDep
) -> CategoryOut:
    category = service.get_category(db, category_id)
    service.rename_category(db, category, body.name, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return CategoryOut.from_category(category, service.product_count(db, category))


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an empty category",
    responses={409: {"model": ErrorResponse, "description": "Products still use the category"}},
)
def delete_category(category_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> None:
    category = service.get_category(db, category_id)
    service.delete_category(db, category, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()


# --- products ---------------------------------------------------------------


@router.get("/products", response_model=list[ProductOut], summary="List all products, drafts included")
def list_products(_: Manager, db: SessionDep) -> list[ProductOut]:
    return [ProductOut.from_product(product) for product in service.list_products(db)]


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED, summary="Add a product")
def create_product(body: ProductCreate, request: Request, principal: Manager, db: SessionDep) -> ProductOut:
    product = service.create_product(
        db, body.model_dump(), by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return ProductOut.from_product(product)


@router.patch(
    "/products/{product_id}",
    response_model=ProductOut,
    summary="Change a product, or publish or unpublish it. Only the fields sent change.",
)
def update_product(
    product_id: uuid.UUID, body: ProductUpdate, request: Request, principal: Manager, db: SessionDep
) -> ProductOut:
    product = service.get_product(db, product_id)
    changes = body.model_dump(include=body.model_fields_set)
    service.update_product(db, product, changes, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return ProductOut.from_product(product)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a product")
def delete_product(product_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> None:
    product = service.get_product(db, product_id)
    service.delete_product(db, product, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
