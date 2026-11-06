"""ORM models.

Import every model module here so `Base.metadata` is complete when Alembic
autogenerates migrations.
"""

from app.db.base import Base
from app.models.audit import AuditEvent
from app.models.auth import AuthSession, Employee, Permission, Role, role_permissions
from app.models.catalogue import CatalogueCategory, CatalogueProduct
from app.models.devices import Device, DeviceLiveUsage, SensorReading
from app.models.rfid import RfidCard, RfidScan

__all__ = [
    "AuditEvent",
    "AuthSession",
    "Base",
    "CatalogueCategory",
    "CatalogueProduct",
    "Device",
    "DeviceLiveUsage",
    "Employee",
    "Permission",
    "RfidCard",
    "RfidScan",
    "Role",
    "SensorReading",
    "role_permissions",
]
