"""Every API route needs a session unless it is on the public list below.

This runs without a database: an unauthenticated request must be refused
before any query. When adding a deliberately public endpoint (for example the
public product catalogue), add it to PUBLIC_ROUTES with a comment saying why.
"""

import re
import uuid

import pytest
from fastapi.testclient import TestClient

from app.factory import create_app

from .conftest import make_settings

PUBLIC_ROUTES = {
    ("get", "/api/v1/health"),  # liveness, no data
    ("get", "/api/v1/health/ready"),  # readiness, no data
    ("post", "/api/v1/auth/login"),  # how a session starts
    ("post", "/api/v1/auth/logout"),  # ends a session if there is one; harmless without
    ("post", "/api/v1/auth/google"),  # starts a session from a signature-verified Google ID token
    ("post", "/api/v1/auth/register"),  # an admin-added employee sets their first password
    # Customer website: published catalogue only, public fields only (see tests/test_catalogue.py).
    ("get", "/api/v1/public/catalogue"),
    ("get", "/api/v1/public/catalogue/products/{slug}"),
}


def _all_routes() -> list[tuple[str, str]]:
    schema = create_app(make_settings()).openapi()
    return sorted((method, path) for path, operations in schema["paths"].items() for method in operations)


PROTECTED_ROUTES = [route for route in _all_routes() if route not in PUBLIC_ROUTES]


def test_the_public_list_only_names_real_routes() -> None:
    assert PUBLIC_ROUTES <= set(_all_routes())


def test_there_are_protected_routes_to_check() -> None:
    assert len(PROTECTED_ROUTES) >= 6


@pytest.mark.parametrize(("method", "path"), PROTECTED_ROUTES)
def test_protected_route_refuses_requests_without_a_session(client: TestClient, method: str, path: str) -> None:
    url = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)

    response = client.request(method.upper(), url, json={})

    assert response.status_code == 401, f"{method.upper()} {path} answered {response.status_code} without a session"
    assert response.json()["code"] == "not_authenticated"

