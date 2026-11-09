"""The administrators' inbox for contact-form messages (`enquiries.view`, Administrator only).

Enquiries are personal data: they are read here only, never audited with their contents.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.api.v1.pagination import Ordering, PageParamsDep, paginate, sort_dependency
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.enquiries import Enquiry
from app.schemas.enquiries import EnquiryOut
from app.schemas.errors import ErrorResponse
from app.schemas.pagination import Page
from app.services import enquiries as service
from app.services.audit import ClientInfo

router = APIRouter(
    tags=["enquiries"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "Administrators only, or the CSRF token is missing"},
    },
)

Admin = Annotated[Principal, Depends(require_permission(Permission.ENQUIRIES_VIEW))]
Sort = sort_dependency({"created_at": Enquiry.created_at}, default="-created_at", tiebreaker=Enquiry.id)


@router.get("/enquiries", response_model=Page[EnquiryOut], summary="Contact-form messages, newest first")
def list_enquiries(
    _: Admin,
    db: SessionDep,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(Sort)],
    unread: Annotated[bool | None, Query(description="`true`: only unread. `false`: only read.")] = None,
) -> Page[EnquiryOut]:
    items, total = paginate(db, service.inbox_query(unread=unread), page, order)
    return Page.of([EnquiryOut.from_enquiry(e) for e in items], total=total, limit=page.limit, offset=page.offset)


@router.post(
    "/enquiries/{enquiry_id}/read",
    response_model=EnquiryOut,
    summary="Mark a message as read",
    responses={404: {"model": ErrorResponse, "description": "No such enquiry"}},
)
def mark_read(enquiry_id: uuid.UUID, request: Request, principal: Admin, db: SessionDep) -> EnquiryOut:
    enquiry = service.mark_read(db, enquiry_id, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return EnquiryOut.from_enquiry(enquiry)
