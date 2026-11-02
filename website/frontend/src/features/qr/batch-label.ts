/**
 * What a batch QR label carries, and how scanned or typed text is read back.
 *
 * A label encodes only `ECOPANTRY:BATCH:<code>`. The code is an opaque random
 * reference: no stock, supplier, employee, permission or session data. Batch
 * details are fetched from the backend (behind `batches.view`) after scanning.
 *
 * Code format: 10 characters of Crockford base32 (digits and capitals without
 * I, L, O, U). The backend checks the same rules in
 * `app/services/batch_labels.py`; `docs/QR_LABELS.md` is the shared contract.
 */

export const LABEL_PREFIX = "ECOPANTRY:BATCH:"
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export const CODE_LENGTH = 10

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`)
/** Anything longer can't be ours; don't spend effort on it or echo it back. */
const MAX_PAYLOAD_LENGTH = 200

export type LabelReadResult =
  | { ok: true; code: string }
  | { ok: false; reason: "empty" | "not-ecopantry" | "malformed" }

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code)
}

export function labelPayload(code: string): string {
  if (!isValidCode(code)) throw new Error("Invalid batch code")
  return `${LABEL_PREFIX}${code}`
}

/**
 * Reads the text of a scanned QR code. Only the exact label format is accepted
 * (case-insensitive, surrounding whitespace ignored): a QR code from anywhere
 * else is reported as not ours rather than guessed at.
 */
export function readScannedLabel(text: string): LabelReadResult {
  const value = text.trim()
  if (!value) return { ok: false, reason: "empty" }
  if (value.length > MAX_PAYLOAD_LENGTH) return { ok: false, reason: "not-ecopantry" }
  const upper = value.toUpperCase()
  if (!upper.startsWith(LABEL_PREFIX)) return { ok: false, reason: "not-ecopantry" }
  const code = upper.slice(LABEL_PREFIX.length)
  return isValidCode(code) ? { ok: true, code } : { ok: false, reason: "malformed" }
}

/**
 * Reads a code typed by hand: either the whole label text or just the code.
 * Forgiving the way Crockford base32 intends: case, spaces and hyphens are
 * ignored, and the look-alikes O, I and L are read as 0, 1 and 1.
 */
export function readTypedLabel(text: string): LabelReadResult {
  const value = text.trim()
  if (!value) return { ok: false, reason: "empty" }
  if (value.length > MAX_PAYLOAD_LENGTH) return { ok: false, reason: "malformed" }
  const upper = value.toUpperCase()
  if (upper.startsWith(LABEL_PREFIX)) return readScannedLabel(upper)
  if (upper.includes(":")) return { ok: false, reason: "not-ecopantry" }
  const code = upper.replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1")
  return isValidCode(code) ? { ok: true, code } : { ok: false, reason: "malformed" }
}

/** Groups a code for reading aloud or typing: K7M2Q-9X4TR. */
export function formatCode(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code
}

/**
 * A random code for trying out printing and scanning before batches exist.
 * Batch codes will be assigned by the backend (M6); a code made here isn't
 * linked to any batch.
 */
export function randomTestCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  // 256 is a multiple of 32, so taking the low five bits keeps every character equally likely.
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("")
}

export const READ_PROBLEMS: Record<Exclude<LabelReadResult, { ok: true }>["reason"], string> = {
  empty: "Enter a batch code.",
  "not-ecopantry": "This isn't an EcoPantry batch label.",
  malformed: "That doesn't look like a batch code. Codes have 10 letters and digits, like K7M2Q-9X4TR.",
}
