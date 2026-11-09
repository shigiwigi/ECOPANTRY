"""Cross-origin access and the session cookie for the Firebase Hosting → Render setup (docs/DEPLOYMENT.md).

The website calls the API from another origin, so only the exact origins in
CORS_ORIGINS get CORS headers, including on error responses, and the session
cookie is SameSite=None (with the X-CSRF-Token header protecting changes)
wherever it is Secure.
"""

from collections.abc import Iterator

import pytest
from fastapi import Response
from fastapi.testclient import TestClient

from app.auth.cookies import clear_session_cookie, set_session_cookie
from app.auth.permissions import RoleCode
from app.factory import create_app

from .conftest import TEST_PASSWORD, make_settings

SITE = "https://ecopantry-a7342.web.app"
OTHER_SITE = "https://evil.example"
ORIGINS = [SITE, "https://ecopantry-a7342.firebaseapp.com"]


@pytest.fixture
def cross_site() -> Iterator[TestClient]:
    with TestClient(create_app(make_settings(cors_origins=ORIGINS))) as client:
        yield client


def preflight(client: TestClient, origin: str, path: str = "/api/v1/auth/login") -> object:
    return client.options(
        path,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )


def test_an_allowed_origin_passes_the_preflight(cross_site: TestClient) -> None:
    response = preflight(cross_site, SITE)

    assert response.status_code == 200  # type: ignore[attr-defined]
    headers = response.headers  # type: ignore[attr-defined]
    assert headers["access-control-allow-origin"] == SITE
    assert headers["access-control-allow-credentials"] == "true"
    assert "x-csrf-token" in headers["access-control-allow-headers"].lower()


def test_another_origin_fails_the_preflight(cross_site: TestClient) -> None:
    response = preflight(cross_site, OTHER_SITE)

    # Without Access-Control-Allow-Origin the browser blocks the request (Starlette still sends
    # Allow-Credentials on a refused preflight; on its own it grants nothing).
    assert response.status_code == 400  # type: ignore[attr-defined]
    assert "access-control-allow-origin" not in response.headers  # type: ignore[attr-defined]


def test_error_responses_carry_cors_headers_only_for_allowed_origins(cross_site: TestClient) -> None:
    """The browser must be able to read the error's `detail` on the website, and nowhere else."""
    allowed = cross_site.get("/api/v1/auth/me", headers={"Origin": SITE})
    other = cross_site.get("/api/v1/auth/me", headers={"Origin": OTHER_SITE})
    invalid = cross_site.post("/api/v1/auth/login", json={}, headers={"Origin": SITE})

    assert allowed.status_code == other.status_code == 401
    assert allowed.headers["access-control-allow-origin"] == SITE
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert "access-control-allow-origin" not in other.headers
    assert invalid.status_code == 422
    assert invalid.headers["access-control-allow-origin"] == SITE


def test_the_default_origins_are_only_the_local_dev_server(client: TestClient) -> None:
    assert make_settings().cors_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]
    assert client.get("/api/v1/health", headers={"Origin": SITE}).headers.get("access-control-allow-origin") is None
    local = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
    assert local.headers["access-control-allow-origin"] == "http://localhost:5173"


@pytest.mark.parametrize("origin", ["*", "https://*.web.app", f"{SITE}/", "ecopantry-a7342.web.app", "null"])
def test_wildcards_and_malformed_origins_are_refused(origin: str) -> None:
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        make_settings(cors_origins=[origin])


def test_origins_can_be_given_as_a_comma_separated_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", " https://ecopantry-a7342.web.app , https://ecopantry-a7342.firebaseapp.com ")

    assert make_settings().cors_origins == ORIGINS


# --- the session cookie ------------------------------------------------------


def cookie_header(**settings: object) -> str:
    response = Response()
    set_session_cookie(response, make_settings(**settings), "token")
    return response.headers["set-cookie"]


def test_production_cookie_is_host_only_secure_httponly_and_cross_site() -> None:
    header = cookie_header(environment="production")

    assert header.startswith("__Host-ecopantry_session=token;")
    assert "Secure" in header
    assert "HttpOnly" in header
    assert "SameSite=none" in header
    assert "Path=/" in header
    assert "Domain" not in header


def test_development_cookie_is_lax_and_not_secure() -> None:
    header = cookie_header(environment="development")

    assert header.startswith("ecopantry_session=token;")
    assert "SameSite=lax" in header
    assert "HttpOnly" in header
    assert "Secure" not in header


def test_clearing_the_cookie_uses_the_same_attributes() -> None:
    response = Response()
    clear_session_cookie(response, make_settings(environment="production"))
    header = response.headers["set-cookie"]

    assert header.startswith("__Host-ecopantry_session=")
    assert "Max-Age=0" in header
    assert "Secure" in header and "SameSite=none" in header


@pytest.mark.integration
def test_production_sign_in_from_the_website(migrated_database_url: str, db, make_employee) -> None:  # type: ignore[no-untyped-def]
    """End to end with production settings: CORS on success and failure, and the cross-site cookie."""
    employee = make_employee(RoleCode.STOREKEEPER)
    app = create_app(make_settings(environment="production", database_url=migrated_database_url, cors_origins=ORIGINS))
    try:
        with TestClient(app, base_url="https://ecopantry-api.example") as browser:
            wrong = browser.post("/api/v1/auth/login", json={"email": employee.email, "password": "nope"}, headers={"Origin": SITE})
            assert wrong.status_code == 401
            assert wrong.headers["access-control-allow-origin"] == SITE
            assert wrong.json()["code"] == "invalid_credentials"

            refused = browser.post("/api/v1/auth/login", json={"email": employee.email, "password": "nope"}, headers={"Origin": OTHER_SITE})
            assert "access-control-allow-origin" not in refused.headers

            ok = browser.post("/api/v1/auth/login", json={"email": employee.email, "password": TEST_PASSWORD}, headers={"Origin": SITE})
            assert ok.status_code == 200
            assert ok.headers["access-control-allow-origin"] == SITE
            cookie = ok.headers["set-cookie"]
            assert cookie.startswith("__Host-ecopantry_session=")
            assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=none" in cookie

            # The cookie alone isn't enough for changes: the CSRF header is still required.
            assert browser.post("/api/v1/auth/logout", headers={"Origin": SITE}).status_code == 403
            assert browser.get("/api/v1/auth/me", headers={"Origin": SITE}).status_code == 200
    finally:
        app.state.database.dispose()
