"""Staff accounts, roles, permissions and sessions. See docs/AUTH_DESIGN.md."""

import uuid
from datetime import datetime
from typing import ClassVar

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Table,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

EMPLOYEE_STATUSES = ("active", "disabled")
SESSION_REVOKE_REASONS = ("logout", "password_changed", "account_deactivated", "replaced")

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", SmallInteger, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", SmallInteger, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(SmallInteger, Identity(), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text)

    permissions: Mapped[list["Permission"]] = relationship(secondary=role_permissions, lazy="selectin")


class Permission(Base):
    __tablename__ = "permissions"
    __table_args__ = (CheckConstraint(r"code ~ '^[a-z_]+\.[a-z_]+$'", name="code_format"),)

    id: Mapped[int] = mapped_column(SmallInteger, Identity(), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    description: Mapped[str] = mapped_column(Text)


class Employee(Base):
    """A staff member who can sign in to the management portal. Never deleted; deactivate instead."""

    __tablename__ = "employees"
    audit_target_type: ClassVar[str] = "employee"
    __table_args__ = (
        CheckConstraint("email = lower(btrim(email))", name="email_normalized"),
        CheckConstraint("length(btrim(full_name)) > 0", name="full_name_not_blank"),
        CheckConstraint(f"status IN {EMPLOYEE_STATUSES!r}", name="status_valid"),
        CheckConstraint("failed_login_attempts >= 0", name="failed_login_attempts_non_negative"),
        CheckConstraint("(status = 'disabled') = (deactivated_at IS NOT NULL)", name="deactivated_at_matches_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    role_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("roles.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    password_hash: Mapped[str] = mapped_column(Text)
    password_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    role: Mapped[Role] = relationship(lazy="joined", innerjoin=True)

    @property
    def is_active(self) -> bool:
        return self.status == "active"

    def __repr__(self) -> str:  # Keeps the password hash out of logs and tracebacks.
        return f"<Employee {self.id} {self.status}>"


class AuthSession(Base):
    """A signed-in browser. The cookie holds a random token; only its SHA-256 is stored here."""

    __tablename__ = "auth_sessions"
    __table_args__ = (
        CheckConstraint(
            f"revoked_reason IS NULL OR revoked_reason IN {SESSION_REVOKE_REASONS!r}", name="revoked_reason_valid"
        ),
        CheckConstraint("(revoked_at IS NULL) = (revoked_reason IS NULL)", name="revoked_reason_matches"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(32))
    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(255))

    employee: Mapped[Employee] = relationship(lazy="joined", innerjoin=True)

    def __repr__(self) -> str:  # Never include token material.
        return f"<AuthSession {self.id}>"
