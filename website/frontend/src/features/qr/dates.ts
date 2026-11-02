const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  // Rejects dates like 2026-02-31, which Date would roll over into March.
  return date.getUTCDate() === Number(match[3]) ? date : null
}

/**
 * A calendar date written so nobody can misread day and month: "20 Nov 2026".
 * Dates are calendar days, not instants, so no time zone is applied.
 */
export function formatCalendarDate(value: string): string {
  const date = parseIsoDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
}

/** Whole days from `today` to `value` (negative once past). Null for an unreadable date. */
export function daysUntil(value: string, today = new Date()): number | null {
  const date = parseIsoDate(value)
  if (!date) return null
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((date.getTime() - start) / 86_400_000)
}

export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null
}
