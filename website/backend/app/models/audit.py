"""Append-only audit trail. A database trigger (migration 0002) rejects UPDATE and DELETE."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, String, func, text
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

ACTOR_TYPES = ("employee", "anonymous", "cli", "device")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        CheckConstraint(f"actor_type IN {ACTOR_TYPES!r}", name="actor_type_valid"),
        CheckConstraint(
            "(actor_type = 'employee') = (actor_employee_id IS NOT NULL)", name="actor_employee_matches_type"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_employee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), index=True
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(64))
    ip_address: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(255))
    # Small structured context. Never passwords, tokens, hashes or typed-in emails of unknown accounts.
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
