"""Contact-form schemas: the public submission and the administrators' inbox."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enquiries import EMAIL_MAX_LENGTH, MESSAGE_MAX_LENGTH, NAME_MAX_LENGTH, Enquiry


class PublicEnquiryCreate(BaseModel):
    # Generous request limits; the service trims and applies the real ones.
    name: str = Field(max_length=NAME_MAX_LENGTH * 2)
    email: str = Field(max_length=EMAIL_MAX_LENGTH * 2)
    message: str = Field(max_length=MESSAGE_MAX_LENGTH * 2)
    # Honeypot: hidden in the form, so only bots fill it. Accepted and dropped silently.
    website: str | None = Field(default=None, max_length=500)


class PublicEnquiryAccepted(BaseModel):
    """Deliberately says nothing about what was submitted."""

    accepted: bool = True


class EnquiryOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    message: str
    created_at: datetime
    read_at: datetime | None

    @classmethod
    def from_enquiry(cls, enquiry: Enquiry) -> "EnquiryOut":
        return cls(
            id=enquiry.id,
            name=enquiry.name,
            email=enquiry.email,
            message=enquiry.message,
            created_at=enquiry.created_at,
            read_at=enquiry.read_at,
        )
