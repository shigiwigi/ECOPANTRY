"""Staff accounts. Viewing needs `employees.view`; changes need `employees.manage` (administrators)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.auth.dependencies import require_permission
from app.auth.permissions import Permission, RoleCode
from app.auth.service import Principal
from app.db.session import SessionDep
from app.models.auth import AuthSession, Employee, Role
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

ROLE_ALIAS_MAP = {
    "shopkeeper": "storekeeper",
    "storekeeper": "storekeeper",
    "food_inspector": "inspector",
    "inspector": "inspector",
    "admin": "admin",
    "administrator": "admin",
}


class PasswordReset(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class EmployeeUpdateRole(BaseModel):
    role: str = Field(..., description="Role code: admin, shopkeeper, or food_inspector")


@router.get("", response_model=list[EmployeeOut], summary="List staff accounts")
def list_employees(_: Viewer, db: SessionDep) -> list[EmployeeOut]:
    employees = db.scalars(
        select(Employee)
        .where(Employee.status == "active")
        .order_by(Employee.full_name, Employee.email)
    ).all()
    return [EmployeeOut.from_employee(employee) for employee in employees]


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED, summary="Create or re-authorize a staff account")
def create_employee(body: EmployeeCreate, request: Request, principal: Manager, db: SessionDep) -> EmployeeOut:
    target_role_str = ROLE_ALIAS_MAP.get(body.role.lower().strip(), body.role.lower().strip())
    
    try:
        target_role_enum = RoleCode(target_role_str)
    except ValueError:
        target_role_enum = RoleCode.STOREKEEPER

    normalized_email = body.email.lower().strip()

    # 1. Check if the account already exists
    existing = db.scalar(select(Employee).where(Employee.email == normalized_email))
    
    if existing:
        # If it's already active, return a 400 error
        if existing.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A staff account with that email is already active.",
            )
        
        # If it was previously disabled/deleted, reactivate it and re-assign the role
        target_role_code = target_role_enum.value
        role_obj = db.scalar(select(Role).where(Role.code == target_role_code))
        if not role_obj:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid role: {body.role}")

        existing.status = "active"
        existing.deactivated_at = None
        existing.role_id = role_obj.id
        if body.name.strip():
            existing.full_name = body.name.strip()
        
        # Reset password hash and login state so they can claim/register anew
        existing.password_hash = "!oauth_pending_registration"
        existing.last_login_at = None
        existing.failed_login_attempts = 0
        existing.locked_until = None

        db.commit()
        db.refresh(existing)
        return EmployeeOut.from_employee(existing)

    # 2. Fresh creation for a new email
    employee = service.create_employee(
        db,
        email=normalized_email,
        full_name=body.name.strip(),
        role=target_role_enum,
        password=body.get_password(),
        created_by=principal.employee,
        client=ClientInfo.from_request(request),
    )
    db.commit()
    return EmployeeOut.from_employee(employee)


@router.patch("/{employee_id}", response_model=EmployeeOut, summary="Update employee role")
def update_employee_role(
    employee_id: uuid.UUID,
    body: EmployeeUpdateRole,
    principal: Manager,
    db: SessionDep,
) -> EmployeeOut:
    employee = db.scalar(select(Employee).where(Employee.id == employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    target_code = ROLE_ALIAS_MAP.get(body.role.lower().strip(), body.role.lower().strip())
    role_obj = db.scalar(select(Role).where(Role.code == target_code))
    if not role_obj:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid role: {body.role}")

    employee.role_id = role_obj.id
    db.commit()
    db.refresh(employee)
    return EmployeeOut.from_employee(employee)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an employee account")
def delete_employee(
    employee_id: uuid.UUID,
    principal: Manager,
    db: SessionDep,
) -> Response:
    employee = db.scalar(select(Employee).where(Employee.id == employee_id))
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    if employee.id == principal.employee.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own active administrator account.",
        )

    # 1. Revoke and delete active browser sessions
    db.execute(delete(AuthSession).where(AuthSession.employee_id == employee_id))

    # 2. Nullify references where this user created other accounts
    other_employees = db.scalars(select(Employee).where(Employee.created_by_id == employee_id)).all()
    for other in other_employees:
        other.created_by_id = None

    db.flush()

    try:
        # 3. Attempt direct database deletion
        db.delete(employee)
        db.commit()
    except Exception:
        db.rollback()
        # 4. If foreign keys (like audit history) restrict hard delete, deactivate so they never show up
        emp_to_disable = db.scalar(select(Employee).where(Employee.id == employee_id))
        if emp_to_disable:
            emp_to_disable.status = "disabled"
            emp_to_disable.deactivated_at = func.now()
            db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


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