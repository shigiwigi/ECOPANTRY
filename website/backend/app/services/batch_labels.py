"""Batch label codes: what a printed QR label carries.

A label encodes only `ECOPANTRY:BATCH:<code>`. The code is an opaque, random
reference to one batch. It carries no stock, supplier, employee or permission
data, and it isn't derived from the database id, so it reveals nothing about
how many batches exist. Everything else is looked up on the server, behind the
`batches.view` permission, when the label is scanned.

Code format: 10 characters of Crockford base32 (digits and capitals without
I, L, O and U). Every character is in the QR alphanumeric set, which keeps the
printed code small. The frontend has the same rules in
`src/features/qr/batch-label.ts`; `docs/QR_LABELS.md` is the shared contract.
"""

import re

LABEL_PREFIX = "ECOPANTRY:BATCH:"
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 10
CODE_PATTERN = rf"^[{CODE_ALPHABET}]{{{CODE_LENGTH}}}$"

_CODE_RE = re.compile(CODE_PATTERN)


def is_valid_code(code: str) -> bool:
    return _CODE_RE.fullmatch(code) is not None
