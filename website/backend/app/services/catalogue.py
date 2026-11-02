"""Public catalogue: categories and finished products. Callers commit.

Every change is written to the audit log in the same transaction. Product and
category names are public data, so they may appear in audit details.
"""

import re
import secrets
import unicodedata
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.service import utcnow
from app.core.errors import AppError, ConflictError, NotFoundError
from app.models.auth import Employee
from app.models.catalogue import DESCRIPTION_MAX_LENGTH, SLUG_PATTERN, CatalogueCategory, CatalogueProduct
from app.services.audit import ClientInfo, record_event

_SLUG = re.compile(SLUG_PATTERN)
SLUG_MAX_LENGTH = 80


class InvalidCatalogueEntryError(AppError):
    status_code = 400
    code = "invalid_catalogue_entry"


# --- cleaning input ---------------------------------------------------------


def _single_line(value: str, *, field: str, max_length: int, required: bool = False) -> str | None:
    cleaned = " ".join(value.split())
    if not cleaned:
        if required:
            raise InvalidCatalogueEntryError(f"Enter a {field}.")
        return None
    if len(cleaned) > max_length:
        raise InvalidCatalogueEntryError(f"Keep the {field} to {max_length} characters or fewer.")
    return cleaned


def _description(value: str | None) -> str | None:
    if value is None:
        return None
    # Keep paragraphs, drop trailing spaces and runs of blank lines.
    lines = [line.rstrip() for line in value.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n")]
    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(lines))
    if not cleaned:
        return None
    if len(cleaned) > DESCRIPTION_MAX_LENGTH:
        raise InvalidCatalogueEntryError(f"Keep the description to {DESCRIPTION_MAX_LENGTH} characters or fewer.")
    return cleaned


def slugify(text: str) -> str:
    """Lower-case ASCII words joined by hyphens. Empty when the text has no Latin letters or digits."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:SLUG_MAX_LENGTH].rstrip("-")


def _explicit_slug(value: str) -> str:
    slug = value.strip().lower()
    if not slug or len(slug) > SLUG_MAX_LENGTH or not _SLUG.match(slug):
        raise InvalidCatalogueEntryError(
            "Use only lower-case letters, digits and single hyphens in the web address, for example sourdough-loaf."
        )
    return slug


def _price(price: Decimal | None, currency: str | None) -> tuple[Decimal | None, str | None]:
    if (price is None) != (currency is None):
        raise InvalidCatalogueEntryError("Enter both a price and its currency, or neither.")
    return price, currency.upper() if currency else None


# --- categories -------------------------------------------------------------


def list_categories(db: Session) -> list[tuple[CatalogueCategory, int]]:
    counts = (
        select(CatalogueProduct.category_id, func.count().label("n"))
        .group_by(CatalogueProduct.category_id)
        .subquery()
    )
    rows = db.execute(
        select(CatalogueCategory, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.category_id == CatalogueCategory.id)
        .order_by(func.lower(CatalogueCategory.name))
    ).all()
    return [(category, int(count)) for category, count in rows]


def product_count(db: Session, category: CatalogueCategory) -> int:
    return int(
        db.scalar(select(func.count()).select_from(CatalogueProduct).where(CatalogueProduct.category_id == category.id))
        or 0
    )


def get_category(db: Session, category_id: object) -> CatalogueCategory:
    category = db.get(CatalogueCategory, category_id)
    if category is None:
        raise NotFoundError("That category doesn't exist.")
    return category


def _category_name_and_slug(db: Session, name: str, *, current: CatalogueCategory | None = None) -> tuple[str, str]:
    cleaned = _single_line(name, field="category name", max_length=60, required=True)
    assert cleaned is not None
    others = select(CatalogueCategory).where(func.lower(CatalogueCategory.name) == cleaned.lower())
    if current is not None:
        others = others.where(CatalogueCategory.id != current.id)
    if db.scalars(others).first() is not None:
        raise ConflictError("A category with that name already exists.")

    slug = slugify(cleaned)
    if current is not None and slug and slug == current.slug:
        return cleaned, slug
    if not slug:  # e.g. a name written only in a non-Latin script
        slug = current.slug if current is not None else f"category-{secrets.token_hex(3)}"
    clash = select(CatalogueCategory).where(CatalogueCategory.slug == slug)
    if current is not None:
        clash = clash.where(CatalogueCategory.id != current.id)
    if db.scalars(clash).first() is not None:
        raise ConflictError("That name is too similar to an existing category.")
    return cleaned, slug


def _flush(db: Session, message: str) -> None:
    """Flush, turning a unique-constraint race into a 409 instead of a 500."""
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(message) from exc


def create_category(db: Session, name: str, *, by: Employee, client: ClientInfo) -> CatalogueCategory:
    cleaned, slug = _category_name_and_slug(db, name)
    category = CatalogueCategory(name=cleaned, slug=slug)
    db.add(category)
    _flush(db, "A category with that name already exists.")
    record_event(db, "catalogue.category_created", actor=by, target=category, client=client, details={"name": cleaned})
    return category


def rename_category(
    db: Session, category: CatalogueCategory, name: str, *, by: Employee, client: ClientInfo
) -> CatalogueCategory:
    cleaned, slug = _category_name_and_slug(db, name, current=category)
    if cleaned == category.name:
        return category
    old_name = category.name
    category.name, category.slug = cleaned, slug
    _flush(db, "A category with that name already exists.")
    record_event(
        db, "catalogue.category_renamed", actor=by, target=category, client=client,
        details={"from": old_name, "to": cleaned},
    )  # fmt: skip
    return category


def delete_category(db: Session, category: CatalogueCategory, *, by: Employee, client: ClientInfo) -> None:
    if product_count(db, category):
        raise ConflictError("Move or delete the products in this category first.")
    record_event(db, "catalogue.category_deleted", actor=by, target=category, client=client, details={"name": category.name})
    db.delete(category)
    _flush(db, "Move or delete the products in this category first.")


# --- products ---------------------------------------------------------------


def list_products(db: Session) -> Sequence[CatalogueProduct]:
    return db.scalars(select(CatalogueProduct).order_by(func.lower(CatalogueProduct.name))).all()


def get_product(db: Session, product_id: object) -> CatalogueProduct:
    product = db.get(CatalogueProduct, product_id)
    if product is None:
        raise NotFoundError("That product doesn't exist.")
    return product


def _unused_slug(db: Session, base: str, *, exclude: CatalogueProduct | None = None) -> str:
    base = base or f"product-{secrets.token_hex(3)}"
    candidate, number = base, 2
    while True:
        query = select(CatalogueProduct.id).where(CatalogueProduct.slug == candidate)
        if exclude is not None:
            query = query.where(CatalogueProduct.id != exclude.id)
        if db.scalars(query).first() is None:
            return candidate
        suffix = f"-{number}"
        candidate = base[: SLUG_MAX_LENGTH - len(suffix)].rstrip("-") + suffix
        number += 1


def _check_slug_free(db: Session, slug: str, *, exclude: CatalogueProduct | None = None) -> None:
    if _unused_slug(db, slug, exclude=exclude) != slug:
        raise ConflictError("Another product already uses that web address.")


def _set_published(product: CatalogueProduct, published: bool) -> None:
    product.is_published = published
    product.published_at = utcnow() if published else None


def create_product(db: Session, fields: dict[str, Any], *, by: Employee, client: ClientInfo) -> CatalogueProduct:
    """`fields` are the validated request fields (see `ProductCreate`)."""
    name = _single_line(fields["name"], field="product name", max_length=120, required=True)
    assert name is not None
    if fields.get("slug"):
        slug = _explicit_slug(fields["slug"])
        _check_slug_free(db, slug)
    else:
        slug = _unused_slug(db, slugify(name))
    price, currency = _price(fields.get("price"), fields.get("currency"))
    category_id = fields.get("category_id")
    if category_id is not None:
        get_category(db, category_id)

    product = CatalogueProduct(
        name=name,
        slug=slug,
        summary=_single_line(fields.get("summary") or "", field="summary", max_length=200),
        description=_description(fields.get("description")),
        category_id=category_id,
        price=price,
        currency=currency,
        created_by_id=by.id,
        updated_by_id=by.id,
    )
    _set_published(product, bool(fields.get("is_published")))
    db.add(product)
    _flush(db, "Another product already uses that web address.")
    db.refresh(product)
    record_event(
        db, "catalogue.product_created", actor=by, target=product, client=client,
        details={"name": name, "published": product.is_published},
    )  # fmt: skip
    return product


def update_product(
    db: Session, product: CatalogueProduct, changes: dict[str, Any], *, by: Employee, client: ClientInfo
) -> CatalogueProduct:
    """`changes` holds only the fields the request sent (see `ProductUpdate`)."""
    new: dict[str, Any] = {}
    if "name" in changes:
        if changes["name"] is None:
            raise InvalidCatalogueEntryError("Enter a product name.")
        new["name"] = _single_line(changes["name"], field="product name", max_length=120, required=True)
    if "slug" in changes and changes["slug"] is not None:
        new["slug"] = _explicit_slug(changes["slug"])
        _check_slug_free(db, new["slug"], exclude=product)
    if "summary" in changes:
        new["summary"] = _single_line(changes["summary"] or "", field="summary", max_length=200)
    if "description" in changes:
        new["description"] = _description(changes["description"])
    if "category_id" in changes:
        if changes["category_id"] is not None:
            get_category(db, changes["category_id"])
        new["category_id"] = changes["category_id"]
    if "price" in changes or "currency" in changes:
        price = changes["price"] if "price" in changes else product.price
        currency = changes["currency"] if "currency" in changes else product.currency
        new["price"], new["currency"] = _price(price, currency)

    changed = sorted(field for field, value in new.items() if getattr(product, field) != value)
    for field in changed:
        setattr(product, field, new[field])

    publish = changes.get("is_published")
    publish_changed = publish is not None and publish != product.is_published
    if publish_changed:
        _set_published(product, bool(publish))

    if not changed and not publish_changed:
        return product
    product.updated_by_id = by.id
    _flush(db, "Another product already uses that web address.")
    db.refresh(product)
    if changed:
        record_event(db, "catalogue.product_updated", actor=by, target=product, client=client, details={"fields": changed})
    if publish_changed:
        action = "catalogue.product_published" if product.is_published else "catalogue.product_unpublished"
        record_event(db, action, actor=by, target=product, client=client, details={"name": product.name})
    return product


def delete_product(db: Session, product: CatalogueProduct, *, by: Employee, client: ClientInfo) -> None:
    record_event(
        db, "catalogue.product_deleted", actor=by, target=product, client=client,
        details={"name": product.name, "slug": product.slug},
    )  # fmt: skip
    db.delete(product)
    db.flush()


# --- public reads -----------------------------------------------------------


def published_products(db: Session) -> Sequence[CatalogueProduct]:
    return db.scalars(
        select(CatalogueProduct).where(CatalogueProduct.is_published.is_(True)).order_by(func.lower(CatalogueProduct.name))
    ).all()


def published_product(db: Session, slug: str) -> CatalogueProduct:
    """A published product by slug. Drafts answer exactly like missing products."""
    product = db.scalars(
        select(CatalogueProduct).where(CatalogueProduct.slug == slug, CatalogueProduct.is_published.is_(True))
    ).one_or_none()
    if product is None:
        raise NotFoundError("That product isn't available.")
    return product
