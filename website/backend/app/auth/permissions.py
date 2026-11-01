"""Roles and permissions.

The database (seeded by migration 0002) is what the API checks at runtime.
This module mirrors it so endpoints can name permissions in code, and
`tests/test_permissions.py` fails if the two drift apart. Adding or changing a
permission therefore needs a new migration and an update here.

The `.view` permissions line up with the role lists in the frontend's
`src/config/portal-modules.ts`.
"""

from enum import StrEnum


class RoleCode(StrEnum):
    ADMIN = "admin"
    STOREKEEPER = "storekeeper"
    INSPECTOR = "inspector"


ROLE_NAMES: dict[RoleCode, str] = {
    RoleCode.ADMIN: "Administrator",
    RoleCode.STOREKEEPER: "Storekeeper",
    RoleCode.INSPECTOR: "Inspector",
}


class Permission(StrEnum):
    DASHBOARD_VIEW = "dashboard.view"
    ALERTS_VIEW = "alerts.view"
    ALERTS_ACKNOWLEDGE = "alerts.acknowledge"
    INVENTORY_VIEW = "inventory.view"
    INVENTORY_MANAGE = "inventory.manage"
    BATCHES_VIEW = "batches.view"
    BATCHES_MANAGE = "batches.manage"
    EXPIRY_VIEW = "expiry.view"
    QR_LABELS_MANAGE = "qr_labels.manage"
    SUPPLIERS_VIEW = "suppliers.view"
    SUPPLIERS_MANAGE = "suppliers.manage"
    ENVIRONMENT_VIEW = "environment.view"
    THRESHOLDS_MANAGE = "thresholds.manage"
    PH_VIEW = "ph.view"
    PH_RECORD = "ph.record"
    WASTE_VIEW = "waste.view"
    WASTE_RECORD = "waste.record"
    CAMERA_VIEW = "camera.view"
    EMPLOYEES_VIEW = "employees.view"
    EMPLOYEES_MANAGE = "employees.manage"
    REPORTS_VIEW = "reports.view"
    REPORTS_EXPORT = "reports.export"
    AUDIT_VIEW = "audit.view"
    DEVICES_VIEW = "devices.view"
    DEVICES_MANAGE = "devices.manage"


P = Permission

# Permissions that only read. Inspectors may hold nothing else.
READ_ONLY_PERMISSIONS: frozenset[Permission] = frozenset(
    {permission for permission in Permission if permission.value.endswith(".view")} | {P.REPORTS_EXPORT}
)

_SHARED_VIEW = frozenset(
    {P.DASHBOARD_VIEW, P.ALERTS_VIEW, P.INVENTORY_VIEW, P.BATCHES_VIEW, P.EXPIRY_VIEW,
     P.SUPPLIERS_VIEW, P.ENVIRONMENT_VIEW, P.PH_VIEW, P.WASTE_VIEW}
)  # fmt: skip

ROLE_PERMISSIONS: dict[RoleCode, frozenset[Permission]] = {
    RoleCode.ADMIN: frozenset(Permission),
    RoleCode.STOREKEEPER: _SHARED_VIEW
    | {P.ALERTS_ACKNOWLEDGE, P.INVENTORY_MANAGE, P.BATCHES_MANAGE, P.QR_LABELS_MANAGE,
       P.SUPPLIERS_MANAGE, P.PH_RECORD, P.WASTE_RECORD},  # fmt: skip
    RoleCode.INSPECTOR: _SHARED_VIEW
    | {P.CAMERA_VIEW, P.EMPLOYEES_VIEW, P.REPORTS_VIEW, P.REPORTS_EXPORT, P.AUDIT_VIEW},
}
