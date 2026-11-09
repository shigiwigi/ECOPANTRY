"""The dashboard summary. A figure is null when the caller's role may not read it elsewhere."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

AlertMetric = Literal["temperature_c", "humidity_pct", "weight_g"]
Severity = Literal["info", "warning", "critical"]


class TopAlertOut(BaseModel):
    id: str
    label: str = Field(description="The threshold's label, e.g. `Waste bin nearly full`.")
    metric: AlertMetric
    severity: Severity
    value: float | None = Field(description="Latest value seen, in the metric's storage unit (grams for weight).")
    opened_at: datetime


class DashboardSummaryOut(BaseModel):
    low_stock_ingredients: int | None = Field(description="Needs `inventory.view`.")
    near_expiry_batches: int | None = Field(description="Needs `expiry.view`.")
    expired_batches: int | None = Field(description="Needs `expiry.view`.")
    expiry_window_days: int = Field(description="The near-expiry window used.")
    open_alerts: int | None = Field(description="Needs `alerts.view`. Alerts nobody has acknowledged.")
    acknowledged_alerts: int | None = Field(description="Needs `alerts.view`.")
    top_alert: TopAlertOut | None = Field(description="Most urgent open alert (needs `alerts.view`), or null.")
    active_staff: int | None = Field(description="Needs `employees.view`.")
    today: date
    server_time: datetime
