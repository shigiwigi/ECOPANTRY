"""Messages sent through the public website's contact form (migration 0009).

This is the only table the public can write to. It holds personal data (a
name and an email address), so it is kept for 12 months after `created_at`
and then deleted, unlike business records which are never deleted. Only
administrators (`enquiries.view`) can read it. No IP address or user agent is
stored. See docs/DATA_MODEL.md.
"""

import uuid
from datetime import datetime
from typing import ClassVar

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

NAME_MAX_LENGTH = 120
EMAIL_MAX_LENGTH = 254
MESSAGE_MAX_LENGTH = 5000
RETENTION_MONTHS = 12


class Enquiry(Base):
    __tablename__ = "enquiries"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("email = lower(btrim(email))", name="email_normalized"),
        CheckConstraint(r"email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'", name="email_format"),
        CheckConstraint(
            f"length(btrim(message)) > 0 AND length(message) <= {MESSAGE_MAX_LENGTH}", name="message_length"
        ),
        CheckConstraint("(handled_at IS NULL) = (handled_by_id IS NULL)", name="handled_by_matches"),
    )
    audit_target_type: ClassVar[str] = "enquiry"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH))
    email: Mapped[str] = mapped_column(String(EMAIL_MAX_LENGTH))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    # First opened by an administrator.
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handled_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"))

    def __repr__(self) -> str:  # No personal data in logs.
        return f"<Enquiry {self.id}>"
