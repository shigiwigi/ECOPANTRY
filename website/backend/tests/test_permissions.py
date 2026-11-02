import pytest
from sqlalchemy import create_engine, text

from app.auth.permissions import READ_ONLY_PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS, Permission, RoleCode


def test_inspectors_only_hold_read_only_permissions() -> None:
    assert ROLE_PERMISSIONS[RoleCode.INSPECTOR] <= READ_ONLY_PERMISSIONS


def test_administrators_hold_every_permission() -> None:
    assert ROLE_PERMISSIONS[RoleCode.ADMIN] == frozenset(Permission)


def test_storekeepers_cannot_manage_staff_devices_or_see_the_audit_log() -> None:
    held = ROLE_PERMISSIONS[RoleCode.STOREKEEPER]

    for permission in (Permission.EMPLOYEES_VIEW, Permission.EMPLOYEES_MANAGE, Permission.DEVICES_MANAGE,
                       Permission.AUDIT_VIEW, Permission.THRESHOLDS_MANAGE):  # fmt: skip
        assert permission not in held


def test_only_administrators_manage_the_public_catalogue() -> None:
    holders = {role for role, held in ROLE_PERMISSIONS.items() if Permission.CATALOGUE_MANAGE in held}

    assert holders == {RoleCode.ADMIN}


def test_every_permission_belongs_to_some_role() -> None:
    granted = frozenset().union(*ROLE_PERMISSIONS.values())

    assert granted == frozenset(Permission)


@pytest.mark.integration
def test_database_seed_matches_the_code(migrated_database_url: str) -> None:
    """Migrations 0002 and 0003 seed roles and permissions; app/auth/permissions.py must say the same."""
    engine = create_engine(migrated_database_url)
    try:
        with engine.connect() as connection:
            roles = dict(connection.execute(text("SELECT code, name FROM roles")).all())
            permissions = set(connection.execute(text("SELECT code FROM permissions")).scalars())
            grants = connection.execute(
                text(
                    "SELECT r.code, p.code FROM role_permissions rp "
                    "JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id"
                )
            ).all()
    finally:
        engine.dispose()

    assert roles == {role.value: name for role, name in ROLE_NAMES.items()}
    assert permissions == {permission.value for permission in Permission}
    by_role: dict[str, set[str]] = {}
    for role, permission in grants:
        by_role.setdefault(role, set()).add(permission)
    assert by_role == {role.value: {p.value for p in held} for role, held in ROLE_PERMISSIONS.items()}
