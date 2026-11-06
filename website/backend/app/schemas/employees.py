import secrets
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.auth.permissions import RoleCode
from app.models.auth import Employee


class EmployeeOut(BaseModel):
    """A staff account. Never includes the password hash or lockout counters."""

    id: uuid.UUID
    email: str
    name: str
    role: str
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
            role=employee.role.code,
            role_name=employee.role.name,
            status="active" if employee.is_active else "disabled",
            last_login_at=employee.last_login_at,
            created_at=employee.created_at,
            deactivated_at=employee.deactivated_at,
        )


class EmployeeCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="storekeeper")
    password: str | None = Field(
        default=None,
        description="Initial password; if not provided, a random one is generated.",
    )

    def get_password(self) -> str:
        return self.password if self.password else secrets.token_urlsafe(16)