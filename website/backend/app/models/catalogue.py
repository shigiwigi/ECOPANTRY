"""Public finished-product catalogue (bakery products shown on the customer website).

Deliberately separate from ingredient inventory: nothing here links to
ingredients, batches, suppliers or stock, so the public endpoints can't leak
them by accident. Only published products are ever shown publicly.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import ClassVar

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Numeric, String, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"
DESCRIPTION_MAX_LENGTH = 5000


class CatalogueCategory(Base):
    """A product group such as breads or cakes. The slug is always derived from the name,
    so the unique slug also stops two categories differing only in case or punctuation."""

    __tablename__ = "catalogue_categories"
    __table_args__ = (
        CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug_format"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
    )
    audit_target_type: ClassVar[str] = "catalogue_category"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<CatalogueCategory {self.slug}>"


class CatalogueProduct(Base):
    __tablename__ = "catalogue_products"
    __table_args__ = (
        CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug_format"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint(f"description IS NULL OR length(description) <= {DESCRIPTION_MAX_LENGTH}", name="description_length"),
        CheckConstraint("price IS NULL OR price >= 0", name="price_not_negative"),
        CheckConstraint("currency IS NULL OR currency ~ '^[A-Z]{3}$'", name="currency_format"),
        CheckConstraint("(price IS NULL) = (currency IS NULL)", name="price_has_currency"),
        CheckConstraint("is_published = (published_at IS NOT NULL)", name="published_at_matches"),
    )
    audit_target_type: ClassVar[str] = "catalogue_product"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("catalogue_categories.id", ondelete="RESTRICT"), index=True
    )
    # Optional public price. Stored with its ISO 4217 currency so it is never shown without one.
    price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[CatalogueCategory | None] = relationship(lazy="joined")

    def __repr__(self) -> str:
        return f"<CatalogueProduct {self.slug}>"
