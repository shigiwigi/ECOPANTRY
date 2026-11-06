"""Google sign-in must only trust signature-verified Firebase ID tokens.

These run without a database: a bad token is refused before any query.
"""

import base64
import json
import time

import pytest
from fastapi.testclient import TestClient

from app.api.v1.routes import auth as auth_routes


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def _forged_token(email: str) -> str:
    """Claims that look right (audience, issuer, expiry) but carry no valid signature."""
    header = {"alg": "none", "typ": "JWT"}
    claims = {
        "aud": auth_routes.FIREBASE_PROJECT_ID,
        "iss": f"https://securetoken.google.com/{auth_routes.FIREBASE_PROJECT_ID}",
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

    def reject(token: str, check_revoked: bool = False) -> dict:
        seen.append(token)
        raise ValueError("signature does not match any Google key")

    monkeypatch.setattr(auth_routes.fb_auth, "verify_id_token", reject)
    return seen


def test_a_hand_made_token_is_refused(client: TestClient, signature_check_fails: list[str]) -> None:
    token = _forged_token("admin@example.com")

    response = client.post("/api/v1/auth/google", json={"id_token": token})

    assert response.status_code == 401
    assert "set-cookie" not in response.headers
    # The token went through signature verification; nothing decoded it on the side.
    assert signature_check_fails == [token]


def test_an_unverified_google_email_is_refused(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth_routes.fb_auth,
        "verify_id_token",
        lambda token, check_revoked=False: {"email": "admin@example.com", "email_verified": False},
    )

    response = client.post("/api/v1/auth/google", json={"id_token": "anything"})

    assert response.status_code == 401


def test_verification_failures_are_not_decoded_locally(signature_check_fails: list[str]) -> None:
    with pytest.raises(ValueError):
        auth_routes._verify_google_token(_forged_token("admin@example.com"))
