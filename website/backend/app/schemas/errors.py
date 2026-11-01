from pydantic import BaseModel, Field


class FieldError(BaseModel):
    loc: list[str] = Field(description="Where the problem is, e.g. ['body', 'email'].")
    msg: str
    type: str


class ErrorResponse(BaseModel):
    """Shape of every error response from the API."""

    detail: str = Field(description="Human-readable message, safe to show to users.")
    code: str = Field(description="Stable machine-readable error code, e.g. 'not_found'.")
    errors: list[FieldError] | None = Field(default=None, description="Per-field problems for invalid requests.")
