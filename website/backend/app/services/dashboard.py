"""Counts for the dashboard. Each is one SQL aggregate; the route decides which the caller may see.

Rules are shared with the pages the figures link to: low stock is the ingredients rule
(`reorder_level` set and non-expired remaining at or below it), near-expiry and expired
come from `app.services.expiry`, alerts from the `alerts` table (unresolved only).
"""

from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.alerts import Alert
from app.models.auth import Employee
from app.models.inventory import Batch, Ingredient
from app.schemas.dashboard import TopAlertOut
from app.services import expiry


def low_stock_count(db: Session, *, today: date) -> int:
    remaining = (
        select(func.coalesce(func.sum(Batch.remaining_quantity), 0))
        .where(Batch.ingredient_id == Ingredient.id, Batch.expiry_on >= today)
        .correlate(Ingredient)
        .scalar_subquery()
    )
    statement = (
        select(func.count())
        .select_from(Ingredient)
        .where(Ingredient.is_active.is_(True), Ingredient.reorder_level.is_not(None), remaining <= Ingredient.reorder_level)
    )
    return int(db.scalar(statement) or 0)


def expiry_counts(db: Session, *, today: date, days: int) -> tuple[int, int]:
    return (
        expiry.count_rows(db, expiry.near_expiry_query(today=today, days=days)),
        expiry.count_rows(db, expiry.expired_query(today=today)),
    )


def alert_counts(db: Session) -> tuple[int, int]:
    open_, acknowledged = db.execute(
        select(
            func.count(case((Alert.status == "open", 1))),
            func.count(case((Alert.status == "acknowledged", 1))),
        ).where(Alert.status != "resolved")
    ).one()
    return int(open_), int(acknowledged)


def top_open_alert(db: Session) -> TopAlertOut | None:
    """Critical before warning before info; the waste bin first among equals, then the newest."""
    severity_rank = case({"critical": 0, "warning": 1}, value=Alert.severity, else_=2)
    alert = db.scalars(
        select(Alert)
        .where(Alert.status == "open")
        .order_by(severity_rank, (Alert.metric != "weight_g"), Alert.opened_at.desc(), Alert.id)
        .limit(1)
    ).first()
    if alert is None:
        return None
    return TopAlertOut(
        id=str(alert.id),
        label=alert.threshold.label,
        metric=alert.metric,  # type: ignore[arg-type]
        severity=alert.severity,  # type: ignore[arg-type]
        value=alert.last_value if alert.last_value is not None else alert.trigger_value,
        opened_at=alert.opened_at,
    )


def active_staff_count(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(Employee).where(Employee.status == "active")) or 0)
