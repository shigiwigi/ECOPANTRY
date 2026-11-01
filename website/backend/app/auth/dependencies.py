"""FastAPI dependencies for protected routes.

Every route that isn't deliberately public must depend on `CurrentPrincipal`
or `require_permission(...)`. `tests/test_route_protection.py` fails when a
route under /api/v1 answers without a session and isn't on its public list.

    @router.post("/batches")
    def create_batch(principal: Annotated[Principal, Depends(require_permission(Permission.BATCHES_MANAGE))]): ...

Authenticated requests with an unsafe method (POST, PUT, PATCH, DELETE) must
also send the session's CSRF token in the `X-CSRF-Token` header.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request

from app.auth.cookies import clear_session_cookie_headers
from app.auth.permissions import Permission
from app.auth.service import (
    CsrfError,
    Principal,
    SessionEndedError,
    find_session,
    permissions_of,
    session_end_reason,
    touch_session,
    utcnow,
)
from app.core.config import Settings
from app.core.errors import ForbiddenError, NotAuthenticatedError
from app.core.security import tokens_match
from app.db.session import SessionDep

CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def get_settings_from_app(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_settings_from_app)]


def get_principal(request: Request, db: SessionDep, settings: SettingsDep) -> Principal:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise NotAuthenticatedError()

    auth_session = find_session(db, token)
    now = utcnow()
    if auth_session is None or session_end_reason(auth_session, settings, now) is not None:
        # Tell the browser to drop the dead cookie.
        raise SessionEndedError(headers=clear_session_cookie_headers(settings))

    if request.method not in SAFE_METHODS:
        given = request.headers.get(CSRF_HEADER, "")
        if not given or not tokens_match(auth_session.csrf_token, given):
            raise CsrfError()

    if touch_session(auth_session, now):
        db.commit()

    employee = auth_session.employee
    return Principal(employee=employee, session=auth_session, permissions=permissions_of(employee))


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]


def require_permission(permission: Permission) -> Callable[[Principal], Principal]:
    """A dependency that allows the request only if the signed-in role has `permission`."""

    def check(principal: CurrentPrincipal) -> Principal:
        if not principal.has(permission):
            raise ForbiddenError()
        return principal

    check.__name__ = f"require_{permission.value.replace('.', '_')}"
    return check
