"""Staff account lifecycle: create, change role, deactivate, reactivate, reset password.

Used by the admin API and by `python -m app.cli`. Callers commit. Employees are
never deleted (audit history keeps its actor); deactivation removes access.
"""

import re
import secrets

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


def list_employees(db: Session, *, active: bool | None = None) -> list[Employee]:
    """All staff accounts, or only active (True) or only deactivated (False) ones, by name."""
    statement = select(Employee).order_by(Employee.full_name, Employee.email)
    if active is not None:
        statement = statement.where(Employee.status == ("active" if active else "disabled"))
    return list(db.scalars(statement))


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
    password: str | None,
    created_by: Employee | None,
    actor_type: ActorType = "employee",
    client: ClientInfo = CLI,
) -> Employee:
    """Create an active account.

    Without `password` the account can only sign in with Google (same email)
    until an administrator sets a password: it gets the hash of a random
    secret that is thrown away, so no typed password matches it.
    """
    email = _validated_email(email)
    full_name = _validated_name(full_name)
    if password is not None:
        check_new_password(password, email)
    if find_by_email(db, email) is not None:
        raise ConflictError("A staff account with that email already exists.")

    employee = Employee(
        email=email,
        full_name=full_name,
        role=get_role(db, role),
        password_hash=hash_password(password if password is not None else secrets.token_urlsafe(32)),
        password_changed_at=utcnow(),
        created_by_id=created_by.id if created_by else None,
    )
    db.add(employee)
    db.flush()
    record_event(
        db, "employee.created", actor=created_by, actor_type=actor_type, target=employee, client=client,
        details={"role": role.value, "password_set": password is not None},
    )  # fmt: skip
    return employee


def change_role(
    db: Session, employee: Employee, role: RoleCode, *, by: Employee | None, actor_type: ActorType = "employee",
    client: ClientInfo = CLI,
) -> Employee:  # fmt: skip
    """Give an employee another role and sign them out everywhere, so they start again with the new role.

    Refuses changing your own role and demoting the last active administrator,
    so the portal can't lock itself out (the same rules as deactivation).
    """
    old = RoleCode(employee.role.code)
    if old == role:
        return employee
    if by is not None and by.id == employee.id:
        raise ConflictError("You can't change your own role. Ask another administrator.")
    if old == RoleCode.ADMIN and employee.is_active and active_admin_count(db) <= 1:
        raise ConflictError("This is the only active administrator. Add another administrator first.")

    employee.role = get_role(db, role)
    # Permissions are read from the role on every request, so the change applies at once; ending
    # the sessions also makes the portal load the new role. "replaced" is the closest reason the
    # auth_sessions CHECK constraint allows until a migration adds "role_changed".
    revoked = revoke_all_sessions(db, employee.id, "replaced")
    record_event(
        db, "employee.role_changed", actor=by, actor_type=actor_type, target=employee, client=client,
        details={"from": old.value, "to": role.value, "sessions_revoked": revoked},
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
