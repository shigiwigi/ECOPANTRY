"""Sign-in, sessions, CSRF, sign-out and password changes against a real (throwaway) PostgreSQL database."""

import logging
from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.permissions import ROLE_PERMISSIONS, RoleCode
from app.auth.service import utcnow
from app.core.config import Settings
from app.core.security import hash_session_token
from app.models.audit import AuditEvent
from app.models.auth import AuthSession, Employee

from .conftest import TEST_PASSWORD, sign_in

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"
PASSWORD = "/api/v1/auth/password"
COOKIE = "ecopantry_session"


def events(db: Session, action: str) -> list[AuditEvent]:
    db.expire_all()
    return list(db.scalars(select(AuditEvent).where(AuditEvent.action == action).order_by(AuditEvent.id)))


def only_session(db: Session, employee: Employee) -> AuthSession:
    db.expire_all()
    return db.scalars(select(AuthSession).where(AuthSession.employee_id == employee.id)).one()


# --- signing in -------------------------------------------------------------


@pytest.mark.parametrize("role", list(RoleCode))
def test_login_returns_the_user_their_permissions_and_a_session_cookie(
    api: TestClient, db: Session, make_employee: MakeEmployee, role: RoleCode
) -> None:
    employee = make_employee(role)

    response = api.post(LOGIN, json={"email": employee.email, "password": TEST_PASSWORD})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"] == {
        "id": str(employee.id),
        "name": employee.full_name,
        "email": employee.email,
        "role": role.value,
        "role_name": employee.role.name,
        "permissions": sorted(p.value for p in ROLE_PERMISSIONS[role]),
    }
    assert len(body["csrf_token"]) >= 32
    assert "password" not in response.text and "hash" not in response.text

    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie
    assert "Max-Age=43200" in cookie  # 12 hours
    assert response.headers["cache-control"] == "no-store"

    token = api.cookies[COOKIE]
    stored = only_session(db, employee)
    assert stored.token_hash == hash_session_token(token)
    assert token.encode() not in stored.token_hash
    assert stored.revoked_at is None
    assert len(events(db, "auth.login_succeeded")) == 1


def test_login_ignores_email_case_and_surrounding_spaces(api: TestClient, make_employee: MakeEmployee) -> None:
    employee = make_employee()

    response = api.post(LOGIN, json={"email": f"  {employee.email.upper()} ", "password": TEST_PASSWORD})

    assert response.status_code == 200


def test_wrong_password_and_unknown_email_get_the_same_answer(
    api: TestClient, db: Session, make_employee: MakeEmployee
) -> None:
    employee = make_employee()

    wrong = api.post(LOGIN, json={"email": employee.email, "password": "not the right password"})
    unknown = api.post(LOGIN, json={"email": "nobody@example.test", "password": TEST_PASSWORD})

    for response in (wrong, unknown):
        assert response.status_code == 401
        assert response.json() == {"detail": "That email and password don't match an account.", "code": "invalid_credentials"}
        assert "set-cookie" not in response.headers
    assert COOKIE not in api.cookies

    failures = events(db, "auth.login_failed")
    assert [event.details["reason"] for event in failures] == ["wrong_password", "unknown_account"]
    # The typed email of an unknown account is not stored.
    assert failures[1].actor_employee_id is None
    assert "nobody" not in str(failures[1].details)
    db.refresh(employee)
    assert employee.failed_login_attempts == 1


def test_login_only_accepts_json(api: TestClient, make_employee: MakeEmployee) -> None:
    """A cross-site HTML form can't send JSON, so it can't sign someone in (login CSRF)."""
    employee = make_employee()

    response = api.post(LOGIN, data={"email": employee.email, "password": TEST_PASSWORD})

    assert response.status_code == 422
    assert COOKIE not in api.cookies


def test_invalid_login_bodies_do_not_echo_the_password(api: TestClient) -> None:
    response = api.post(LOGIN, json={"email": "", "password": "hunter2-secret-value"})

    assert response.status_code == 422
    assert "hunter2-secret-value" not in response.text


def test_repeated_failures_lock_the_account_for_a_while(
    api: TestClient, db: Session, make_employee: MakeEmployee, auth_settings: Settings
) -> None:
    employee = make_employee()
    attempts = auth_settings.login_max_failed_attempts

    statuses = [api.post(LOGIN, json={"email": employee.email, "password": "wrong password!"}).status_code for _ in range(attempts)]

    assert statuses == [401] * (attempts - 1) + [429]
    # While locked, even the right password is refused without being checked.
    locked = api.post(LOGIN, json={"email": employee.email, "password": TEST_PASSWORD})
    assert locked.status_code == 429
    assert locked.json()["code"] == "account_locked"
    assert len(events(db, "auth.login_blocked")) == 1

    # Once the lockout has passed, the right password works and the counters reset.
    db.refresh(employee)
    employee.locked_until = utcnow() - timedelta(seconds=1)
    db.commit()
    assert api.post(LOGIN, json={"email": employee.email, "password": TEST_PASSWORD}).status_code == 200
    db.refresh(employee)
    assert employee.failed_login_attempts == 0
    assert employee.locked_until is None
    assert employee.last_login_at is not None


def test_a_deactivated_account_cannot_sign_in(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    employee = make_employee(RoleCode.INSPECTOR, active=False)

    right = api.post(LOGIN, json={"email": employee.email, "password": TEST_PASSWORD})
    wrong = api.post(LOGIN, json={"email": employee.email, "password": "not the right password"})

    assert right.status_code == 403
    assert right.json()["code"] == "account_disabled"
    # Someone guessing doesn't learn the account is deactivated.
    assert wrong.status_code == 401
    assert COOKIE not in api.cookies
    db.expire_all()
    assert db.scalars(select(AuthSession)).all() == []


def test_signing_in_again_replaces_the_previous_session(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    employee = make_employee()
    sign_in(api, employee.email)
    first_token = api.cookies[COOKIE]

    sign_in(api, employee.email)

    db.expire_all()
    first = db.scalars(select(AuthSession).where(AuthSession.token_hash == hash_session_token(first_token))).one()
    assert first.revoked_reason == "replaced"
    assert api.get(ME).status_code == 200


# --- the current session ----------------------------------------------------


def test_me_without_a_session_is_401(api: TestClient) -> None:
    response = api.get(ME)

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


def test_me_returns_the_session(api: TestClient, make_employee: MakeEmployee) -> None:
    employee = make_employee(RoleCode.INSPECTOR)
    csrf = sign_in(api, employee.email)

    response = api.get(ME)

    assert response.status_code == 200
    assert response.json()["user"]["email"] == employee.email
    assert response.json()["user"]["role"] == "inspector"
    assert response.json()["csrf_token"] == csrf


def test_a_made_up_session_cookie_is_refused(api: TestClient) -> None:
    api.cookies.set(COOKIE, "made-up-token-that-was-never-issued")

    response = api.get(ME)

    assert response.status_code == 401
    assert response.json()["code"] == "session_expired"
    # The dead cookie is cleared.
    assert response.headers["set-cookie"].startswith(f'{COOKIE}=""')
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_a_tampered_session_cookie_is_refused(api: TestClient, make_employee: MakeEmployee) -> None:
    employee = make_employee()
    sign_in(api, employee.email)
    token = api.cookies[COOKIE]
    api.cookies.clear()
    api.cookies.set(COOKIE, token[:-1] + ("A" if token[-1] != "A" else "B"))

    assert api.get(ME).status_code == 401


@pytest.mark.parametrize(
    ("change", "description"),
    [
        (lambda s, now: setattr(s, "expires_at", now - timedelta(seconds=1)), "past the absolute lifetime"),
        (lambda s, now: setattr(s, "last_seen_at", now - timedelta(minutes=61)), "idle longer than the timeout"),
        (lambda s, now: (setattr(s, "revoked_at", now), setattr(s, "revoked_reason", "logout")), "revoked"),
    ],
)
def test_ended_sessions_are_refused(
    api: TestClient, db: Session, make_employee: MakeEmployee, change: Callable[[AuthSession, object], None], description: str
) -> None:
    employee = make_employee()
    sign_in(api, employee.email)
    stored = only_session(db, employee)
    change(stored, utcnow())
    db.commit()

    response = api.get(ME)

    assert response.status_code == 401, description
    assert response.json() == {"detail": "Your session has ended. Sign in again.", "code": "session_expired"}


def test_activity_extends_an_idle_session(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    employee = make_employee()
    sign_in(api, employee.email)
    stored = only_session(db, employee)
    earlier = utcnow() - timedelta(minutes=30)
    stored.last_seen_at = earlier
    db.commit()

    assert api.get(ME).status_code == 200

    assert only_session(db, employee).last_seen_at > earlier + timedelta(minutes=29)


def test_deactivating_an_account_ends_its_sessions(api: TestClient, auth_app, make_employee: MakeEmployee) -> None:  # type: ignore[no-untyped-def]
    admin = make_employee(RoleCode.ADMIN)
    storekeeper = make_employee(RoleCode.STOREKEEPER)
    with TestClient(auth_app) as storekeeper_browser:
        sign_in(storekeeper_browser, storekeeper.email)
        csrf = sign_in(api, admin.email)

        response = api.post(f"/api/v1/employees/{storekeeper.id}/deactivate", headers={"X-CSRF-Token": csrf})

        assert response.status_code == 200, response.text
        assert storekeeper_browser.get(ME).status_code == 401


# --- CSRF -------------------------------------------------------------------


@pytest.mark.parametrize("header", [None, "", "wrong-token"])
def test_unsafe_requests_need_the_sessions_csrf_token(
    api: TestClient, db: Session, make_employee: MakeEmployee, header: str | None
) -> None:
    employee = make_employee()
    sign_in(api, employee.email)
    headers = {} if header is None else {"X-CSRF-Token": header}

    password_change = api.post(PASSWORD, json={"current_password": TEST_PASSWORD, "new_password": "a brand new passphrase"}, headers=headers)
    logout = api.post(LOGOUT, headers=headers)

    for response in (password_change, logout):
        assert response.status_code == 403
        assert response.json()["code"] == "csrf_failed"
    # Nothing changed: still signed in with the old password.
    assert api.get(ME).status_code == 200
    db.refresh(employee)
    assert events(db, "auth.password_changed") == []


def test_a_csrf_token_from_another_session_is_refused(api: TestClient, auth_app, make_employee: MakeEmployee) -> None:  # type: ignore[no-untyped-def]
    first, second = make_employee(), make_employee()
    with TestClient(auth_app) as other_browser:
        other_csrf = sign_in(other_browser, second.email)
    sign_in(api, first.email)

    assert api.post(LOGOUT, headers={"X-CSRF-Token": other_csrf}).status_code == 403


# --- signing out ------------------------------------------------------------


def test_logout_ends_the_session_on_the_server(api: TestClient, db: Session, make_employee: MakeEmployee) -> None:
    employee = make_employee()
    csrf = sign_in(api, employee.email)
    token = api.cookies[COOKIE]

    response = api.post(LOGOUT, headers={"X-CSRF-Token": csrf})

    assert response.status_code == 204
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert only_session(db, employee).revoked_reason == "logout"
    assert len(events(db, "auth.logout")) == 1
    # Replaying the old cookie doesn't work.
    api.cookies.clear()
    api.cookies.set(COOKIE, token)
    assert api.get(ME).status_code == 401


def test_logout_without_a_session_just_clears_the_cookie(api: TestClient) -> None:
    response = api.post(LOGOUT)

    assert response.status_code == 204
    assert "Max-Age=0" in response.headers["set-cookie"]


# --- changing your own password ---------------------------------------------


def test_changing_the_password_keeps_this_session_and_ends_the_others(
    api: TestClient, auth_app, db: Session, make_employee: MakeEmployee  # type: ignore[no-untyped-def]
) -> None:
    employee = make_employee()
    new_password = "a brand new passphrase"
    with TestClient(auth_app) as other_browser:
        sign_in(other_browser, employee.email)
        csrf = sign_in(api, employee.email)

        response = api.post(PASSWORD, json={"current_password": TEST_PASSWORD, "new_password": new_password}, headers={"X-CSRF-Token": csrf})

        assert response.status_code == 204, response.text
        assert api.get(ME).status_code == 200
        assert other_browser.get(ME).status_code == 401

    with TestClient(auth_app) as fresh:
        assert fresh.post(LOGIN, json={"email": employee.email, "password": TEST_PASSWORD}).status_code == 401
        assert fresh.post(LOGIN, json={"email": employee.email, "password": new_password}).status_code == 200
    assert len(events(db, "auth.password_changed")) == 1


def test_a_wrong_current_password_is_400_not_a_sign_out(api: TestClient, make_employee: MakeEmployee) -> None:
    employee = make_employee()
    csrf = sign_in(api, employee.email)

    response = api.post(PASSWORD, json={"current_password": "not my password", "new_password": "a brand new passphrase"}, headers={"X-CSRF-Token": csrf})

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_current_password"
    assert api.get(ME).status_code == 200


@pytest.mark.parametrize(("new_password", "reason"), [("short", "at least"), (TEST_PASSWORD, "different")])
def test_weak_or_unchanged_new_passwords_are_rejected(
    api: TestClient, make_employee: MakeEmployee, new_password: str, reason: str
) -> None:
    employee = make_employee()
    csrf = sign_in(api, employee.email)

    response = api.post(PASSWORD, json={"current_password": TEST_PASSWORD, "new_password": new_password}, headers={"X-CSRF-Token": csrf})

    assert response.status_code == 400
    assert response.json()["code"] == "password_rejected"
    assert reason in response.json()["detail"]


# --- nothing secret leaks ---------------------------------------------------


def test_passwords_and_tokens_never_reach_the_logs_or_audit_trail(
    api: TestClient, db: Session, make_employee: MakeEmployee, caplog: pytest.LogCaptureFixture
) -> None:
    employee = make_employee()
    caplog.set_level(logging.DEBUG)

    api.post(LOGIN, json={"email": employee.email, "password": "a wrong password value"})
    csrf = sign_in(api, employee.email)
    token = api.cookies[COOKIE]
    api.get(ME)
    api.post(LOGOUT, headers={"X-CSRF-Token": csrf})

    db.expire_all()
    audit_text = " ".join(f"{e.action} {e.details}" for e in db.scalars(select(AuditEvent)))
    for secret in (TEST_PASSWORD, "a wrong password value", token, csrf, employee.password_hash):
        assert secret not in caplog.text
        assert secret not in audit_text
