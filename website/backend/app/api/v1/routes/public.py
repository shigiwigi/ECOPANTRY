"""Endpoints for the public customer website. No sign-in.

Only explicitly public data lives here: published catalogue products and
their categories, through the `Public*` schemas. Never add stock quantities,
batches, suppliers, employees, sensor readings, waste or compliance records.
These routes don't read the staff session cookie. Each one is listed in
`tests/test_route_protection.py` as deliberately public.
"""

from fastapi import APIRouter, Request, status

from app.db.session import SessionDep
from app.schemas.catalogue import PublicCatalogueOut, PublicCategoryOut, PublicProductDetailOut, PublicProductOut
from app.schemas.enquiries import PublicEnquiryAccepted, PublicEnquiryCreate
from app.schemas.errors import ErrorResponse
from app.services import catalogue as service
from app.services import enquiries as enquiry_service
from app.services.audit import ClientInfo

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


@router.post(
    "/enquiries",
    response_model=PublicEnquiryAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Send a message through the contact form",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid name, email or message"},
        429: {"model": ErrorResponse, "description": "Too many messages from this address or email recently"},
    },
)
def send_enquiry(body: PublicEnquiryCreate, request: Request, db: SessionDep) -> PublicEnquiryAccepted:
    """Store a contact-form message for the administrators. Never echoes what was sent.

    The hidden `website` field is a honeypot: when filled, the request is acknowledged exactly like
    a real one (so bots can't tell) but nothing is stored or counted. This route reads no cookies.
    """
    if body.website and body.website.strip():
        return PublicEnquiryAccepted()
    limiter = getattr(request.app.state, "enquiry_limiter", None)
    if limiter is None:
        limiter = request.app.state.enquiry_limiter = enquiry_service.SlidingWindowLimiter()
    enquiry_service.create_enquiry(db, name=body.name, email=body.email, message=body.message)
    enquiry_service.check_rate_limit(limiter, ip=ClientInfo.from_request(request).ip_address, email=body.email)
    db.commit()
    return PublicEnquiryAccepted()
