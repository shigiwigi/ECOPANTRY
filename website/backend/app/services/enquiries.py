"""Contact-form enquiries: public submission, rate limiting, the administrators' inbox, retention.

Enquiries hold personal data (name, email), so they never appear in audit details or logs, and
no IP address or user agent is stored with them.
"""

import hashlib
import re
import threading
import time
import uuid
from collections import deque
from datetime import timedelta
from typing import Any

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from app.auth.service import utcnow
from app.core.errors import AppError, NotFoundError, TooManyRequestsError
from app.models.auth import Employee
from app.models.enquiries import EMAIL_MAX_LENGTH, MESSAGE_MAX_LENGTH, NAME_MAX_LENGTH, Enquiry
from app.services.audit import ClientInfo, record_event

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")  # the same rule as the table's CHECK constraint
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 3600
_MAX_TRACKED_KEYS = 10_000


class InvalidEnquiryError(AppError):
    status_code = 400
    code = "invalid_enquiry"


class SlidingWindowLimiter:
    """In-process limiter: at most `limit` hits per key per `window` seconds.

    Caveats, accepted for this prototype: counters live in one process's memory, so they reset on a
    restart and aren't shared between instances. The per-IP key is the direct peer address
    (`ClientInfo`). In production that is Vercel's rewrite / Render's proxy rather than the visitor,
    so there the per-IP limit acts as a cap on all submissions and the per-email limit does the
    per-person work. X-Forwarded-For is never trusted (anyone can send it).
    """

    def __init__(self, limit: int = RATE_LIMIT, window: float = RATE_WINDOW_SECONDS) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def retry_after(self, key: str, *, now: float | None = None) -> int | None:
        """Seconds until `key` may submit again, or None if it may now (records nothing)."""
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                return None
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return max(1, int(hits[0] + self.window - now) + 1)
            return None

    def record(self, key: str, *, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            if len(self._hits) >= _MAX_TRACKED_KEYS:
                for stale in [k for k, h in self._hits.items() if not h or h[-1] <= now - self.window]:
                    del self._hits[stale]
            self._hits.setdefault(key, deque()).append(now)


def check_rate_limit(limiter: SlidingWindowLimiter, *, ip: str | None, email: str) -> None:
    """Refuse (429) when the address or the email already sent too many; otherwise count this one."""
    keys = [f"email:{hashlib.sha256(email.strip().lower().encode()).hexdigest()}"]
    if ip:
        keys.append(f"ip:{ip}")
    waits = [w for key in keys if (w := limiter.retry_after(key)) is not None]
    if waits:
        raise TooManyRequestsError(
            "You've sent several messages recently. Please try again later.",
            headers={"Retry-After": str(max(waits))},
        )
    for key in keys:
        limiter.record(key)


def create_enquiry(db: Session, *, name: str, email: str, message: str) -> Enquiry:
    name = " ".join(name.split())
    email = email.strip().lower()
    message = message.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not name or len(name) > NAME_MAX_LENGTH:
        raise InvalidEnquiryError(f"Enter your name (up to {NAME_MAX_LENGTH} characters).")
    if len(email) > EMAIL_MAX_LENGTH or not EMAIL_PATTERN.match(email):
        raise InvalidEnquiryError("Enter a valid email address.")
    if not message or len(message) > MESSAGE_MAX_LENGTH:
        raise InvalidEnquiryError(f"Write a message of up to {MESSAGE_MAX_LENGTH} characters.")
    enquiry = Enquiry(name=name, email=email, message=message)
    db.add(enquiry)
    return enquiry


def inbox_query(*, unread: bool | None) -> Select[Any]:
    statement = select(Enquiry)
    if unread is True:
        statement = statement.where(Enquiry.read_at.is_(None))
    elif unread is False:
        statement = statement.where(Enquiry.read_at.is_not(None))
    return statement


def mark_read(db: Session, enquiry_id: uuid.UUID, *, by: Employee, client: ClientInfo) -> Enquiry:
    enquiry = db.get(Enquiry, enquiry_id)
    if enquiry is None:
        raise NotFoundError("No such enquiry.")
    if enquiry.read_at is None:
        enquiry.read_at = utcnow()
        record_event(db, "enquiry.read", actor=by, target=enquiry, client=client)
    return enquiry


def purge_older_than(db: Session, *, months: int) -> int:
    """Delete enquiries created more than `months` months ago (30-day months). Returns how many."""
    cutoff = utcnow() - timedelta(days=30 * months)
    result = db.execute(delete(Enquiry).where(Enquiry.created_at < cutoff))
    return int(getattr(result, "rowcount", 0) or 0)
