"""The session cookie: HttpOnly, SameSite=Lax, Path=/, and Secure with a __Host- name outside development."""

from fastapi import Response

from app.core.config import Settings


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=int(settings.session_absolute_timeout.total_seconds()),
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.session_cookie_name, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax"
    )


def clear_session_cookie_headers(settings: Settings) -> dict[str, str]:
    """A Set-Cookie header that removes the session cookie, for error responses."""
    response = Response()
    clear_session_cookie(response, settings)
    return {"set-cookie": response.headers["set-cookie"]}
