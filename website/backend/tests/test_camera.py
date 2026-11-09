"""Camera relay: shared-secret device side (no database needed)."""

from fastapi.testclient import TestClient

from app.factory import create_app
from tests.conftest import make_settings

AUTH = {"Authorization": "Bearer test-camera-secret"}
JPEG = b"\xff\xd8\xff\xe0fake"


def _client() -> TestClient:
    return TestClient(create_app(make_settings(camera_device_secret="test-camera-secret")))


def test_camera_endpoints_refuse_a_missing_or_wrong_secret() -> None:
    with _client() as c:
        assert c.get("/api/v1/device/camera/want").status_code == 401
        assert c.get("/api/v1/device/camera/want", headers={"Authorization": "Bearer nope"}).status_code == 401
        assert c.post("/api/v1/device/camera/frame", content=JPEG).status_code == 401


def test_camera_is_disabled_without_a_secret() -> None:
    with TestClient(create_app(make_settings())) as c:
        assert c.get("/api/v1/device/camera/want", headers=AUTH).status_code == 401


def test_camera_accepts_frames_and_reports_watch_state() -> None:
    with _client() as c:
        assert c.get("/api/v1/device/camera/want", headers=AUTH).json() == {"watch": False}
        assert c.post("/api/v1/device/camera/frame", content=JPEG, headers=AUTH).status_code == 200
        big = b"\xff\xd8" + b"0" * (256 * 1024)
        assert c.post("/api/v1/device/camera/frame", content=big, headers=AUTH).status_code == 413


def test_staff_frame_endpoint_needs_a_session() -> None:
    with _client() as c:
        assert c.get("/api/v1/camera/frame").status_code == 401
