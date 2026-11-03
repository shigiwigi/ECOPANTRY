"""Batch label codes and the scanner's batch lookup endpoint.

Batches don't exist until M6, so a valid lookup answers 501. What these tests
pin down now is the access control and validation in front of it, which must
not change when the real lookup is added.
"""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.auth.permissions import ROLE_PERMISSIONS, Permission, RoleCode
from app.models.auth import Employee
from app.services.batch_labels import CODE_ALPHABET, CODE_LENGTH, LABEL_PREFIX, is_valid_code

from .conftest import sign_in

MakeEmployee = Callable[..., Employee]
LOOKUP = "/api/v1/batches/by-label/{code}"
VALID_CODE = "K7M2Q9X4TR"


# --- code format (no database) -------------------------------------------------


@pytest.mark.parametrize("code", [VALID_CODE, "0123456789", "ZZZZZZZZZZ"])
def test_valid_codes(code: str) -> None:
    assert is_valid_code(code)


@pytest.mark.parametrize(
    "code",
    [
        "",
        "K7M2Q9X4T",  # too short
        "K7M2Q9X4TRA",  # too long
        "k7m2q9x4tr",  # lower case: the scanner normalises before asking
        "K7M2Q9X4TI",  # I, L, O and U aren't in Crockford base32
        "K7M2Q9X4TO",
        "K7M2-Q9X4T",
        f"{LABEL_PREFIX}{VALID_CODE}",  # the whole payload, not just the code
        "K7M2Q9X4T\n",
    ],
)
def test_invalid_codes(code: str) -> None:
    assert not is_valid_code(code)


def test_codes_use_only_qr_alphanumeric_characters() -> None:
    # Keeps the printed QR in alphanumeric mode, which is smaller than byte mode.
    qr_alphanumeric = set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:")
    assert set(LABEL_PREFIX + CODE_ALPHABET) <= qr_alphanumeric
    assert len(CODE_ALPHABET) == 32
    assert CODE_LENGTH == 10


def test_lookup_refuses_requests_without_a_session(client: TestClient) -> None:
    response = client.get(LOOKUP.format(code=VALID_CODE))

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


def test_lookup_checks_the_session_before_the_code(client: TestClient) -> None:
    # A malformed code must not reveal anything (not even a validation error) without a session.
    response = client.get(LOOKUP.format(code="not-a-code"))

    assert response.status_code == 401


def test_every_role_that_views_batches_may_look_up_labels() -> None:
    holders = {role for role, held in ROLE_PERMISSIONS.items() if Permission.BATCHES_VIEW in held}

    assert holders == {RoleCode.ADMIN, RoleCode.STOREKEEPER, RoleCode.INSPECTOR}


# --- endpoint (database) ---------------------------------------------------------


@pytest.mark.integration
@pytest.mark.parametrize("role", [RoleCode.ADMIN, RoleCode.STOREKEEPER, RoleCode.INSPECTOR])
def test_signed_in_staff_get_an_honest_not_available_yet(api: TestClient, make_employee: MakeEmployee, role: RoleCode) -> None:
    sign_in(api, make_employee(role).email)

    response = api.get(LOOKUP.format(code=VALID_CODE))

    assert response.status_code == 501
    body = response.json()
    assert body["code"] == "batch_lookup_unavailable"
    assert VALID_CODE not in response.text  # never echo submitted values


@pytest.mark.integration
@pytest.mark.parametrize("code", ["k7m2q9x4tr", "K7M2Q9X4TO", "TOO-SHORT", "ECOPANTRY:BATCH:K7M2Q9X4TR"])
def test_malformed_codes_are_rejected_without_echoing_them(api: TestClient, make_employee: MakeEmployee, code: str) -> None:
    sign_in(api, make_employee(RoleCode.STOREKEEPER).email)

    response = api.get(LOOKUP.format(code=code))

    assert response.status_code in (404, 422)  # a ':' or '/' can change which route matches
    assert code not in response.text


@pytest.mark.integration
def test_lookup_needs_no_csrf_token_because_it_only_reads(api: TestClient, make_employee: MakeEmployee) -> None:
    sign_in(api, make_employee(RoleCode.INSPECTOR).email)

    response = api.get(LOOKUP.format(code=VALID_CODE), headers={"X-CSRF-Token": ""})

    assert response.status_code == 501


@pytest.mark.integration
def test_lookup_refuses_unsafe_methods(api: TestClient, make_employee: MakeEmployee) -> None:
    csrf = sign_in(api, make_employee(RoleCode.ADMIN).email)

    response = api.post(LOOKUP.format(code=VALID_CODE), headers={"X-CSRF-Token": csrf}, json={})

    assert response.status_code == 405


@pytest.mark.integration
def test_lookup_stops_working_when_the_session_ends(api: TestClient, make_employee: MakeEmployee) -> None:
    csrf = sign_in(api, make_employee(RoleCode.STOREKEEPER).email)
    assert api.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf}).status_code in (200, 204)

    response = api.get(LOOKUP.format(code=VALID_CODE))

    assert response.status_code == 401


@pytest.mark.integration
def test_lookup_is_not_reachable_through_the_public_api(api: TestClient) -> None:
    response = api.get(f"/api/v1/public/batches/by-label/{VALID_CODE}")

    assert response.status_code == 404
