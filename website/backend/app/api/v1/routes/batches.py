"""Batch lookup for scanned QR labels.

The portal's QR scanner reads `ECOPANTRY:BATCH:<code>` from a label and asks
this endpoint for the batch. Batch records arrive with the inventory module
(M6), so for now the endpoint checks the session, the `batches.view`
permission and the code format, then answers 501 `batch_lookup_unavailable`.
The response the scanner will get once batches exist is documented in
`docs/QR_LABELS.md`. Scanning only reads; it never changes stock.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.auth.dependencies import require_permission
from app.auth.permissions import Permission
from app.auth.service import Principal
from app.core.errors import NotAvailableYetError
from app.schemas.errors import ErrorResponse
from app.services.batch_labels import CODE_PATTERN

router = APIRouter(
    prefix="/batches",
    tags=["batches"],
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in"},
        403: {"model": ErrorResponse, "description": "The role lacks `batches.view`"},
    },
)

Viewer = Annotated[Principal, Depends(require_permission(Permission.BATCHES_VIEW))]
LabelCode = Annotated[
    str,
    Path(pattern=CODE_PATTERN, description="The code from a batch label: 10 characters of Crockford base32."),
]


@router.get(
    "/by-label/{code}",
    summary="Look up the batch a QR label points to",
    responses={501: {"model": ErrorResponse, "description": "Batch records don't exist yet (inventory module, M6)"}},
)
def batch_by_label(code: LabelCode, _: Viewer) -> None:
    raise NotAvailableYetError(
        "The label is valid, but batch details can't be shown yet: batch records arrive with the inventory module.",
        code="batch_lookup_unavailable",
    )
