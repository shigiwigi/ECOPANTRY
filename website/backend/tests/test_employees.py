"""Role-based access on the staff-account endpoints, checked by the backend."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.permissions import RoleCode
from app.models.audit import AuditEvent
from app.models.auth import Employee

from .conftest import TEST_PASSWORD, sign_in

pytestmark = pytest.mark.integration

MakeEmployee = Callable[..., Employee]
EMPLOYEES = "/api/v1/employees"
NEW_EMPLOYEE = {"email": "new.person@example.test", "name": "New Person", "role": "storekeeper", "password": TEST_PASSWORD}


def signed_in(api: TestClient, make_employee: MakeEmployee, role: RoleCode) -> dict[str, str]:
    """Sign in as a new employee with `role`; returns headers carrying the CSRF token."""
    employee = make_employee(role)
    return {"X-CSRF-Token": sign_in(api, employee.email)}


def mutating_requests(target: Employee) -> list[tuple[str, dict[str, object]]]:
    return [
        (EMPLOYEES, NEW_EMPLOYEE),
        (f"{EMPLOYEES}/{target.id}/deactivate", {}),
        (f"{EMPLOYEES}/{target.id}/reactivate", {}),
        (f"{EMPLOYEES}/{target.id}/password", {"password": "another long passphrase"}),
    ]


def test_listing_staff_needs_employees_view(api: TestClient, auth_app, make_employee: MakeEmployee) -> None:  # type: ignore[no-untyped-def]
    for role, expected in ((RoleCode.ADMIN, 200), (RoleCode.INSPECTOR, 200), (RoleCode.STOREKEEPER, 403)):
        with TestClient(auth_app) as browser:
            signed_in(browser, make_employee, role)
            response = browser.get(EMPLOYEES)
            assert response.status_code == expected, role
            if expected == 403:
                assert response.json() == {"detail": "You don't have permission to do that.", "code": "forbidden"}


def test_staff_list_never_includes_password_material(api: TestClient, make_employee: MakeEmployee) -> None:
    signed_in(api, make_employee, RoleCode.ADMIN)

    response = api.get(EMPLOYEES)

    assert response.status_code == 200
    assert set(response.json()[0]) == {"id", "email", "name", "role", "role_name", "status", "last_login_at", "created_at", "deactivated_at"}
    assert "argon2" not in response.text


@pytest.mark.parametrize("role", [RoleCode.INSPECTOR, RoleCode.STOREKEEPER])
def test_only_administrators_can_change_staff_accounts(
    api: TestClient, db: Session, make_employee: MakeEmployee, role: RoleCode
) -> None:
    """Inspectors are read-only; storekeepers don't manage staff. Nothing changes in the database."""
    target = make_employee(RoleCode.STOREKEEPER)
    headers = signed_in(api, make_employee, role)
    audit_before = db.scalar(select(func.count()).select_from(AuditEvent))

    for url, body in mutating_requests(target):
        response = api.post(url, json=body, headers=headers)
        assert response.status_code == 403, f"{role} {url}"
        assert response.json()["code"] == "forbidden"

    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Employee).where(Employee.email == NEW_EMPLOYEE["email"])) == 0
    assert db.get(Employee, target.id).is_active  # type: ignore[union-attr]
    # The refused requests recorded nothing.
    assert db.scalar(select(func.count()).select_from(AuditEvent)) == audit_before


def test_inspector_sessions_hold_no_write_permissions(api: TestClient, make_employee: MakeEmployee) -> None:
    signed_in(api, make_employee, RoleCode.INSPECTOR)

    permissions = api.get("/api/v1/auth/me").json()["user"]["permissions"]

    assert permissions
    assert all(p.endswith(".view") or p == "reports.export" for p in permissions)


def test_administrator_creates_an_account_that_can_sign_in(api: TestClient, auth_app, db: Session, make_employee: MakeEmployee) -> None:  # type: ignore[no-untyped-def]
    headers = signed_in(api, make_employee, RoleCode.ADMIN)

    response = api.post(EMPLOYEES, json={**NEW_EMPLOYEE, "email": "  New.Person@Example.test "}, headers=headers)

    assert response.status_code == 201, response.text
    assert response.json()["email"] == "new.person@example.test"
    assert response.json()["role"] == "storekeeper"
    assert response.json()["status"] == "active"
    with TestClient(auth_app) as browser:
        sign_in(browser, NEW_EMPLOYEE["email"])  # type: ignore[arg-type]
    created = db.scalars(select(AuditEvent).where(AuditEvent.action == "employee.created")).all()
    assert any(event.actor_type == "employee" for event in created)


@pytest.mark.parametrize(
    ("changes", "status", "code"),
    [
        ({"password": "short"}, 400, "password_rejected"),
        ({"email": "not-an-email"}, 400, "invalid_employee"),
        ({"name": "   "}, 400, "invalid_employee"),
        ({"role": "owner"}, 422, "validation_error"),
    ],
)
def test_invalid_new_accounts_are_rejected(
    api: TestClient, make_employee: MakeEmployee, changes: dict[str, str], status: int, code: str
) -> None:
    headers = signed_in(api, make_employee, RoleCode.ADMIN)

    response = api.post(EMPLOYEES, json={**NEW_EMPLOYEE, **changes}, headers=headers)

    assert response.status_code == status
    assert response.json()["code"] == code


def test_duplicate_emails_are_a_conflict(api: TestClient, make_employee: MakeEmployee) -> None:
    headers = signed_in(api, make_employee, RoleCode.ADMIN)
    assert api.post(EMPLOYEES, json=NEW_EMPLOYEE, headers=headers).status_code == 201

    response = api.post(EMPLOYEES, json={**NEW_EMPLOYEE, "email": NEW_EMPLOYEE["email"].upper()}, headers=headers)

    assert response.status_code == 409


def test_deactivate_and_reactivate(api: TestClient, auth_app, db: Session, make_employee: MakeEmployee) -> None:  # type: ignore[no-untyped-def]
    headers = signed_in(api, make_employee, RoleCode.ADMIN)
    target = make_employee(RoleCode.INSPECTOR)

    off = api.post(f"{EMPLOYEES}/{target.id}/deactivate", headers=headers)
    assert off.status_code == 200
    assert off.json()["status"] == "disabled"
    assert off.json()["deactivated_at"] is not None
    with TestClient(auth_app) as browser:
        assert browser.post("/api/v1/auth/login", json={"email": target.email, "password": TEST_PASSWORD}).status_code == 403

    on = api.post(f"{EMPLOYEES}/{target.id}/reactivate", headers=headers)
    assert on.status_code == 200
    assert on.json()["status"] == "active"
    with TestClient(auth_app) as browser:
        sign_in(browser, target.email)

    actions = [e.action for e in db.scalars(select(AuditEvent).where(AuditEvent.target_id == str(target.id)).order_by(AuditEvent.id))]
    assert "employee.deactivated" in actions and "employee.reactivated" in actions


def test_administrators_cannot_deactivate_themselves(api: TestClient, make_employee: MakeEmployee) -> None:
    admin = make_employee(RoleCode.ADMIN)
    headers = {"X-CSRF-Token": sign_in(api, admin.email)}
    make_employee(RoleCode.ADMIN)  # another admin exists, so this isn't the last-admin rule

    response = api.post(f"{EMPLOYEES}/{admin.id}/deactivate", headers=headers)

    assert response.status_code == 409
    assert "your own account" in response.json()["detail"]


def test_the_last_active_administrator_cannot_be_deactivated(db: Session, make_employee: MakeEmployee) -> None:
    from app.core.errors import ConflictError
    from app.services.employees import deactivate_employee

    admin = make_employee(RoleCode.ADMIN)

    with pytest.raises(ConflictError, match="only active administrator"):
        deactivate_employee(db, admin, by=None, actor_type="cli")


def test_resetting_someones_password_signs_them_out(api: TestClient, auth_app, make_employee: MakeEmployee) -> None:  # type: ignore[no-untyped-def]
    headers = signed_in(api, make_employee, RoleCode.ADMIN)
    target = make_employee(RoleCode.STOREKEEPER)
    with TestClient(auth_app) as browser:
        sign_in(browser, target.email)

        response = api.post(f"{EMPLOYEES}/{target.id}/password", json={"password": "another long passphrase"}, headers=headers)

        assert response.status_code == 204
        assert browser.get("/api/v1/auth/me").status_code == 401
        sign_in(browser, target.email, "another long passphrase")


def test_unknown_employee_is_404(api: TestClient, make_employee: MakeEmployee) -> None:
    headers = signed_in(api, make_employee, RoleCode.ADMIN)

    response = api.post(f"{EMPLOYEES}/00000000-0000-4000-8000-000000000000/deactivate", headers=headers)

    assert response.status_code == 404
