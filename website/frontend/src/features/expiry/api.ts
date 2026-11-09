/**
 * Expiry lists and FEFO recommendations (portal, every role). The backend decides
 * everything (source of truth: backend `app/services/expiry.py`): a batch is usable
 * through the whole of its expiry date, and expired stock is never recommended.
 */
import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export const WINDOWS = [3, 7, 14, 30] as const
export type ExpiryWindow = (typeof WINDOWS)[number]
export type ExpiryView = "near" | "expired"

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface ExpiryBatch {
  id: string
  label_code: string
  ingredient: { id: string; name: string; unit: string }
  storage_area: { id: string; name: string } | null
  received_on: string
  expiry_on: string
  quantity: string
  remaining_quantity: string
  days_left: number
}

export interface ExpirySummary {
  today: string
  window_days: number
  near_expiry: number
  expired: number
}

export interface FefoBatch {
  id: string
  label_code: string
  received_on: string
  expiry_on: string
  remaining_quantity: string
  days_left: number
}

export interface FefoResult {
  today: string
  ingredient: { id: string; name: string; unit: string }
  usable: FefoBatch[]
  expired: FefoBatch[]
  requested: string | null
  pick: { batch: FefoBatch; take: string }[] | null
  allocated: string | null
  shortfall: string | null
  sufficient: boolean | null
}

export interface IngredientOption {
  id: string
  name: string
  unit: { code: string }
}

export const PAGE_SIZE = 50

export const summaryQuery = (days: ExpiryWindow) =>
  queryOptions({
    queryKey: ["expiry", "summary", days] as const,
    queryFn: () => apiRequest<ExpirySummary>(`/expiry/summary?days=${days}`),
  })

export const listQuery = (view: ExpiryView, days: ExpiryWindow, search: string, offset: number) =>
  queryOptions({
    queryKey: ["expiry", "list", view, days, search, offset] as const,
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (view === "near") params.set("days", String(days))
      if (search) params.set("q", search)
      return apiRequest<Page<ExpiryBatch>>(`/expiry/${view}?${params}`)
    },
  })

export const ingredientsQuery = queryOptions({
  queryKey: ["inventory", "ingredients", "active"] as const,
  queryFn: () => apiRequest<Page<IngredientOption>>("/ingredients?active=true&limit=200"),
})

export const fefoQuery = (ingredientId: string, quantity: string) =>
  queryOptions({
    queryKey: ["expiry", "fefo", ingredientId, quantity] as const,
    queryFn: () => {
      const params = new URLSearchParams({ ingredient_id: ingredientId })
      if (quantity) params.set("quantity", quantity)
      return apiRequest<FefoResult>(`/expiry/fefo?${params}`)
    },
  })

/** "Today", "in 3 days" or "2 days ago". */
export function daysLeftLabel(days: number): string {
  if (days === 0) return "Today"
  const n = Math.abs(days)
  const unit = n === 1 ? "day" : "days"
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`
}

/** Quantities arrive as "2.500"; show them without trailing zeros. */
export function formatQuantity(value: string): string {
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : value
}

/** Empty (no quantity) or a positive amount with at most 3 decimals. */
export function isValidQuantity(value: string): boolean {
  return value === "" || (/^\d{1,9}(\.\d{1,3})?$/.test(value) && Number(value) > 0)
}
