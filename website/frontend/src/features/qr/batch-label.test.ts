import jsQR from "jsqr"
import { describe, expect, it } from "vitest"
import {
  CODE_ALPHABET,
  formatCode,
  isValidCode,
  LABEL_PREFIX,
  labelPayload,
  randomTestCode,
  readScannedLabel,
  readTypedLabel,
} from "./batch-label"
import { daysUntil, formatCalendarDate, isIsoDate } from "./dates"
import { QUIET_ZONE_MODULES, qrMatrix } from "./qr-matrix"
import { labelFormSchema } from "./schemas"

const CODE = "K7M2Q9X4TR"

describe("batch label payload", () => {
  it("is the prefix and the code, nothing else", () => {
    expect(labelPayload(CODE)).toBe("ECOPANTRY:BATCH:K7M2Q9X4TR")
    expect(() => labelPayload("not a code")).toThrow()
  })

  it("only uses characters from the QR alphanumeric set, so codes stay small", () => {
    const qrAlphanumeric = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:")
    for (const char of LABEL_PREFIX + CODE_ALPHABET) expect(qrAlphanumeric.has(char)).toBe(true)
  })

  it("leaves out I, L, O and U, which are easy to misread", () => {
    expect(CODE_ALPHABET).toHaveLength(32)
    for (const char of "ILOU") expect(CODE_ALPHABET).not.toContain(char)
  })

  it("makes random test codes in the valid format", () => {
    const codes = new Set(Array.from({ length: 200 }, randomTestCode))
    for (const code of codes) expect(isValidCode(code)).toBe(true)
    expect(codes.size).toBe(200)
  })

  it("groups codes for reading", () => {
    expect(formatCode(CODE)).toBe("K7M2Q-9X4TR")
  })
})

describe("reading scanned QR text", () => {
  it.each([
    ["ECOPANTRY:BATCH:K7M2Q9X4TR", CODE],
    ["  ecopantry:batch:k7m2q9x4tr\n", CODE],
  ])("accepts %j", (text, code) => {
    expect(readScannedLabel(text)).toEqual({ ok: true, code })
  })

  it.each([
    ["", "empty"],
    ["https://example.com/batch/K7M2Q9X4TR", "not-ecopantry"],
    ["K7M2Q9X4TR", "not-ecopantry"], // a bare code isn't how labels are printed
    ["WIFI:S:bakery;T:WPA;P:secret;;", "not-ecopantry"],
    ["ECOPANTRY:BATCH:", "malformed"],
    ["ECOPANTRY:BATCH:K7M2Q9X4T", "malformed"],
    ["ECOPANTRY:BATCH:K7M2Q9X4TO", "malformed"],
    ["ECOPANTRY:BATCH:K7M2Q9X4TR?admin=1", "malformed"],
    [`ECOPANTRY:BATCH:${"A".repeat(500)}`, "not-ecopantry"],
  ])("rejects %j as %s", (text, reason) => {
    expect(readScannedLabel(text)).toEqual({ ok: false, reason })
  })
})

describe("reading typed codes", () => {
  it.each([
    ["K7M2Q9X4TR", CODE],
    ["k7m2q-9x4tr", CODE],
    [" K7M2 Q9X4 TR ", CODE],
    ["ECOPANTRY:BATCH:K7M2Q9X4TR", CODE],
    // Crockford base32 reads look-alikes the intended way.
    ["K7M2Q9X4TO", "K7M2Q9X4T0"],
    ["K7M2Q9X4TI", "K7M2Q9X4T1"],
    ["K7M2Q9X4TL", "K7M2Q9X4T1"],
  ])("accepts %j", (text, code) => {
    expect(readTypedLabel(text)).toEqual({ ok: true, code })
  })

  it.each([
    ["", "empty"],
    ["K7M2Q9X4T", "malformed"],
    ["K7M2Q9X4TU", "malformed"],
    ["http://example.com", "not-ecopantry"],
  ])("rejects %j as %s", (text, reason) => {
    expect(readTypedLabel(text)).toEqual({ ok: false, reason })
  })
})

describe("QR encoding", () => {
  it("fits a label payload in a version 2 symbol (25 × 25 modules)", () => {
    expect(qrMatrix(labelPayload(CODE)).size).toBe(25)
  })

  it("decodes back to the same payload", () => {
    // Render the matrix the way a printer would, with the quiet zone, and read it with the scanner's decoder.
    const payload = labelPayload(randomTestCode())
    const { size, path } = qrMatrix(payload)
    const scale = 4
    const full = (size + QUIET_ZONE_MODULES * 2) * scale
    const pixels = new Uint8ClampedArray(full * full * 4).fill(255)
    for (const [, col, row] of path.matchAll(/M(\d+) (\d+)/g)) {
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = (Number(col) + QUIET_ZONE_MODULES) * scale + x
          const py = (Number(row) + QUIET_ZONE_MODULES) * scale + y
          pixels.fill(0, (py * full + px) * 4, (py * full + px) * 4 + 3)
        }
      }
    }
    expect(jsQR(pixels, full, full)?.data).toBe(payload)
  })
})

describe("label dates", () => {
  it("writes dates so day and month can't be confused", () => {
    expect(formatCalendarDate("2026-11-20")).toBe("20 Nov 2026")
    expect(formatCalendarDate("2026-01-05")).toBe("5 Jan 2026")
  })

  it("rejects impossible dates", () => {
    expect(isIsoDate("2026-02-31")).toBe(false)
    expect(isIsoDate("20-11-2026")).toBe(false)
    expect(isIsoDate("2028-02-29")).toBe(true)
  })

  it("counts whole days to expiry", () => {
    const today = new Date(2026, 10, 2, 23, 30)
    expect(daysUntil("2026-11-02", today)).toBe(0)
    expect(daysUntil("2026-11-09", today)).toBe(7)
    expect(daysUntil("2026-11-01", today)).toBe(-1)
  })
})

describe("label form", () => {
  const valid = { ingredientName: "Strong white flour", code: "k7m2q-9x4tr", expiresOn: "2026-11-20", copies: "3" }

  it("accepts a complete label", () => {
    expect(labelFormSchema.safeParse(valid).success).toBe(true)
    expect(labelFormSchema.safeParse({ ...valid, expiresOn: "" }).success).toBe(true)
  })

  it.each([
    ["ingredientName", "  "],
    ["ingredientName", "x".repeat(41)],
    ["code", "not-a-code"],
    ["expiresOn", "2026-02-31"],
    ["copies", "0"],
    ["copies", "22"],
    ["copies", "1.5"],
  ])("rejects %s = %j", (field, value) => {
    expect(labelFormSchema.safeParse({ ...valid, [field]: value }).success).toBe(false)
  })
})
