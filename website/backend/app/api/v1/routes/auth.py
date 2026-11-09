"""Staff sign-in (password or Google), sign-out, current session and password change.

There is no self-registration: an administrator creates every staff account
(portal Users page or `python -m app.cli`). Google sign-in only signs in an
existing, active employee whose email Google has verified.
"""

from fastapi import APIRouter, Request, Response, status

from app.auth.cookies import clear_session_cookie, set_session_cookie
from app.auth.dependencies import CSRF_HEADER, CurrentPrincipal, SettingsDep
from app.auth.google import verify_google_id_token
from app.auth.service import (
    CsrfError,
    Principal,
    authenticate,
    authenticate_google,
    change_own_password,
    find_session,
    permissions_of,
    revoke_session,
    session_end_reason,
    session_expiry,
    start_session,
    utcnow,
)
from app.core.security import tokens_match
from app.db.session import SessionDep
from app.models.auth import Employee
from app.schemas.auth import ChangePasswordRequest, GoogleSignInRequest, LoginRequest, SessionResponse, StaffUser
from app.schemas.errors import ErrorResponse
from app.services.audit import ClientInfo, record_event

router = APIRouter(prefix="/auth", tags=["auth"])


def _session_response(principal: Principal, settings: SettingsDep) -> SessionResponse:
    return SessionResponse(
        user=StaffUser.from_employee(principal.employee, principal.permissions),
        csrf_token=principal.session.csrf_token,
        expires_at=session_expiry(principal.session, settings),
    )


def _begin_session(
    employee: Employee, action: str, request: Request, response: Response, db: SessionDep, settings: SettingsDep
) -> SessionResponse:
    client = ClientInfo.from_request(request)
    # A browser signing in again gets a fresh session; the old one stops working.
    previous = find_session(db, request.cookies.get(settings.session_cookie_name))
    if previous is not None:
        revoke_session(previous, "replaced")

    auth_session, token = start_session(db, settings, employee, client)
    record_event(db, action, actor=employee, target=employee, client=client)
    db.commit()

    set_session_cookie(response, settings, token)
    principal = Principal(employee=employee, session=auth_session, permissions=permissions_of(employee))
    return _session_response(principal, settings)


@router.post(
    "/login",
    response_model=SessionResponse,
    summary="Sign in with email and password",
    responses={
        401: {"model": ErrorResponse, "description": "Wrong email or password (`invalid_credentials`)"},
        403: {"model": ErrorResponse, "description": "Correct password, deactivated account (`account_disabled`)"},
        429: {"model": ErrorResponse, "description": "Temporarily locked after repeated failures (`account_locked`)"},
    },
)
def login(body: LoginRequest, request: Request, response: Response, db: SessionDep, settings: SettingsDep) -> SessionResponse:
    employee = authenticate(db, settings, body.email, body.password, ClientInfo.from_request(request))
    return _begin_session(employee, "auth.login_succeeded", request, response, db, settings)


@router.post(
    "/google",
    response_model=SessionResponse,
    summary="Sign in an existing employee with a Google (Firebase) ID token",
    responses={
        401: {"model": ErrorResponse, "description": "Token not signed by Google for this project, expired, or email unverified (`invalid_google_token`)"},
        403: {
            "model": ErrorResponse,
            "description": "No staff account has this email (`google_account_not_staff`), or it is deactivated (`account_disabled`)",
        },
        503: {"model": ErrorResponse, "description": "Google sign-in is turned off on this server (`google_sign_in_unavailable`)"},
    },
)
def google_login(
    body: GoogleSignInRequest, request: Request, response: Response, db: SessionDep, settings: SettingsDep
) -> SessionResponse:
    claims = verify_google_id_token(settings, body.id_token)
    employee = authenticate_google(db, claims["email"], ClientInfo.from_request(request))
    return _begin_session(employee, "auth.google_login_succeeded", request, response, db, settings)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Sign out and end the session on the server",
    responses={403: {"model": ErrorResponse, "description": "Missing or wrong X-CSRF-Token (`csrf_failed`)"}},
)
def logout(
    request: Request,
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
) -> None:
    auth_session = find_session(db, request.cookies.get(settings.session_cookie_name))
    if auth_session is not None and session_end_reason(auth_session, settings, utcnow()) is None:
        given = request.headers.get(CSRF_HEADER, "")
        if not given or not tokens_match(auth_session.csrf_token, given):
            raise CsrfError()
        revoke_session(auth_session, "logout")
        employee = auth_session.employee
        record_event(db, "auth.logout", actor=employee, target=employee, client=ClientInfo.from_request(request))
        db.commit()
    clear_session_cookie(response, settings)


@router.get(
    "/me",
    response_model=SessionResponse,
    summary="The signed-in employee, their permissions and the CSRF token",
    responses={401: {"model": ErrorResponse, "description": "No session, or it has ended"}},
)
def me(principal: CurrentPrincipal, settings: SettingsDep) -> SessionResponse:
    return _session_response(principal, settings)


@router.post(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change your own password. Signs out your other sessions.",
    responses={
        400: {"model": ErrorResponse, "description": "Wrong current password or the new one breaks the rules"},
        429: {"model": ErrorResponse, "description": "Locked after repeated wrong current passwords"},
    },
)
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    principal: CurrentPrincipal,
    db: SessionDep,
    settings: SettingsDep,
) -> None:
    change_own_password(
        db,
        settings,
        principal,
        body.current_password,
        body.new_password,
        ClientInfo.from_request(request),
    )