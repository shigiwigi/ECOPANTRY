"""Sign-in, sessions and password changes. See docs/AUTH_DESIGN.md for the reasoning.

Functions here never log or return passwords, session tokens or hashes.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError, ForbiddenError, NotAuthenticatedError, TooManyRequestsError
from app.core.security import (
    burn_password_check,
    hash_password,
    hash_session_token,
    new_csrf_token,
    new_session_token,
    password_needs_rehash,
    password_problem,
    verify_password,
)
from app.models.auth import AuthSession, Employee
from app.services.audit import ClientInfo, record_event

# last_seen_at is written at most this often, so reading pages doesn't write on every request.
LAST_SEEN_RESOLUTION = timedelta(seconds=60)


class InvalidCredentialsError(NotAuthenticatedError):
    code = "invalid_credentials"
    detail = "That email and password don't match an account."


class AccountDisabledError(ForbiddenError):
    code = "account_disabled"
    detail = "This account has been deactivated. Ask an administrator if you need access again."


class GoogleAccountNotStaffError(ForbiddenError):
    code = "google_account_not_staff"
    detail = "This Google account isn't linked to an active EcoPantry staff account. Ask an administrator to add you."


class AccountLockedError(TooManyRequestsError):
    code = "account_locked"
    detail = "Too many failed sign-in attempts. Wait a few minutes and try again."


class SessionEndedError(NotAuthenticatedError):
    code = "session_expired"
    detail = "Your session has ended. Sign in again."


class CsrfError(ForbiddenError):
    code = "csrf_failed"
    detail = "Your session couldn't be verified. Reload the page and try again."


class PasswordRejectedError(AppError):
    status_code = 400
    code = "password_rejected"


class WrongCurrentPasswordError(AppError):
    # 400, not 401: the session is still valid and the client must not sign the user out.
    status_code = 400
    code = "invalid_current_password"
    detail = "Your current password is incorrect."


def utcnow() -> datetime:
    return datetime.now(UTC)


def normalize_email(email: str) -> str:
    return email.strip().lower()


@dataclass(frozen=True)
class Principal:
    """The signed-in employee for one request."""

    employee: Employee
    session: AuthSession
    permissions: frozenset[str]

    def has(self, permission: str) -> bool:
        return permission in self.permissions


def permissions_of(employee: Employee) -> frozenset[str]:
    return frozenset(permission.code for permission in employee.role.permissions)


# --- signing in -------------------------------------------------------------


def _record_failure(settings: Settings, employee: Employee, now: datetime) -> bool:
    """Count a wrong password. Returns True when this failure locked the account."""
    employee.failed_login_attempts += 1
    if employee.failed_login_attempts >= settings.login_max_failed_attempts:
        employee.failed_login_attempts = 0
        employee.locked_until = now + settings.login_lockout
        return True
    return False


def authenticate(db: Session, settings: Settings, email: str, password: str, client: ClientInfo) -> Employee:
    """Check credentials and return the employee, or raise. Failures are audited and committed before raising."""
    now = utcnow()
    # Row lock: concurrent attempts on one account are counted one at a time.
    employee = db.scalars(
        select(Employee).where(Employee.email == normalize_email(email)).with_for_update(of=Employee)
    ).one_or_none()

    if employee is None:
        burn_password_check(password)
        # The typed email isn't stored: people sometimes type a password into that field.
        record_event(db, "auth.login_failed", client=client, details={"reason": "unknown_account"})
        db.commit()
        # Same answer as a wrong password, so the response doesn't reveal which emails have accounts.
        raise InvalidCredentialsError()

    if employee.locked_until is not None and employee.locked_until > now:
        record_event(db, "auth.login_blocked", actor=employee, target=employee, client=client, details={"reason": "locked"})
        db.commit()
        raise AccountLockedError()

    if not verify_password(employee.password_hash, password):
        locked = _record_failure(settings, employee, now)
        record_event(
            db, "auth.login_failed", actor=employee, target=employee, client=client,
            details={"reason": "wrong_password", "locked": locked},
        )  # fmt: skip
        db.commit()
        if locked:
            raise AccountLockedError()
        raise InvalidCredentialsError()

    if not employee.is_active:
        # The password was right, so telling them the account is off reveals nothing to a guesser.
        record_event(db, "auth.login_failed", actor=employee, target=employee, client=client, details={"reason": "account_disabled"})
        db.commit()
        raise AccountDisabledError()

    employee.failed_login_attempts = 0
    employee.locked_until = None
    employee.last_login_at = now
    if password_needs_rehash(employee.password_hash):
        employee.password_hash = hash_password(password)
    return employee


def authenticate_google(db: Session, email: str, client: ClientInfo) -> Employee:
    """The active employee whose email a verified Google ID token names, or raise.

    Google sign-in never creates or claims accounts: an administrator must have
    added the employee first. Failures are audited and committed before raising.
    """
    employee = db.scalars(select(Employee).where(Employee.email == normalize_email(email))).one_or_none()
    if employee is None:
        # As with passwords, the email itself isn't stored for unknown accounts.
        record_event(db, "auth.google_login_failed", client=client, details={"reason": "unknown_account"})
        db.commit()
        raise GoogleAccountNotStaffError()
    if not employee.is_active:
        # Google has proved the person owns this email, so telling them the account is off is fine.
        record_event(
            db, "auth.google_login_failed", actor=employee, target=employee, client=client,
            details={"reason": "account_disabled"},
        )  # fmt: skip
        db.commit()
        raise AccountDisabledError()
    employee.last_login_at = utcnow()
    return employee


def start_session(db: Session, settings: Settings, employee: Employee, client: ClientInfo) -> tuple[AuthSession, str]:
    """Create a session row. Returns it with the raw token for the cookie; only the token's hash is stored."""
    now = utcnow()
    token = new_session_token()
    auth_session = AuthSession(
        id=uuid.uuid4(),
        employee=employee,
        token_hash=hash_session_token(token),
        csrf_token=new_csrf_token(),
        created_at=now,
        last_seen_at=now,
        expires_at=now + settings.session_absolute_timeout,
        ip_address=client.ip_address,
        user_agent=client.user_agent,
    )
    db.add(auth_session)
    return auth_session, token


# --- checking sessions ------------------------------------------------------


def find_session(db: Session, token: str | None) -> AuthSession | None:
    if not token or len(token) > 256:
        return None
    return db.scalars(select(AuthSession).where(AuthSession.token_hash == hash_session_token(token))).one_or_none()


def session_end_reason(auth_session: AuthSession, settings: Settings, now: datetime) -> str | None:
    """Why the session can't be used, or None if it's valid."""
    if auth_session.revoked_at is not None:
        return "revoked"
    if now >= auth_session.expires_at:
        return "expired"
    if now >= auth_session.last_seen_at + settings.session_idle_timeout:
        return "idle"
    if not auth_session.employee.is_active:
        return "account_disabled"
    return None


def touch_session(auth_session: AuthSession, now: datetime) -> bool:
    """Move last_seen_at forward if it's stale. Returns True when the row changed and needs a commit."""
    if now - auth_session.last_seen_at < LAST_SEEN_RESOLUTION:
        return False
    auth_session.last_seen_at = now
    return True


def session_expiry(auth_session: AuthSession, settings: Settings) -> datetime:
    """When the session ends if the user does nothing more."""
    return min(auth_session.expires_at, auth_session.last_seen_at + settings.session_idle_timeout)


def revoke_session(auth_session: AuthSession, reason: str) -> None:
    if auth_session.revoked_at is None:
        auth_session.revoked_at = utcnow()
        auth_session.revoked_reason = reason


def revoke_all_sessions(db: Session, employee_id: uuid.UUID, reason: str, *, keep: uuid.UUID | None = None) -> int:
    """Revoke every open session of an employee, optionally keeping one. Returns how many were revoked."""
    statement = (
        update(AuthSession)
        .where(AuthSession.employee_id == employee_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
        .execution_options(synchronize_session="fetch")
    )
    if keep is not None:
        statement = statement.where(AuthSession.id != keep)
    result = db.execute(statement)
    return int(getattr(result, "rowcount", 0) or 0)


# --- passwords --------------------------------------------------------------


def check_new_password(password: str, email: str) -> None:
    problem = password_problem(password, email=email)
    if problem:
        raise PasswordRejectedError(problem)


def change_own_password(
    db: Session, settings: Settings, principal: Principal, current: str, new: str, client: ClientInfo
) -> None:
    """Change the signed-in employee's password and sign out their other sessions."""
    now = utcnow()
    employee = db.scalars(select(Employee).where(Employee.id == principal.employee.id).with_for_update(of=Employee)).one()

    if employee.locked_until is not None and employee.locked_until > now:
        raise AccountLockedError()
    if not verify_password(employee.password_hash, current):
        # Counted like a failed sign-in, so a stolen session can't be used to guess the password.
        locked = _record_failure(settings, employee, now)
        record_event(db, "auth.password_change_failed", actor=employee, target=employee, client=client, details={"locked": locked})
        db.commit()
        if locked:
            raise AccountLockedError()
        raise WrongCurrentPasswordError()

    check_new_password(new, employee.email)
    if verify_password(employee.password_hash, new):
        raise PasswordRejectedError("Choose a password different from your current one.")

    employee.password_hash = hash_password(new)
    employee.password_changed_at = now
    employee.failed_login_attempts = 0
    revoked = revoke_all_sessions(db, employee.id, "password_changed", keep=principal.session.id)
    record_event(db, "auth.password_changed", actor=employee, target=employee, client=client, details={"other_sessions_revoked": revoked})
    db.commit()