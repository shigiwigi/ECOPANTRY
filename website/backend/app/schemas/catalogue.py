"""Catalogue schemas.

The `Public*` models are everything the customer website may see. They list
their fields explicitly; adding a field to the database never adds it to a
public response. Staff models carry ids, draft state and timestamps.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.catalogue import DESCRIPTION_MAX_LENGTH, CatalogueCategory, CatalogueProduct

MAX_PRICE = Decimal("99999999.99")

# --- public -----------------------------------------------------------------


class PublicCategoryOut(BaseModel):
    slug: str
    name: str

    @classmethod
    def from_category(cls, category: CatalogueCategory) -> "PublicCategoryOut":
        return cls(slug=category.slug, name=category.name)


class PublicProductOut(BaseModel):
    slug: str
    name: str
    summary: str | None
    category: PublicCategoryOut | None
    price: Decimal | None = Field(description="Decimal string such as \"4.50\", or null when no price is published.")
    currency: str | None = Field(description="ISO 4217 code; set exactly when `price` is.")

    @classmethod
    def from_product(cls, product: CatalogueProduct) -> "PublicProductOut":
        return cls(
            slug=product.slug,
            name=product.name,
            summary=product.summary,
            category=PublicCategoryOut.from_category(product.category) if product.category else None,
            price=product.price,
            currency=product.currency,
        )


class PublicProductDetailOut(PublicProductOut):
    description: str | None

    @classmethod
    def from_product(cls, product: CatalogueProduct) -> "PublicProductDetailOut":
        return cls(**PublicProductOut.from_product(product).model_dump(), description=product.description)


class PublicCatalogueOut(BaseModel):
    categories: list[PublicCategoryOut] = Field(description="Only categories with at least one published product.")
    products: list[PublicProductOut]


# --- staff ------------------------------------------------------------------


class CategoryOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    product_count: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_category(cls, category: CatalogueCategory, product_count: int) -> "CategoryOut":
        return cls(
            id=category.id,
            slug=category.slug,
            name=category.name,
            product_count=product_count,
            created_at=category.created_at,
            updated_at=category.updated_at,
        )


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProductOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    summary: str | None
    description: str | None
    category_id: uuid.UUID | None
    category_name: str | None
    price: Decimal | None
    currency: str | None
    is_published: bool
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_product(cls, product: CatalogueProduct) -> "ProductOut":
        return cls(
            id=product.id,
            slug=product.slug,
            name=product.name,
            summary=product.summary,
            description=product.description,
            category_id=product.category_id,
            category_name=product.category.name if product.category else None,
            price=product.price,
            currency=product.currency,
            is_published=product.is_published,
            published_at=product.published_at,
            created_at=product.created_at,
            updated_at=product.updated_at,
        )


class _ProductFields(BaseModel):
    # Generous limits here; the service trims whitespace and applies the real ones.
    summary: str | None = Field(default=None, max_length=400)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH * 2)
    category_id: uuid.UUID | None = None
    price: Decimal | None = Field(default=None, ge=0, le=MAX_PRICE, max_digits=10, decimal_places=2)
    currency: str | None = Field(default=None, pattern=r"^[A-Za-z]{3}$", description="ISO 4217 code, required with a price.")
    is_published: bool = False


class ProductCreate(_ProductFields):
    name: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(
        default=None, max_length=80, description="Web address part. Made from the name when left out."
    )


class ProductUpdate(_ProductFields):
    """Partial update: only the fields present in the request change. Send `null` to clear an optional field."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=80)
    is_published: bool | None = None  # type: ignore[assignment]
