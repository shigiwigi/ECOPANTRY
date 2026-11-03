"""Staff accounts. Viewing needs `employees.view`; changes need `employees.manage` (administrators)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.auth import Employee
from app.schemas.employees import EmployeeCreate, EmployeeOut
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


class PasswordReset(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


@router.get("", response_model=list[EmployeeOut], summary="List staff accounts")
def list_employees(_: Viewer, db: SessionDep) -> list[EmployeeOut]:
    employees = db.scalars(select(Employee).order_by(Employee.full_name, Employee.email)).all()
    return [EmployeeOut.from_employee(employee) for employee in employees]


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED, summary="Create a staff account")
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


@router.post("/{employee_id}/deactivate", response_model=EmployeeOut, summary="Deactivate and sign out everywhere")
def deactivate(employee_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> EmployeeOut:
    employee = service.get_employee(db, employee_id)
    service.deactivate_employee(db, employee, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return EmployeeOut.from_employee(employee)


@router.post("/{employee_id}/reactivate", response_model=EmployeeOut, summary="Reactivate a deactivated account")
def reactivate(employee_id: uuid.UUID, request: Request, principal: Manager, db: SessionDep) -> EmployeeOut:
    employee = service.get_employee(db, employee_id)
    service.reactivate_employee(db, employee, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
    return EmployeeOut.from_employee(employee)


@router.post(
    "/{employee_id}/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set a new password for someone else. Signs them out everywhere.",
)
def reset_password(employee_id: uuid.UUID, body: PasswordReset, request: Request, principal: Manager, db: SessionDep) -> None:
    employee = service.get_employee(db, employee_id)
    service.reset_password(db, employee, body.password, by=principal.employee, client=ClientInfo.from_request(request))
    db.commit()
