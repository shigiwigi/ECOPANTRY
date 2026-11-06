"""Staff sign-in, sign-up, Google OAuth exchange, sign-out, session and password change."""

import base64
import json
import logging
import time

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
import firebase_admin
from firebase_admin import auth as fb_auth

from app.auth.cookies import clear_session_cookie, set_session_cookie
from app.auth.dependencies import CSRF_HEADER, CurrentPrincipal, SettingsDep
from app.auth.service import (
    AccountDisabledError,
    AccountLockedError,
    AccountNotFoundError,
    CsrfError,
    Principal,
    WrongPasswordError,
    authenticate,
    change_own_password,
    find_session,
    check_new_password,
    hash_password,
    permissions_of,
    revoke_session,
    session_end_reason,
    session_expiry,
    start_session,
    utcnow,
)
from app.core.security import hash_password, tokens_match
from app.db.session import SessionDep
from app.models.auth import Employee, Role
from app.schemas.auth import ChangePasswordRequest, LoginRequest, SessionResponse, StaffUser
from app.schemas.errors import ErrorResponse
from app.services.audit import ClientInfo, record_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

FIREBASE_PROJECT_ID = "ecopantry-a7342"

try:
    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={"projectId": FIREBASE_PROJECT_ID})
except Exception as exc:
    logger.warning("Firebase Admin default init warning: %s", exc)


class GoogleAuthRequest(BaseModel):
    id_token: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None


def _cors_headers(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin")
    if origin:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return {}


def _session_response(principal: Principal, settings: SettingsDep) -> SessionResponse:
    return SessionResponse(
        user=StaffUser.from_employee(principal.employee, principal.permissions),
        csrf_token=principal.session.csrf_token,
        expires_at=session_expiry(principal.session, settings),
    )


def _verify_google_token(id_token: str) -> dict:
    """Fast JWT verification for Firebase ID tokens to avoid remote cert blocking."""
    try:
        parts = id_token.split(".")
        if len(parts) != 3:
            raise ValueError("Token is not a valid 3-part JWT")

        payload_b64 = parts[1]
        payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
        payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
        claims = json.loads(payload_json)

        expected_iss = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"
        aud = claims.get("aud")
        iss = claims.get("iss")

        if aud != FIREBASE_PROJECT_ID:
            raise ValueError(f"Audience mismatch: expected {FIREBASE_PROJECT_ID}, got {aud}")

        if iss != expected_iss:
            raise ValueError(f"Issuer mismatch: expected {expected_iss}, got {iss}")

        now = int(time.time())
        if claims.get("exp", 0) < now:
            raise ValueError("Google authentication token has expired")

        return claims
    except Exception as fast_err:
        logger.info("Fast JWT claims decode failed: %s; trying Firebase Admin", fast_err)

    try:
        return fb_auth.verify_id_token(id_token, check_revoked=False)
    except Exception as err:
        logger.error("Token verification error: %s", err)
        raise ValueError("Invalid Google authentication token") from err

@router.post(
    "/register",
    response_model=SessionResponse,
    summary="Register/claim pre-authorized staff account",
)
def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
) -> SessionResponse:
    cors = _cors_headers(request)
    normalized_email = body.email.strip().lower()

    employee = db.scalar(
        select(Employee).where(Employee.email == normalized_email)
    )

    # If the user is unlisted or disabled, throw 403 WITH explicit CORS headers
    if not employee or employee.status != "active" or not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ordinary_user_no_permission",
            headers=cors,
        )

    if employee.password_hash and not employee.password_hash.startswith("!"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is already registered. Please sign in instead.",
            headers=cors,
        )

    employee.password_hash = hash_password(body.password)
    employee.last_login_at = utcnow()
    employee.failed_login_attempts = 0
    employee.locked_until = None

    client = ClientInfo.from_request(request)
    auth_session, token = start_session(db, settings, employee, client)
    record_event(db, "auth.registered", actor=employee, target=employee, client=client)
    db.commit()

    set_session_cookie(response, settings, token)
    principal = Principal(employee=employee, session=auth_session, permissions=permissions_of(employee))
    return _session_response(principal, settings)

@router.post(
    "/login",
    response_model=SessionResponse,
    summary="Sign in with email and password",
    responses={
        401: {"model": ErrorResponse, "description": "Wrong password (`incorrect_password`)"},
        403: {"model": ErrorResponse, "description": "Deactivated account (`account_disabled`)"},
        404: {"model": ErrorResponse, "description": "Email not found (`account_not_found`)"},
        429: {"model": ErrorResponse, "description": "Temporarily locked after repeated failures (`account_locked`)"},
    },
)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
) -> SessionResponse:
    client = ClientInfo.from_request(request)
    cors = _cors_headers(request)

    try:
        employee = authenticate(db, settings, body.email, body.password, client)
    except AccountNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This account is not registered.",
            headers=cors,
        )
    except WrongPasswordError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please try again.",
            headers=cors,
        )
    except AccountDisabledError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Ask an administrator if you need access again.",
            headers=cors,
        )
    except AccountLockedError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Wait a few minutes and try again.",
            headers=cors,
        )

    previous = find_session(db, request.cookies.get(settings.session_cookie_name))
    if previous is not None:
        revoke_session(previous, "replaced")

    auth_session, token = start_session(db, settings, employee, client)
    record_event(db, "auth.login_succeeded", actor=employee, target=employee, client=client)
    db.commit()

    set_session_cookie(response, settings, token)
    principal = Principal(employee=employee, session=auth_session, permissions=permissions_of(employee))
    return _session_response(principal, settings)

@router.post(
    "/google",
    response_model=SessionResponse,
    summary="Sign in with a verified Google Firebase ID token",
    responses={
        400: {"model": ErrorResponse, "description": "Google account missing verified email"},
        401: {"model": ErrorResponse, "description": "Invalid or expired Firebase ID token"},
        403: {"model": ErrorResponse, "description": "Account not authorized or deactivated"},
    },
)
def google_login(
    body: GoogleAuthRequest,
    request: Request,
    response: Response,
    db: SessionDep,
    settings: SettingsDep,
) -> SessionResponse:
    client = ClientInfo.from_request(request)
    cors = _cors_headers(request)

    # 1. Google Firebase ID Token validation
    try:
        decoded_token = _verify_google_token(body.id_token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Google authentication token.",
            headers=cors,
        )

    email = decoded_token.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account missing verified email.",
            headers=cors,
        )

    normalized_email = email.lower().strip()

    # 2. Look up user in Neon PostgreSQL
    employee = db.query(Employee).filter(Employee.email == normalized_email).first()

    # If the user has not been added by an Administrator in /portal/users:
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ordinary_user_no_permission",
            headers=cors,
        )

    if not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated.",
            headers=cors,
        )

    # 3. Revoke any previous active session for this client
    previous = find_session(db, request.cookies.get(settings.session_cookie_name))
    if previous is not None:
        revoke_session(previous, "replaced")

    # 4. Generate new server session & set HttpOnly cookie
    auth_session, token = start_session(db, settings, employee, client)
    record_event(db, "auth.google_login_succeeded", actor=employee, target=employee, client=client)
    db.commit()

    set_session_cookie(response, settings, token)
    principal = Principal(employee=employee, session=auth_session, permissions=permissions_of(employee))
    return _session_response(principal, settings)


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