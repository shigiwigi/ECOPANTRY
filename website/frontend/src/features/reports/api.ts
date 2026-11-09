/**
 * Reports (portal, administrators and inspectors). The backend builds every report
 * (source of truth: backend `app/services/reports.py`) as titled tables of strings; the
 * preview shows them as they are and the CSV/PDF downloads come from the same data.
 */
import { queryOptions } from "@tanstack/react-query"
import { API_BASE_URL, ApiError, apiRequest } from "@/lib/api/client"

export const REPORT_KINDS = ["stock", "expiry", "environment", "waste"] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const REPORT_LABELS: Record<ReportKind, string> = {
  stock: "Stock",
  expiry: "Expiry",
  environment: "Environment",
  waste: "Waste",
}

export const EXPIRY_WINDOWS = [3, 7, 14, 30, 60, 90] as const
export const MAX_RANGE_DAYS = 31

export interface ReportFilters {
  days: number
  dateFrom: string
  dateTo: string
}

export interface ReportSection {
  title: string
  columns: string[]
  rows: string[][]
  total_rows: number
  truncated: boolean
}

export interface Report {
  kind: ReportKind
  title: string
  generated_at: string
  filters: { label: string; value: string }[]
  sections: ReportSection[]
  notes: string[]
}

export type ReportFormat = "csv" | "pdf"

/** Local calendar day as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function defaultFilters(now = new Date()): ReportFilters {
  const start = new Date(now)
  start.setDate(start.getDate() - 6)
  return { days: 7, dateFrom: isoDay(start), dateTo: isoDay(now) }
}

export function usesDateRange(kind: ReportKind): boolean {
  return kind === "environment" || kind === "waste"
}

/** A message when the range can't be requested, so the page doesn't send a request the API would refuse. */
export function rangeProblem(kind: ReportKind, filters: ReportFilters): string | null {
  if (!usesDateRange(kind)) return null
  const { dateFrom, dateTo } = filters
  if (!dateFrom || !dateTo) return "Choose both dates."
  if (dateFrom > dateTo) return "The start date must not be after the end date."
  const span = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000 + 1
  if (span > MAX_RANGE_DAYS) return `Choose at most ${MAX_RANGE_DAYS} days.`
  return null
}

export function reportPath(kind: ReportKind, filters: ReportFilters, format?: ReportFormat): string {
  const params = new URLSearchParams()
  if (format) params.set("format", format)
  if (kind === "expiry") params.set("days", String(filters.days))
  if (usesDateRange(kind)) {
    params.set("date_from", filters.dateFrom)
    params.set("date_to", filters.dateTo)
  }
  const query = params.toString()
  return `/reports/${kind}${query ? `?${query}` : ""}`
}

export function reportQuery(kind: ReportKind, filters: ReportFilters, enabled = true) {
  return queryOptions({
    queryKey: ["reports", kind, kind === "expiry" ? filters.days : usesDateRange(kind) ? [filters.dateFrom, filters.dateTo] : null],
    queryFn: () => apiRequest<Report>(reportPath(kind, filters)),
    enabled,
  })
}

function fileName(response: Response, fallback: string): string {
  const match = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")
  return match?.[1] ?? fallback
}

/**
 * Download a report. The session cookie is cross-site in production, so this is a fetch with
 * credentials and a blob, not a plain link. Throws ApiError with a message fit to show.
 */
export async function downloadReport(kind: ReportKind, filters: ReportFilters, format: ReportFormat): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${reportPath(kind, filters, format)}`, { credentials: "include" })
  } catch (cause) {
    throw new ApiError("network", "Can't reach the EcoPantry server.", null, cause)
  }
  if (!response.ok) {
    let message = response.status === 403 ? "You don't have permission to export reports." : `Download failed (${response.status}).`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === "string") message = body.detail
    } catch {
      // not JSON: keep the generic message
    }
    throw new ApiError("http", message, response.status)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement("a")
    link.href = url
    link.download = fileName(response, `ecopantry-${kind}.${format}`)
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    // Give the browser a moment to start the download before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
