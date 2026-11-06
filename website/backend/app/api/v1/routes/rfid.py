"""RFID cards for staff: who holds which card, recent taps, assign and revoke."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.core.errors import NotFoundError
from app.db.session import SessionDep
from app.models.auth import Employee
from app.schemas.errors import ErrorResponse
from app.schemas.rfid import CardAssign, CardOut, ScanOut
from app.services import rfid as service
from app.services.audit import ClientInfo

router = APIRouter(
    prefix="/rfid",
    tags=["rfid"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.EMPLOYEES_VIEW))]
Manager = Annotated[Principal, Depends(require_permission(Permission.EMPLOYEES_MANAGE))]


@router.get("/cards", response_model=list[CardOut], summary="All cards, active first")
def list_cards(_: Viewer, db: SessionDep) -> list[CardOut]:
    return [CardOut.from_card(card) for card in service.list_cards(db)]


@router.post(
    "/cards",
    response_model=CardOut,
    status_code=status.HTTP_201_CREATED,
    summary="Give a card to an employee",
    responses={409: {"model": ErrorResponse, "description": "The card is already assigned, or the account is inactive"}},
)
def assign_card(body: CardAssign, request: Request, principal: Manager, db: SessionDep) -> CardOut:
    employee = db.get(Employee, body.employee_id)
    if employee is None:
        raise NotFoundError("No staff account has that id.")
    card = service.assign_card(db, body.uid, employee, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return CardOut.from_card(card)


@router.post("/cards/{card_id}/revoke", response_model=CardOut, summary="Stop a card from being accepted")
def revoke_card(card_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> CardOut:
    card = service.get_card(db, card_id)
    service.revoke_card(db, card, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return CardOut.from_card(card)


@router.get("/scans", response_model=list[ScanOut], summary="Recent card taps on any station, newest first")
def list_scans(_: Viewer, db: SessionDep, limit: int = Query(default=20, ge=1, le=100)) -> list[ScanOut]:
    return [ScanOut.from_scan(scan) for scan in service.list_scans(db, limit)]
