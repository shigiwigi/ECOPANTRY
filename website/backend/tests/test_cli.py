"""The account bootstrap and recovery commands (`python -m app.cli`)."""

import io
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import utcnow
from app.cli import main
from app.core.config import Settings
from app.models.audit import AuditEvent
from app.models.auth import AuthSession, Employee

from .conftest import TEST_PASSWORD, sign_in

pytestmark = pytest.mark.integration


def run(settings: Settings, *args: str, stdin: str = "") -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(list(args), settings=settings, stdin=io.StringIO(stdin), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_create_admin_makes_a_working_administrator(auth_settings: Settings, api: TestClient, db: Session) -> None:
    code, out, err = run(
        auth_settings, "create-admin", "--email", "Owner@Example.test", "--name", "Bakery Owner", "--password-stdin",
        stdin=TEST_PASSWORD + "\n",
    )  # fmt: skip

    assert (code, err) == (0, "")
    assert "owner@example.test" in out
    assert TEST_PASSWORD not in out
    sign_in(api, "owner@example.test")
    assert api.get("/api/v1/auth/me").json()["user"]["role"] == "admin"
    event = db.scalars(select(AuditEvent).where(AuditEvent.action == "employee.created")).one()
    assert event.actor_type == "cli"
    assert event.actor_employee_id is None


def test_create_admin_refuses_when_an_administrator_exists(auth_settings: Settings, db: Session) -> None:
    first = run(auth_settings, "create-admin", "--email", "a@example.test", "--name", "A", "--password-stdin", stdin=TEST_PASSWORD)
    second = run(auth_settings, "create-admin", "--email", "b@example.test", "--name", "B", "--password-stdin", stdin=TEST_PASSWORD)

    assert first[0] == 0
    assert second[0] == 1
    assert "already exists" in second[2]
    assert db.scalars(select(Employee.email)).all() == ["a@example.test"]


def test_create_admin_rejects_a_weak_password(auth_settings: Settings, db: Session) -> None:
    code, _, err = run(auth_settings, "create-admin", "--email", "a@example.test", "--name", "A", "--password-stdin", stdin="short")

    assert code == 1
    assert "at least 12" in err
    assert db.scalars(select(Employee)).all() == []


def test_passwords_are_never_taken_from_a_non_terminal_without_the_flag(auth_settings: Settings) -> None:
    code, _, err = run(auth_settings, "create-admin", "--email", "a@example.test", "--name", "A", stdin=TEST_PASSWORD)

    assert code == 1
    assert "--password-stdin" in err


def test_there_is_no_password_argument() -> None:
    with pytest.raises(SystemExit):
        main(["create-admin", "--email", "a@example.test", "--name", "A", "--password", TEST_PASSWORD], stderr=io.StringIO())


def test_recovery_commands(auth_settings: Settings, api: TestClient, db: Session, make_employee) -> None:  # type: ignore[no-untyped-def]
    make_employee()  # an unrelated account
    from app.auth.permissions import RoleCode

    admin = make_employee(RoleCode.ADMIN)
    other_admin = make_employee(RoleCode.ADMIN)
    sign_in(api, other_admin.email)

    assert run(auth_settings, "set-password", "--email", other_admin.email, "--password-stdin", stdin="a recovered passphrase")[0] == 0
    assert api.get("/api/v1/auth/me").status_code == 401  # signed out everywhere
    sign_in(api, other_admin.email, "a recovered passphrase")

    assert run(auth_settings, "deactivate", "--email", other_admin.email)[0] == 0
    assert api.get("/api/v1/auth/me").status_code == 401
    # The remaining administrator can't be deactivated: the portal would be locked out.
    code, _, err = run(auth_settings, "deactivate", "--email", admin.email)
    assert code == 1 and "only active administrator" in err

    assert run(auth_settings, "reactivate", "--email", other_admin.email)[0] == 0
    sign_in(api, other_admin.email, "a recovered passphrase")

    assert run(auth_settings, "deactivate", "--email", "nobody@example.test")[0] == 1


def test_purge_sessions_deletes_only_long_ended_sessions(auth_settings: Settings, api: TestClient, db: Session, make_employee) -> None:  # type: ignore[no-untyped-def]
    employee = make_employee()
    sign_in(api, employee.email)
    with TestClient(api.app) as other:
        sign_in(other, employee.email)
    old = db.scalars(select(AuthSession).order_by(AuthSession.created_at)).first()
    assert old is not None
    old.expires_at = utcnow() - timedelta(days=40)
    db.commit()

    code, out, _ = run(auth_settings, "purge-sessions", "--days", "30")

    assert code == 0
    assert "Deleted 1 " in out
    db.expire_all()
    assert len(db.scalars(select(AuthSession)).all()) == 1
