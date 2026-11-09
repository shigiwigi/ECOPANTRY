/**
 * Staff-side API for waste records, pH records, the enquiries inbox and the audit log.
 * The backend checks permissions on every request; this module only calls it.
 */
import { keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface EmployeeRef {
  id: string
  full_name: string
}

function withParams(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `${path}?${text}` : path
}

export const PAGE_SIZE = 20

// --- waste ------------------------------------------------------------------

export const WASTE_CATEGORIES = ["expired", "spoiled", "damaged", "production_offcut", "other"] as const
export type WasteCategory = (typeof WASTE_CATEGORIES)[number]

export const WASTE_CATEGORY_LABELS: Record<WasteCategory, string> = {
  expired: "Expired",
  spoiled: "Spoiled",
  damaged: "Damaged",
  production_offcut: "Production offcut",
  other: "Other",
}

export interface WasteRecord {
  id: string
  category: WasteCategory
  reason: string | null
  /** Decimal string, e.g. "1.250". */
  weight_kg: string | null
  batch_id: string | null
  employee: EmployeeRef
  recorded_at: string
}

export interface WasteInput {
  category: WasteCategory
  reason: string | null
  weight_kg: string | null
  batch_id: string | null
}

export interface WasteSummary {
  records: number
  weight_kg: string
  by_category: { category: WasteCategory; records: number; weight_kg: string }[]
}

export function wasteRecordsQuery(offset: number) {
  return {
    queryKey: ["waste", "records", offset] as const,
    queryFn: () => apiRequest<Page<WasteRecord>>(withParams("/waste/records", { limit: PAGE_SIZE, offset })),
    placeholderData: keepPreviousData,
  }
}

export function wasteSummaryQuery(dateFrom: string) {
  return {
    queryKey: ["waste", "summary", dateFrom] as const,
    queryFn: () => apiRequest<WasteSummary>(withParams("/waste/summary", { date_from: dateFrom })),
  }
}

export function useRecordWaste() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: WasteInput) => apiRequest<WasteRecord>("/waste/records", { method: "POST", body: { ...input } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["waste"] }),
  })
}

// --- pH (experimental) --------------------------------------------------------

export interface PhRecord {
  id: string
  sample_description: string
  batch_id: string | null
  /** Decimal string, e.g. "4.26". */
  ph_value: string
  reference_min: string | null
  reference_max: string | null
  calibration_note: string | null
  operator: EmployeeRef
  recorded_at: string
  experimental: true
}

export interface PhInput {
  sample_description: string
  ph_value: string
  reference_min: string | null
  reference_max: string | null
  calibration_note: string | null
  batch_id: string | null
}

export function phRecordsQuery(offset: number) {
  return {
    queryKey: ["ph", "records", offset] as const,
    queryFn: () => apiRequest<Page<PhRecord>>(withParams("/ph/records", { limit: PAGE_SIZE, offset })),
    placeholderData: keepPreviousData,
  }
}

export function useRecordPh() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PhInput) => apiRequest<PhRecord>("/ph/records", { method: "POST", body: { ...input } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["ph"] }),
  })
}

// --- enquiries ----------------------------------------------------------------

export interface Enquiry {
  id: string
  name: string
  email: string
  message: string
  created_at: string
  read_at: string | null
}

export function enquiriesQuery(offset: number, unreadOnly: boolean) {
  return {
    queryKey: ["enquiries", offset, unreadOnly] as const,
    queryFn: () =>
      apiRequest<Page<Enquiry>>(withParams("/enquiries", { limit: PAGE_SIZE, offset, unread: unreadOnly ? true : undefined })),
    placeholderData: keepPreviousData,
  }
}

export function useMarkEnquiryRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiRequest<Enquiry>(`/enquiries/${id}/read`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["enquiries"] }),
  })
}

// --- audit log ----------------------------------------------------------------

export interface AuditEvent {
  id: number
  occurred_at: string
  actor_type: string
  actor: EmployeeRef | null
  action: string
  target_type: string | null
  target_id: string | null
}

export interface AuditFilters {
  action: string
  target_type: string
  date_from: string
  date_to: string
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = { action: "", target_type: "", date_from: "", date_to: "" }

export function auditQuery(filters: AuditFilters, offset: number) {
  return {
    queryKey: ["audit", filters, offset] as const,
    queryFn: () => apiRequest<Page<AuditEvent>>(withParams("/audit", { limit: PAGE_SIZE, offset, ...filters })),
    placeholderData: keepPreviousData,
  }
}

// --- shared display helpers ---------------------------------------------------

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date)
}

/** "2026-10-10": the UTC day `days` days before now, for the summary's date range. */
export function daysAgoIso(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

export function formatKg(value: string): string {
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg` : value
}
