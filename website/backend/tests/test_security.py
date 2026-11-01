import pytest
from argon2 import PasswordHasher

from app.core.security import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    hash_password,
    hash_session_token,
    new_csrf_token,
    new_session_token,
    password_needs_rehash,
    password_problem,
    tokens_match,
    verify_password,
)

PASSWORD = "correct horse battery staple"


def test_passwords_are_hashed_with_argon2id() -> None:
    hashed = hash_password(PASSWORD)

    assert hashed.startswith("$argon2id$")
    assert PASSWORD not in hashed


def test_the_same_password_gets_a_different_salt_each_time() -> None:
    assert hash_password(PASSWORD) != hash_password(PASSWORD)


def test_verification_accepts_only_the_right_password() -> None:
    hashed = hash_password(PASSWORD)

    assert verify_password(hashed, PASSWORD) is True
    assert verify_password(hashed, PASSWORD.upper()) is False
    assert verify_password(hashed, "") is False


@pytest.mark.parametrize("bad_hash", ["", "not-a-hash", "$argon2id$v=19$m=1,t=1,p=1$broken"])
def test_verification_of_a_malformed_hash_fails_closed(bad_hash: str) -> None:
    assert verify_password(bad_hash, PASSWORD) is False


def test_hashes_made_with_weaker_parameters_are_flagged_for_rehash() -> None:
    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(PASSWORD)

    assert password_needs_rehash(weak) is True
    assert password_needs_rehash(hash_password(PASSWORD)) is False
    assert verify_password(weak, PASSWORD) is True


@pytest.mark.parametrize(
    ("password", "expected"),
    [
        ("a" * (PASSWORD_MIN_LENGTH - 1), "at least"),
        ("a" * (PASSWORD_MAX_LENGTH + 1), "at most"),
        (" " * PASSWORD_MIN_LENGTH, "only spaces"),
        ("Someone@Example.test", "same as the email"),
    ],
)
def test_password_rules_reject_weak_passwords(password: str, expected: str) -> None:
    problem = password_problem(password, email="someone@example.test")

    assert problem is not None and expected in problem


def test_password_rules_accept_a_long_passphrase() -> None:
    assert password_problem(PASSWORD, email="someone@example.test") is None


def test_session_tokens_are_random_and_only_their_digest_is_kept() -> None:
    first, second = new_session_token(), new_session_token()

    assert first != second
    assert len(first) >= 43  # 32 random bytes, base64url
    digest = hash_session_token(first)
    assert len(digest) == 32
    assert digest == hash_session_token(first)
    assert first.encode() not in digest


def test_csrf_tokens_compare_exactly() -> None:
    token = new_csrf_token()

    assert tokens_match(token, token)
    assert not tokens_match(token, token[:-1])
    assert not tokens_match(token, "")
