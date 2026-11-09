"""Verifying Google sign-in (Firebase Authentication ID tokens).

Firebase Admin is initialised lazily, the first time a token is checked, for
the project named by `FIREBASE_PROJECT_ID`. Importing the API never contacts
Google or reads credentials, and an app with Google sign-in turned off
(`FIREBASE_PROJECT_ID` empty) never loads Firebase at all.

Verifying an ID token needs only the project ID: Firebase Admin checks the
signature against Google's public keys, the audience, the issuer and the
expiry. No service-account key is used or needed.
"""

import logging
import threading
from typing import Any

import firebase_admin
from firebase_admin import auth as fb_auth

from app.core.config import Settings
from app.core.errors import AppError, NotAuthenticatedError

logger = logging.getLogger(__name__)

_apps: dict[str, firebase_admin.App] = {}
_lock = threading.Lock()


class GoogleSignInUnavailableError(AppError):
    status_code = 503
    code = "google_sign_in_unavailable"
    detail = "Google sign-in isn't set up on this server. Sign in with your email and password."


class InvalidGoogleTokenError(NotAuthenticatedError):
    code = "invalid_google_token"
    detail = "Google sign-in couldn't be verified. Try again."


def _firebase_app(project_id: str) -> firebase_admin.App:
    with _lock:
        app = _apps.get(project_id)
        if app is None:
            # A named app per project, so tests or settings with another project never share one.
            app = firebase_admin.initialize_app(options={"projectId": project_id}, name=f"ecopantry-{project_id}")
            _apps[project_id] = app
        return app


def verify_google_id_token(settings: Settings, id_token: str) -> dict[str, Any]:
    """Return the token's claims if Google signed it for our project and the email is verified; else raise.

    Never decode the token without checking its signature: until then the
    claims are attacker-controlled, so a hand-made token could name any
    employee's email.
    """
    if settings.firebase_project_id is None:
        raise GoogleSignInUnavailableError()
    if not id_token or len(id_token) > 8192:
        raise InvalidGoogleTokenError()
    try:
        claims = fb_auth.verify_id_token(id_token, app=_firebase_app(settings.firebase_project_id), check_revoked=False)
    except Exception as err:
        # The reason can include token contents; log only its type.
        logger.info("Rejected a Google ID token (%s)", type(err).__name__)
        raise InvalidGoogleTokenError() from err
    if claims.get("email_verified") is not True or not isinstance(claims.get("email"), str):
        raise InvalidGoogleTokenError()
    return dict(claims)
