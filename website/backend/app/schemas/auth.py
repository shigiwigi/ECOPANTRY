import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.auth.permissions import RoleCode
from app.models.auth import Employee


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    # Not checked against the password rules here: that happens when a password is set.
    password: str = Field(min_length=1, max_length=1024)


class GoogleSignInRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=8192, description="Firebase Authentication ID token from Google sign-in.")


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=1, max_length=1024)


class StaffUser(BaseModel):
    """The signed-in employee as the portal sees them."""

    id: uuid.UUID
    name: str
    email: str
    role: RoleCode
    role_name: str
    permissions: list[str] = Field(description="Permission codes granted by the role, sorted.")

    @classmethod
    def from_employee(cls, employee: Employee, permissions: frozenset[str]) -> "StaffUser":
        return cls(
            id=employee.id,
            name=employee.full_name,
            email=employee.email,
            role=RoleCode(employee.role.code),
            role_name=employee.role.name,
            permissions=sorted(permissions),
        )


class SessionResponse(BaseModel):
    user: StaffUser
    csrf_token: str = Field(description="Send in the X-CSRF-Token header on POST, PUT, PATCH and DELETE requests.")
    expires_at: datetime = Field(description="When the session ends if there is no further activity.")
