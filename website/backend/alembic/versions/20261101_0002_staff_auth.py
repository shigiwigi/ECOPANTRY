"""staff auth: roles, permissions, employees, sessions, audit events

Adds staff sign-in (see docs/AUTH_DESIGN.md). Creates tables only; nothing
existing is altered or dropped. Seeds the three fixed roles and the permission
catalogue, which are reference data, not business records. No employee
accounts are created: the first administrator comes from
`python -m app.cli create-admin`.

The role/permission seed is written out here rather than imported from the
app, so this migration keeps producing the same result if the code changes.
`tests/test_permissions.py` checks it still matches `app/auth/permissions.py`.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-01 19:17:17.488270+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLES = [
    ("admin", "Administrator", "Manages staff accounts, devices and settings, and has every permission."),
    ("storekeeper", "Storekeeper", "Records stock, batches, waste and pH measurements."),
    ("inspector", "Inspector", "Reviews records, reports and the audit log. Read-only."),
]

# (code, description, roles that hold it)
PERMISSIONS = [
    ("dashboard.view", "View the dashboard.", "admin storekeeper inspector"),
    ("alerts.view", "View alerts.", "admin storekeeper inspector"),
    ("alerts.acknowledge", "Acknowledge and resolve alerts.", "admin storekeeper"),
    ("inventory.view", "View ingredients and stock levels.", "admin storekeeper inspector"),
    ("inventory.manage", "Create ingredients and record stock movements.", "admin storekeeper"),
    ("batches.view", "View ingredient batches.", "admin storekeeper inspector"),
    ("batches.manage", "Create and update batches.", "admin storekeeper"),
    ("expiry.view", "View expiry lists and FEFO recommendations.", "admin storekeeper inspector"),
    ("qr_labels.manage", "Generate, print and scan batch QR labels.", "admin storekeeper"),
    ("suppliers.view", "View suppliers.", "admin storekeeper inspector"),
    ("suppliers.manage", "Create and update suppliers.", "admin storekeeper"),
    ("environment.view", "View temperature and humidity readings.", "admin storekeeper inspector"),
    ("thresholds.manage", "Change alert thresholds.", "admin"),
    ("ph.view", "View experimental pH records.", "admin storekeeper inspector"),
    ("ph.record", "Record experimental pH measurements.", "admin storekeeper"),
    ("waste.view", "View waste records and bin levels.", "admin storekeeper inspector"),
    ("waste.record", "Record waste.", "admin storekeeper"),
    ("camera.view", "View the camera stream.", "admin inspector"),
    ("employees.view", "View staff accounts.", "admin inspector"),
    ("employees.manage", "Create, deactivate and reactivate staff accounts.", "admin"),
    ("reports.view", "View reports.", "admin inspector"),
    ("reports.export", "Export reports as CSV or PDF.", "admin inspector"),
    ("audit.view", "View the audit log.", "admin inspector"),
    ("devices.view", "View registered devices.", "admin"),
    ("devices.manage", "Register devices and rotate their credentials.", "admin"),
]

AUDIT_GUARD_FUNCTION = """
CREATE FUNCTION audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only (% is not allowed)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$
"""

AUDIT_GUARD_TRIGGER = """
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_events_append_only()
"""


def upgrade() -> None:
    op.create_table('permissions',
    sa.Column('id', sa.SmallInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.CheckConstraint("code ~ '^[a-z_]+\\.[a-z_]+$'", name=op.f('ck_permissions_code_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_permissions')),
    sa.UniqueConstraint('code', name=op.f('uq_permissions_code'))
    )
    op.create_table('roles',
    sa.Column('id', sa.SmallInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_roles')),
    sa.UniqueConstraint('code', name=op.f('uq_roles_code'))
    )
    op.create_table('employees',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('full_name', sa.String(length=120), nullable=False),
    sa.Column('role_id', sa.SmallInteger(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='active', nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('password_changed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('failed_login_attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'disabled') = (deactivated_at IS NOT NULL)", name=op.f('ck_employees_deactivated_at_matches_status')),
    sa.CheckConstraint("status IN ('active', 'disabled')", name=op.f('ck_employees_status_valid')),
    sa.CheckConstraint('email = lower(btrim(email))', name=op.f('ck_employees_email_normalized')),
    sa.CheckConstraint('failed_login_attempts >= 0', name=op.f('ck_employees_failed_login_attempts_non_negative')),
    sa.CheckConstraint('length(btrim(full_name)) > 0', name=op.f('ck_employees_full_name_not_blank')),
    sa.ForeignKeyConstraint(['created_by_id'], ['employees.id'], name=op.f('fk_employees_created_by_id_employees'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], name=op.f('fk_employees_role_id_roles'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_employees')),
    sa.UniqueConstraint('email', name=op.f('uq_employees_email'))
    )
    op.create_index(op.f('ix_employees_role_id'), 'employees', ['role_id'], unique=False)
    op.create_table('role_permissions',
    sa.Column('role_id', sa.SmallInteger(), nullable=False),
    sa.Column('permission_id', sa.SmallInteger(), nullable=False),
    sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], name=op.f('fk_role_permissions_permission_id_permissions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], name=op.f('fk_role_permissions_role_id_roles'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('role_id', 'permission_id', name=op.f('pk_role_permissions'))
    )
    op.create_table('audit_events',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('actor_type', sa.String(length=16), nullable=False),
    sa.Column('actor_employee_id', sa.Uuid(), nullable=True),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('target_type', sa.String(length=32), nullable=True),
    sa.Column('target_id', sa.String(length=64), nullable=True),
    sa.Column('ip_address', postgresql.INET(), nullable=True),
    sa.Column('user_agent', sa.String(length=255), nullable=True),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.CheckConstraint("(actor_type = 'employee') = (actor_employee_id IS NOT NULL)", name=op.f('ck_audit_events_actor_employee_matches_type')),
    sa.CheckConstraint("actor_type IN ('employee', 'anonymous', 'cli')", name=op.f('ck_audit_events_actor_type_valid')),
    sa.ForeignKeyConstraint(['actor_employee_id'], ['employees.id'], name=op.f('fk_audit_events_actor_employee_id_employees'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_events'))
    )
    op.create_index(op.f('ix_audit_events_action'), 'audit_events', ['action'], unique=False)
    op.create_index(op.f('ix_audit_events_actor_employee_id'), 'audit_events', ['actor_employee_id'], unique=False)
    op.create_index(op.f('ix_audit_events_occurred_at'), 'audit_events', ['occurred_at'], unique=False)
    op.create_table('auth_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.LargeBinary(length=32), nullable=False),
    sa.Column('csrf_token', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_reason', sa.String(length=32), nullable=True),
    sa.Column('ip_address', postgresql.INET(), nullable=True),
    sa.Column('user_agent', sa.String(length=255), nullable=True),
    sa.CheckConstraint("revoked_reason IS NULL OR revoked_reason IN ('logout', 'password_changed', 'account_deactivated', 'replaced')", name=op.f('ck_auth_sessions_revoked_reason_valid')),
    sa.CheckConstraint('(revoked_at IS NULL) = (revoked_reason IS NULL)', name=op.f('ck_auth_sessions_revoked_reason_matches')),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_auth_sessions_employee_id_employees'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_auth_sessions')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_auth_sessions_token_hash'))
    )
    op.create_index(op.f('ix_auth_sessions_employee_id'), 'auth_sessions', ['employee_id'], unique=False)
    op.create_index(op.f('ix_auth_sessions_expires_at'), 'auth_sessions', ['expires_at'], unique=False)

    op.execute(AUDIT_GUARD_FUNCTION)
    op.execute(AUDIT_GUARD_TRIGGER)
    _seed_roles_and_permissions()


def _seed_roles_and_permissions() -> None:
    roles = sa.table(
        "roles", sa.column("code", sa.String), sa.column("name", sa.String), sa.column("description", sa.Text)
    )
    permissions = sa.table("permissions", sa.column("code", sa.String), sa.column("description", sa.Text))
    op.bulk_insert(roles, [{"code": c, "name": n, "description": d} for c, n, d in ROLES])
    op.bulk_insert(permissions, [{"code": c, "description": d} for c, d, _ in PERMISSIONS])

    grants = [(role, code) for code, _, holders in PERMISSIONS for role in holders.split()]
    values = ", ".join(f"('{role}', '{code}')" for role, code in grants)
    op.execute(
        f"""
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM (VALUES {values}) AS g(role_code, permission_code)
        JOIN roles r ON r.code = g.role_code
        JOIN permissions p ON p.code = g.permission_code
        """
    )


def downgrade() -> None:
    # Reverses this revision on a test or scratch database. On a database with
    # real accounts it deletes them; don't run it there.
    op.execute("DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS audit_events_append_only()")
    op.drop_index(op.f('ix_auth_sessions_expires_at'), table_name='auth_sessions')
    op.drop_index(op.f('ix_auth_sessions_employee_id'), table_name='auth_sessions')
    op.drop_table('auth_sessions')
    op.drop_index(op.f('ix_audit_events_occurred_at'), table_name='audit_events')
    op.drop_index(op.f('ix_audit_events_actor_employee_id'), table_name='audit_events')
    op.drop_index(op.f('ix_audit_events_action'), table_name='audit_events')
    op.drop_table('audit_events')
    op.drop_table('role_permissions')
    op.drop_index(op.f('ix_employees_role_id'), table_name='employees')
    op.drop_table('employees')
    op.drop_table('roles')
    op.drop_table('permissions')
