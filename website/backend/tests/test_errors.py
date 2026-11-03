from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.errors import ConflictError, NotFoundError


class Credentials(BaseModel):
    email: str
    password: str
    remember: bool


def _add_test_routes(app: FastAPI) -> None:
    @app.post("/api/v1/_test/credentials")
    def credentials(body: Credentials) -> dict[str, str]:
        return {"email": body.email}

    @app.get("/api/v1/_test/missing")
    def missing() -> None:
        raise NotFoundError("Ingredient not found.")

    @app.get("/api/v1/_test/conflict")
    def conflict() -> None:
        raise ConflictError()

    @app.get("/api/v1/_test/http")
    def http() -> None:
        raise HTTPException(status_code=403, detail="Inspectors can't edit batches.")

    @app.get("/api/v1/_test/crash")
    def crash() -> None:
        raise RuntimeError("secret internal detail: postgresql://user:pw@db")


def test_unknown_route_uses_the_error_shape(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not found.", "code": "not_found"}


def test_wrong_method_uses_the_error_shape(client: TestClient) -> None:
    response = client.delete("/api/v1/health")

    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"


def test_app_errors_keep_their_status_code_and_message(app: FastAPI) -> None:
    _add_test_routes(app)
    client = TestClient(app)

    missing = client.get("/api/v1/_test/missing")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Ingredient not found.", "code": "not_found"}

    conflict = client.get("/api/v1/_test/conflict")
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "conflict"


def test_http_exceptions_keep_a_custom_detail(app: FastAPI) -> None:
    _add_test_routes(app)
    response = TestClient(app).get("/api/v1/_test/http")

    assert response.status_code == 403
    assert response.json() == {"detail": "Inspectors can't edit batches.", "code": "forbidden"}


def test_validation_errors_list_fields_without_echoing_input(app: FastAPI) -> None:
    _add_test_routes(app)
    response = TestClient(app).post(
        "/api/v1/_test/credentials",
        json={"email": "staff@example.com", "password": "hunter2-very-secret", "remember": "not-a-bool"},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["detail"] == "Some fields are missing or invalid."
    assert body["errors"][0]["loc"] == ["body", "remember"]
    assert set(body["errors"][0]) == {"loc", "msg", "type"}
    assert "hunter2-very-secret" not in response.text
    assert "not-a-bool" not in response.text


def test_unhandled_errors_return_a_generic_500(app: FastAPI) -> None:
    _add_test_routes(app)
    response = TestClient(app, raise_server_exceptions=False).get("/api/v1/_test/crash")

    assert response.status_code == 500
    assert response.json() == {"detail": "The server had a problem. Try again shortly.", "code": "internal_error"}
    assert "secret" not in response.text
