"""Staff accounts. Viewing needs `employees.view`; changes need `employees.manage` (administrators).

There is no delete: employees are never deleted, so the audit log keeps its
actors. Deactivate an account to remove access.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.schemas.employees import EmployeeCreate, EmployeeOut, EmployeeUpdate, PasswordReset
from app.schemas.errors import ErrorResponse
from app.services import employees as service
from app.services.audit import ClientInfo

router = APIRouter(
    prefix="/employees",
    tags=["employees"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks the permission, or the CSRF token is missing"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.EMPLOYEES_VIEW))]
Manager = Annotated[Principal, Depends(require_permission(Permission.EMPLOYEES_MANAGE))]

NOT_FOUND = {404: {"model": ErrorResponse, "description": "No such account"}}


@router.get("", response_model=list[EmployeeOut], summary="List staff accounts")
def list_employees(
    _: Viewer,
    db: SessionDep,
    active: Annotated[bool | None, Query(description="true: only active accounts; false: only deactivated ones")] = None,
) -> list[EmployeeOut]:
    return [EmployeeOut.from_employee(employee) for employee in service.list_employees(db, active=active)]


@router.post(
    "",
    response_model=EmployeeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a staff account",
    responses={409: {"model": ErrorResponse, "description": "An account with that email already exists (`conflict`)"}},
)
def create_employee(body: EmployeeCreate, request: Request, principal: Manager, db: SessionDep) -> EmployeeOut:
    employee = service.create_employee(
        db,
        email=body.email,
        full_name=body.name,
        role=body.role,
        password=body.password,
        created_by=principal.employee,
        client=ClientInfo.from_request(request),
    )
    db.commit()
    return EmployeeOut.from_employee(employee)


@router.patch(
    "/{employee_id}",
    response_model=EmployeeOut,
    summary="Change an account's role. Signs them out everywhere.",
    responses={
        **NOT_FOUND,
        409: {"model": ErrorResponse, "description": "Your own role, or the last active administrator"},
    },
)
def update_employee(
    employee_id: uuid.UUID, body: EmployeeUpdate, request: Request, principal: Manager, db: SessionDep
) -> EmployeeOut:
    employee = service.get_employee(db, employee_id)
    service.change_role(db, employee, body.role, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return EmployeeOut.from_employee(employee)


@router.post(
    "/{employee_id}/deactivate", response_model=EmployeeOut, summary="Deactivate and sign out everywhere", responses=NOT_FOUND
)
def deactivate(employee_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> EmployeeOut:
    employee = service.get_employee(db, employee_id)
    service.deactivate_employee(db, employee, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return EmployeeOut.from_employee(employee)


@router.post(
    "/{employee_id}/reactivate", response_model=EmployeeOut, summary="Reactivate a deactivated account", responses=NOT_FOUND
)
def reactivate(employee_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> EmployeeOut:
    employee = service.get_employee(db, employee_id)
    service.reactivate_employee(db, employee, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return EmployeeOut.from_employee(employee)


@router.post(
    "/{employee_id}/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set a new password for someone else. Signs them out everywhere.",
    responses=NOT_FOUND,
)
def reset_password(employee_id: uuid.UUID, body: PasswordReset, request: Request, principal: Manager, db: SessionDep) -> None:
    employee = service.get_employee(db, employee_id)
    service.reset_password(db, employee, body.password, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
