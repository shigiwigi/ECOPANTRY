"""Endpoints for the public customer website. No sign-in.

Only explicitly public data lives here: published catalogue products and
their categories, through the `Public*` schemas. Never add stock quantities,
batches, suppliers, employees, sensor readings, waste or compliance records.
These routes don't read the staff session cookie. Each one is listed in
`tests/test_route_protection.py` as deliberately public.
"""

from fastapi import APIRouter

from app.db.session import SessionDep
from app.schemas.catalogue import PublicCatalogueOut, PublicCategoryOut, PublicProductDetailOut, PublicProductOut
from app.schemas.errors import ErrorResponse
from app.services import catalogue as service

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/catalogue", response_model=PublicCatalogueOut, summary="Published products and their categories")
def catalogue(db: SessionDep) -> PublicCatalogueOut:
    products = service.published_products(db)
    categories = {product.category.id: product.category for product in products if product.category}
    return PublicCatalogueOut(
        categories=[
            PublicCategoryOut.from_category(category)
            for category in sorted(categories.values(), key=lambda category: category.name.lower())
        ],
        products=[PublicProductOut.from_product(product) for product in products],
    )


@router.get(
    "/catalogue/products/{slug}",
    response_model=PublicProductDetailOut,
    summary="One published product",
    responses={404: {"model": ErrorResponse, "description": "No published product with that slug"}},
)
def product(slug: str, db: SessionDep) -> PublicProductDetailOut:
    return PublicProductDetailOut.from_product(service.published_product(db, slug))
