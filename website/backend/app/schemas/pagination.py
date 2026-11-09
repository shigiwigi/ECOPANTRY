"""The response shape of every paginated list endpoint. See `app/api/v1/pagination.py`."""

from collections.abc import Sequence
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int = Field(description="How many items match the filters, across all pages.")
    limit: int = Field(description="The page size that was applied.")
    offset: int = Field(description="How many matching items were skipped before this page.")

    @classmethod
    def of(cls, items: Sequence[T], *, total: int, limit: int, offset: int) -> "Page[T]":
        return cls(items=list(items), total=total, limit=limit, offset=offset)
