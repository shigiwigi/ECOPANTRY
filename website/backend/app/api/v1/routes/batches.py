"""Batches: receiving stock, listing, details with movement history, consuming and adjusting.

Reading needs `batches.view` (every role); changes need `batches.manage`
(administrators and storekeepers, never inspectors). Stock only changes through
the consume and adjust endpoints; looking a batch up (including by scanning its
QR label, `GET /batches/by-label/{code}`) never changes anything. Each change is
attributed to the signed-in employee and audited in the same transaction.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.pagination import Ordering, PageParamsDep, SearchQuery, clean_search, paginate, sort_dependency
from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.inventory import Batch, Ingredient
from app.schemas.batches import (
    AdjustRequest,
    BatchDetail,
    BatchLookup,
    BatchOut,
    BatchReceive,
    BatchStatus,
    ConsumeRequest,
    MovementOut,
)
from app.schemas.errors import ErrorResponse
from app.schemas.pagination import Page
from app.services import batches as service
from app.services.audit import ClientInfo
from app.services.batch_labels import CODE_PATTERN

router = APIRouter(
    prefix="/batches",
    tags=["batches"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.BATCHES_VIEW))]
Manager = Annotated[Principal, Depends(require_permission(Permission.BATCHES_MANAGE))]
LabelCode = Annotated[
    str,
    Path(pattern=CODE_PATTERN, description="The code from a batch label: 10 characters of Crockford base32."),
]
NOT_FOUND: dict[int | str, dict[str, object]] = {404: {"model": ErrorResponse, "description": "No such batch"}}
STOCK_ERRORS: dict[int | str, dict[str, object]] = {
    **NOT_FOUND,
    400: {"model": ErrorResponse, "description": "Invalid value, e.g. a missing reason"},
    409: {"model": ErrorResponse, "description": "`insufficient_stock`: less remains than was asked for"},
}

BatchSort = sort_dependency(
    {
        "expiry_on": Batch.expiry_on,
        "received_on": Batch.received_on,
        "created_at": Batch.created_at,
        "remaining_quantity": Batch.remaining_quantity,
        "ingredient": func.lower(Ingredient.name),
    },
    default="expiry_on",  # FEFO: earliest expiry first
    tiebreaker=Batch.id,
)


def _out(batch: Batch) -> BatchOut:
    return BatchOut.from_batch(batch, service.status_of(batch))


def _detail(db: Session, batch: Batch) -> BatchDetail:
    movements = [
        MovementOut(
            id=m.id, kind=m.kind, quantity_delta=m.quantity_delta,  # type: ignore[arg-type]
            remaining_after=m.remaining_after, reason=m.reason, employee_name=name, created_at=m.created_at,
        )  # fmt: skip
        for m, name in service.movements_of(db, batch)
    ]
    return BatchDetail(**_out(batch).model_dump(), movements=movements)


@router.get("", response_model=Page[BatchOut], summary="List batches (earliest expiry first by default)")
def list_batches(
    _: Viewer,
    db: SessionDep,
    page: PageParamsDep,
    order: Annotated[Ordering, Depends(BatchSort)],
    q: SearchQuery = None,
    ingredient_id: uuid.UUID | None = None,
    storage_area_id: uuid.UUID | None = None,
    batch_status: Annotated[BatchStatus | None, Query(alias="status")] = None,
    has_stock: Annotated[bool | None, Query(description="`true`: stock remains; `false`: used up.")] = None,
) -> Page[BatchOut]:
    statement = service.batches_query(
        ingredient_id=ingredient_id,
        storage_area_id=storage_area_id,
        status=batch_status,
        has_stock=has_stock,
        search=clean_search(q),
    )
    items, total = paginate(db, statement, page, order)
    return Page.of([_out(b) for b in items], total=total, limit=page.limit, offset=page.offset)


@router.post(
    "",
    response_model=BatchDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Receive a batch: creates it with its label code and the single `in` movement",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid value, e.g. use-by date before the received date"},
        404: {"model": ErrorResponse, "description": "Unknown ingredient or storage area"},
    },
)
def receive_batch(body: BatchReceive, request: Request, principal: Manager, db: SessionDep) -> BatchDetail:
    batch = service.receive_batch(db, body.model_dump(), by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return _detail(db, batch)


@router.get(
    "/by-label/{code}",
    response_model=BatchLookup,
    summary="Look up the batch a QR label points to (read-only; scanning never changes stock)",
    responses={404: {"model": ErrorResponse, "description": "No batch has that label code"}},
)
def batch_by_label(code: LabelCode, _: Viewer, db: SessionDep) -> BatchLookup:
    batch = service.lookup_by_label(db, code)
    area = batch.storage_area
    return BatchLookup(
        batch_id=batch.id,
        code=batch.label_code,
        ingredient_name=batch.ingredient.name,
        received_on=batch.received_on,
        expires_on=batch.expiry_on,
        status="used_up" if batch.remaining_quantity <= 0 else "in_stock",
        remaining_quantity=batch.remaining_quantity,
        unit=batch.ingredient.unit.code,
        storage_location=area.name if area else None,
    )


@router.get("/{batch_id}", response_model=BatchDetail, summary="Get one batch with its movement history", responses=NOT_FOUND)
def get_batch(batch_id: uuid.UUID, _: Viewer, db: SessionDep) -> BatchDetail:
    return _detail(db, service.get_batch(db, batch_id))


@router.post(
    "/{batch_id}/consume",
    response_model=BatchDetail,
    summary="Take stock out of a batch. Refused (409) if less than that remains.",
    responses=STOCK_ERRORS,
)
def consume_batch(
    batch_id: uuid.UUID, body: ConsumeRequest, request: Request, principal: Manager, db: SessionDep
) -> BatchDetail:
    batch = service.consume(
        db, batch_id, body.quantity, reason=body.reason, by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return _detail(db, batch)


@router.post(
    "/{batch_id}/adjust",
    response_model=BatchDetail,
    summary="Correct a batch's remaining quantity by a signed amount; a reason is required",
    responses=STOCK_ERRORS,
)
def adjust_batch(
    batch_id: uuid.UUID, body: AdjustRequest, request: Request, principal: Manager, db: SessionDep
) -> BatchDetail:
    batch = service.adjust(
        db, batch_id, body.delta, reason=body.reason, by=principal.employee, client=ClientInfo.from_request(request)
    )
    db.commit()
    return _detail(db, batch)
