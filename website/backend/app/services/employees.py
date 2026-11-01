"""Staff account lifecycle: create, deactivate, reactivate, reset password.

Used by the admin API and by `python -m app.cli`. Callers commit.
"""

import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.auth.service import check_new_password, normalize_email, revoke_all_sessions, utcnow
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.security import hash_password
from app.models.auth import Employee, Role
from app.services.audit import CLI, ActorType, ClientInfo, record_event

# Deliberately loose: one @, something on each side, a dot in the domain, no spaces.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InvalidEmployeeError(AppError):
    status_code = 400
    code = "invalid_employee"


def _validated_email(email: str) -> str:
    normalized = normalize_email(email)
    if len(normalized) > 254 or not _EMAIL.match(normalized):
        raise InvalidEmployeeError("Enter a valid email address.")
    return normalized


def _validated_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned or len(cleaned) > 120:
        raise InvalidEmployeeError("Enter a name of 1 to 120 characters.")
    return cleaned


def get_role(db: Session, code: RoleCode) -> Role:
    role = db.scalars(select(Role).where(Role.code == code.value)).one_or_none()
    if role is None:  # Only if migrations haven't run.
        raise RuntimeError(f"Role {code.value!r} is missing; run `alembic upgrade head`.")
    return role


def get_employee(db: Session, employee_id: object) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError("That staff account doesn't exist.")
    return employee


def find_by_email(db: Session, email: str) -> Employee | None:
    return db.scalars(select(Employee).where(Employee.email == normalize_email(email))).one_or_none()


def active_admin_count(db: Session) -> int:
    statement = (
        select(func.count())
        .select_from(Employee)
        .join(Role)
        .where(Role.code == RoleCode.ADMIN.value, Employee.status == "active")
    )
    return int(db.scalar(statement) or 0)


def create_employee(
    db: Session,
    *,
    email: str,
    full_name: str,
    role: RoleCode,
    password: str,
    created_by: Employee | None,
    actor_type: ActorType = "employee",
    client: ClientInfo = CLI,
) -> Employee:
    email = _validated_email(email)
    full_name = _validated_name(full_name)
    check_new_password(password, email)
    if find_by_email(db, email) is not None:
        raise ConflictError("A staff account with that email already exists.")

    employee = Employee(
        email=email,
        full_name=full_name,
        role=get_role(db, role),
        password_hash=hash_password(password),
        password_changed_at=utcnow(),
        created_by_id=created_by.id if created_by else None,
    )
    db.add(employee)
    db.flush()
    record_event(
        db, "employee.created", actor=created_by, actor_type=actor_type, target=employee, client=client,
        details={"role": role.value},
    )  # fmt: skip
    return employee


def deactivate_employee(
    db: Session, employee: Employee, *, by: Employee | None, actor_type: ActorType = "employee", client: ClientInfo = CLI
) -> Employee:
    if by is not None and by.id == employee.id:
        raise ConflictError("You can't deactivate your own account.")
    if not employee.is_active:
        return employee
    if employee.role.code == RoleCode.ADMIN.value and active_admin_count(db) <= 1:
        raise ConflictError("This is the only active administrator. Add another administrator first.")

    employee.status = "disabled"
    employee.deactivated_at = utcnow()
    revoked = revoke_all_sessions(db, employee.id, "account_deactivated")
    record_event(
        db, "employee.deactivated", actor=by, actor_type=actor_type, target=employee, client=client,
        details={"sessions_revoked": revoked},
    )  # fmt: skip
    return employee


def reactivate_employee(
    db: Session, employee: Employee, *, by: Employee | None, actor_type: ActorType = "employee", client: ClientInfo = CLI
) -> Employee:
    if employee.is_active:
        return employee
    employee.status = "active"
    employee.deactivated_at = None
    employee.failed_login_attempts = 0
    employee.locked_until = None
    record_event(db, "employee.reactivated", actor=by, actor_type=actor_type, target=employee, client=client)
    return employee


def reset_password(
    db: Session, employee: Employee, password: str, *, by: Employee | None, actor_type: ActorType = "employee",
    client: ClientInfo = CLI,
) -> Employee:  # fmt: skip
    """Set a new password for someone else (or via the CLI). Signs out all their sessions and clears any lockout."""
    check_new_password(password, employee.email)
    employee.password_hash = hash_password(password)
    employee.password_changed_at = utcnow()
    employee.failed_login_attempts = 0
    employee.locked_until = None
    revoked = revoke_all_sessions(db, employee.id, "password_changed")
    record_event(
        db, "employee.password_reset", actor=by, actor_type=actor_type, target=employee, client=client,
        details={"sessions_revoked": revoked},
    )  # fmt: skip
    return employee
