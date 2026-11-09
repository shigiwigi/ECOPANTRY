"""ORM models.

Import every model module here so `Base.metadata` is complete when Alembic
autogenerates migrations.
"""

from app.db.base import Base
from app.models.alerts import Alert, Threshold
from app.models.audit import AuditEvent
from app.models.auth import AuthSession, Employee, Permission, Role, role_permissions
from app.models.catalogue import CatalogueCategory, CatalogueProduct
from app.models.devices import Device, DeviceLiveUsage, SensorReading
from app.models.enquiries import Enquiry
from app.models.inventory import Batch, Ingredient, StockMovement, StorageArea, Unit
from app.models.ph import PhRecord
from app.models.rfid import RfidCard, RfidScan
from app.models.waste import WasteRecord

__all__ = [
    "Alert",
    "AuditEvent",
    "AuthSession",
    "Base",
    "Batch",
    "CatalogueCategory",
    "CatalogueProduct",
    "Device",
    "DeviceLiveUsage",
    "Employee",
    "Enquiry",
    "Ingredient",
    "Permission",
    "PhRecord",
    "RfidCard",
    "RfidScan",
    "Role",
    "SensorReading",
    "StockMovement",
    "StorageArea",
    "Threshold",
    "Unit",
    "WasteRecord",
    "role_permissions",
]
