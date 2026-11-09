"""Audit log viewer schema. Details are sanitised when written; nothing is added here.

The client IP address and user agent are stored but not returned.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models.audit import AuditEvent
from app.schemas.records import EmployeeRef


class AuditEventOut(BaseModel):
    id: int
    occurred_at: datetime
    actor_type: str
    actor: EmployeeRef | None
    action: str
    target_type: str | None
    target_id: str | None
    details: dict[str, Any]

    @classmethod
    def from_event(cls, event: AuditEvent, actor: EmployeeRef | None) -> "AuditEventOut":
        return cls(
            id=event.id,
            occurred_at=event.occurred_at,
            actor_type=event.actor_type,
            actor=actor,
            action=event.action,
            target_type=event.target_type,
            target_id=event.target_id,
            details=event.details,
        )
