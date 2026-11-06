"""The session cookie: HttpOnly, Path=/.

Where cookies are Secure (always in production) the cookie is SameSite=None
with a __Host- name, so a frontend on another origin (Firebase Hosting) can
still send it; unsafe requests are protected by the X-CSRF-Token header.
In local development and tests it is a plain SameSite=Lax cookie, because
browsers and the test client drop Secure cookies over plain http.
"""

from typing import Literal

from fastapi import Response

from app.core.config import Settings


def _same_site(settings: Settings) -> Literal["none", "lax"]:
    return "none" if settings.cookie_secure else "lax"


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=int(settings.session_absolute_timeout.total_seconds()),
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite=_same_site(settings),
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite=_same_site(settings),
    )


def clear_session_cookie_headers(settings: Settings) -> dict[str, str]:
    """A Set-Cookie header that removes the session cookie, for error responses."""
    response = Response()
    clear_session_cookie(response, settings)
    return {"set-cookie": response.headers["set-cookie"]}
