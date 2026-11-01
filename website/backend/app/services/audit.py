"""Writing audit events. Callers commit; the event is saved with the change it describes."""

import ipaddress
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.audit import AuditEvent
from app.models.auth import Employee

ActorType = Literal["employee", "anonymous", "cli"]


@dataclass(frozen=True)
class ClientInfo:
    """Where a request came from, for sessions and audit events."""

    ip_address: str | None = None
    user_agent: str | None = None

    @classmethod
    def from_request(cls, request: Request) -> "ClientInfo":
        # The direct peer only. X-Forwarded-For is not trusted: anyone can send it.
        host = request.client.host if request.client else None
        try:
            ip = str(ipaddress.ip_address(host)) if host else None
        except ValueError:
            ip = None
        agent = request.headers.get("user-agent")
        return cls(ip_address=ip, user_agent=agent[:255] if agent else None)


CLI = ClientInfo()


def record_event(
    db: Session,
    action: str,
    *,
    actor: Employee | None = None,
    actor_type: ActorType | None = None,
    target: Employee | None = None,
    client: ClientInfo = CLI,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    """Add an audit event to the session. Never put passwords, tokens or hashes in `details`."""
    event = AuditEvent(
        action=action,
        actor_type=actor_type or ("employee" if actor else "anonymous"),
        actor_employee_id=actor.id if actor else None,
        target_type="employee" if target else None,
        target_id=str(target.id) if target else None,
        ip_address=client.ip_address,
        user_agent=client.user_agent,
        details=details or {},
    )
    db.add(event)
    return event
