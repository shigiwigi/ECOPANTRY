"""Centralized error handling.

Every error leaves the API in one shape (`ErrorResponse`): a human-readable
`detail` string, a stable machine-readable `code`, and, for invalid requests,
a list of field `errors`. The frontend API client shows `detail` directly.
Internal details (stack traces, SQL, connection strings) are logged, never sent.
"""

import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.errors import ErrorResponse, FieldError

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for errors raised on purpose by API code.

    Subclass it (or raise it directly) in feature modules instead of building
    responses by hand, so every module reports errors the same way.
    """

    status_code: int = 400
    code: str = "bad_request"
    detail: str = "The request could not be processed."

    def __init__(
        self,
        detail: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.detail = detail or self.detail
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        # Extra response headers, e.g. a Set-Cookie that clears an invalid session.
        self.headers = headers
        super().__init__(self.detail)


class NotAuthenticatedError(AppError):
    status_code = 401
    code = "not_authenticated"
    detail = "Sign in to continue."


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"
    detail = "You don't have permission to do that."


class TooManyRequestsError(AppError):
    status_code = 429
    code = "too_many_requests"
    detail = "Too many requests. Try again shortly."


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
    detail = "Not found."


class ConflictError(AppError):
    status_code = 409
    code = "conflict"
    detail = "The request conflicts with the current state."


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "service_unavailable"
    detail = "The service is temporarily unavailable. Try again shortly."


_HTTP_CODES: dict[int, tuple[str, str]] = {
    400: ("bad_request", "The request could not be processed."),
    401: ("not_authenticated", "Sign in to continue."),
    403: ("forbidden", "You don't have permission to do that."),
    404: ("not_found", "Not found."),
    405: ("method_not_allowed", "That method isn't allowed on this endpoint."),
    409: ("conflict", "The request conflicts with the current state."),
    429: ("too_many_requests", "Too many requests. Try again shortly."),
}


def _response(status_code: int, body: ErrorResponse, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=body.model_dump(exclude_none=True), headers=headers)


async def _app_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return _response(exc.status_code, ErrorResponse(detail=exc.detail, code=exc.code), headers=exc.headers)


async def _http_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    try:
        phrase = HTTPStatus(exc.status_code).phrase
    except ValueError:
        phrase = "Error"
    default_code, default_detail = _HTTP_CODES.get(exc.status_code, ("http_error", phrase))
    # Starlette's own 404/405 carry the bare status phrase; replace it with our wording.
    detail = default_detail if exc.detail in (None, "", phrase) else str(exc.detail)
    return _response(exc.status_code, ErrorResponse(detail=detail, code=default_code), headers=exc.headers)


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    # Only location, message and type: the raw `input` could echo back secrets such as passwords.
    errors = [
        FieldError(loc=[str(part) for part in error.get("loc", ())], msg=str(error.get("msg", "")), type=str(error.get("type", "")))
        for error in exc.errors()
    ]
    body = ErrorResponse(detail="Some fields are missing or invalid.", code="validation_error", errors=errors)
    return _response(422, body)


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    body = ErrorResponse(detail="The server had a problem. Try again shortly.", code="internal_error")
    return _response(500, body)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_error)
