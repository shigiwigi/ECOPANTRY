"""Password hashing, password rules and session tokens.

Passwords are hashed with Argon2id (argon2-cffi, RFC 9106 low-memory profile).
Session tokens are random; only their SHA-256 is stored, so a copy of the
database can't be used to sign in. Nothing in this module logs its inputs.
"""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128

# argon2-cffi's defaults are the RFC 9106 low-memory profile: Argon2id, t=3, m=64 MiB, p=4.
_hasher = PasswordHasher()

# Verified against when an email has no account, so the response takes as long as a real check.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """True when `password` matches. Never raises for a wrong password or a malformed hash."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """True when the hash was made with older parameters and should be replaced after a successful sign-in."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def burn_password_check(password: str) -> None:
    """Spend the same time as a real verification, for unknown accounts."""
    verify_password(_DUMMY_HASH, password)


def password_problem(password: str, *, email: str | None = None) -> str | None:
    """A user-facing reason the password can't be used, or None if it's acceptable."""
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"Use at least {PASSWORD_MIN_LENGTH} characters."
    if len(password) > PASSWORD_MAX_LENGTH:
        return f"Use at most {PASSWORD_MAX_LENGTH} characters."
    if not password.strip():
        return "The password can't be only spaces."
    if email and password.strip().lower() == email.strip().lower():
        return "The password can't be the same as the email address."
    return None


def new_session_token() -> str:
    """256 bits of randomness, URL-safe, for the session cookie."""
    return secrets.token_urlsafe(32)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def tokens_match(expected: str, given: str) -> bool:
    return secrets.compare_digest(expected.encode("utf-8"), given.encode("utf-8"))
