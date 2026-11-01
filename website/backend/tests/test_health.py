import pytest
from fastapi.testclient import TestClient

from app import __version__


def test_health_reports_ok_without_a_database(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ecopantry-api", "version": __version__}


def test_readiness_is_503_when_postgres_is_unreachable(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unreachable"}
    # No connection details leak to the caller.
    assert "127.0.0.1" not in response.text
    assert "unit_user" not in response.text


def test_routes_are_versioned(client: TestClient) -> None:
    assert client.get("/health").status_code == 404


@pytest.mark.integration
def test_readiness_is_ok_against_postgres(database_client: TestClient) -> None:
    response = database_client.get("/api/v1/health/ready")

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ready", "database": "ok"}
