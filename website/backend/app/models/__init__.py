"""ORM models.

Import every model module here so `Base.metadata` is complete when Alembic
autogenerates migrations. There are no models yet: business modules
(inventory, batches, suppliers, ...) add theirs in later milestones.
"""

from app.db.base import Base

__all__ = ["Base"]
