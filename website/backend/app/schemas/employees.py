import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.auth.permissions import RoleCode
from app.models.auth import Employee


class EmployeeOut(BaseModel):
    """A staff account. Never includes the password hash or lockout counters."""

    id: uuid.UUID
    email: str
    name: str
    role: RoleCode
    role_name: str
    status: Literal["active", "disabled"]
    last_login_at: datetime | None
    created_at: datetime
    deactivated_at: datetime | None

    @classmethod
    def from_employee(cls, employee: Employee) -> "EmployeeOut":
        return cls(
            id=employee.id,
            email=employee.email,
            name=employee.full_name,
            role=RoleCode(employee.role.code),
            role_name=employee.role.name,
            status="active" if employee.is_active else "disabled",
            last_login_at=employee.last_login_at,
            created_at=employee.created_at,
            deactivated_at=employee.deactivated_at,
        )


class EmployeeCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=120)
    role: RoleCode
    password: str | None = Field(
        default=None,
        min_length=1,
        max_length=1024,
        description=(
            "Initial password (12-128 characters); share it with the employee in person. "
            "Leave it out for an account that signs in with Google only, until a password is set."
        ),
    )


class EmployeeUpdate(BaseModel):
    """Changes an administrator can make to an account. Only the role, for now."""

    model_config = ConfigDict(extra="forbid")

    role: RoleCode


class PasswordReset(BaseModel):
    password: str = Field(min_length=1, max_length=1024)
