"""Google sign-in must only trust signature-verified Firebase ID tokens, and only for existing staff.

The first tests run without a database: a bad token is refused before any
query. Firebase Admin's verifier is replaced, so nothing contacts Google.
"""

import base64
import json
import time
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import google
from app.auth.permissions import RoleCode
from app.factory import create_app
from app.models.audit import AuditEvent
from app.models.auth import Employee

from .conftest import make_settings

GOOGLE = "/api/v1/auth/google"
PROJECT = "ecopantry-a7342"


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def _forged_token(email: str) -> str:
    """Claims that look right (audience, issuer, expiry) but carry no valid signature."""
    header = {"alg": "none", "typ": "JWT"}
    claims = {
        "aud": PROJECT,
        "iss": f"https://securetoken.google.com/{PROJECT}",
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
        "sub": "attacker",
        "email": email,
        "email_verified": True,
    }
    return f"{_b64(header)}.{_b64(claims)}."


@pytest.fixture
def signature_check_fails(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Stand in for Firebase Admin rejecting the signature (offline; no Google key fetch)."""
    seen: list[str] = []

    def reject(token: str, app: object = None, check_revoked: bool = False) -> dict:
        seen.append(token)
        raise ValueError("signature does not match any Google key")

    monkeypatch.setattr(google.fb_auth, "verify_id_token", reject)
    return seen


@pytest.fixture
def google_says(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, Any]], list[object]]:
    """Make Firebase Admin accept any token with these claims. Returns the Firebase apps it was asked to use."""
    apps: list[object] = []

    def configure(claims: dict[str, Any]) -> list[object]:
        def accept(token: str, app: object = None, check_revoked: bool = False) -> dict:
            apps.append(app)
            return claims

        monkeypatch.setattr(google.fb_auth, "verify_id_token", accept)
        return apps

    return configure


def test_a_hand_made_token_is_refused(client: TestClient, signature_check_fails: list[str]) -> None:
    token = _forged_token("admin@example.com")

    response = client.post(GOOGLE, json={"id_token": token})

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_google_token"
    assert "set-cookie" not in response.headers
    # The token went through signature verification; nothing decoded it on the side.
    assert signature_check_fails == [token]


def test_an_unverified_google_email_is_refused(client: TestClient, google_says) -> None:  # type: ignore[no-untyped-def]
    google_says({"email": "admin@example.com", "email_verified": False})

    response = client.post(GOOGLE, json={"id_token": "anything"})

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_google_token"


def test_verification_failures_are_not_decoded_locally(signature_check_fails: list[str]) -> None:
    with pytest.raises(google.InvalidGoogleTokenError):
        google.verify_google_id_token(make_settings(), _forged_token("admin@example.com"))


def test_tokens_are_checked_against_the_configured_project(google_says) -> None:  # type: ignore[no-untyped-def]
    apps = google_says({"email": "a@example.com", "email_verified": True})

    google.verify_google_id_token(make_settings(firebase_project_id="another-project-42"), "token")

    assert apps[0].project_id == "another-project-42"  # type: ignore[attr-defined]


def test_google_sign_in_can_be_turned_off(signature_check_fails: list[str]) -> None:
    app = create_app(make_settings(firebase_project_id=""))
    with TestClient(app) as browser:
        response = browser.post(GOOGLE, json={"id_token": _forged_token("admin@example.com")})

    assert response.status_code == 503
    assert response.json()["code"] == "google_sign_in_unavailable"
    assert signature_check_fails == []


def test_importing_the_api_does_not_start_firebase() -> None:
    import firebase_admin

    create_app(make_settings())
    # Only apps this test module made on purpose (named ecopantry-*) may exist; never the default app.
    assert firebase_admin._DEFAULT_APP_NAME not in firebase_admin._apps


# --- with a database ---------------------------------------------------------


@pytest.mark.integration
def test_an_existing_employee_signs_in_with_google(api: TestClient, db: Session, make_employee, google_says) -> None:  # type: ignore[no-untyped-def]
    employee = make_employee(RoleCode.INSPECTOR, email="sam@example.test")
    google_says({"email": "Sam@Example.test", "email_verified": True})

    response = api.post(GOOGLE, json={"id_token": "token"})

    assert response.status_code == 200, response.text
    assert response.json()["user"]["email"] == "sam@example.test"
    assert response.json()["user"]["role"] == "inspector"
    assert api.get("/api/v1/auth/me").status_code == 200
    db.refresh(employee)
    assert employee.last_login_at is not None
    actions = db.scalars(select(AuditEvent.action).where(AuditEvent.target_id == str(employee.id))).all()
    assert "auth.google_login_succeeded" in actions


@pytest.mark.integration
def test_google_never_creates_or_claims_an_account(api: TestClient, db: Session, google_says) -> None:  # type: ignore[no-untyped-def]
    google_says({"email": "stranger@example.test", "email_verified": True})

    response = api.post(GOOGLE, json={"id_token": "token"})

    assert response.status_code == 403
    assert response.json()["code"] == "google_account_not_staff"
    assert "set-cookie" not in response.headers
    assert db.scalars(select(Employee)).all() == []
    failure = db.scalars(select(AuditEvent).where(AuditEvent.action == "auth.google_login_failed")).one()
    assert "stranger" not in str(failure.details)


@pytest.mark.integration
def test_a_deactivated_employee_cannot_sign_in_with_google(api: TestClient, make_employee, google_says) -> None:  # type: ignore[no-untyped-def]
    make_employee(RoleCode.STOREKEEPER, email="gone@example.test", active=False)
    google_says({"email": "gone@example.test", "email_verified": True})

    response = api.post(GOOGLE, json={"id_token": "token"})

    assert response.status_code == 403
    assert response.json()["code"] == "account_disabled"
    assert "set-cookie" not in response.headers
