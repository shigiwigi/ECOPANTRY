"""initial baseline

Starts the migration history. It creates no tables: business tables
(inventory, batches, suppliers, ...) arrive with their modules in later
migrations. Applying it only creates Alembic's `alembic_version` table.

Revision ID: 0001
Revises:
Create Date: 2026-11-01 18:34:28.513370+00:00

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
