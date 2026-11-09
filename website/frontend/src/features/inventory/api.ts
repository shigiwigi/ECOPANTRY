/**
 * Inventory and batch endpoints for the portal. The backend checks permissions
 * on every request (`inventory.*`, `batches.*`); this module only calls it.
 * Quantities are decimal strings, never floats.
 */
import { keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface Unit {
  code: string
  name: string
  kind: "mass" | "volume" | "count"
}

export interface Ingredient {
  id: string
  name: string
  unit: Unit
  reorder_level: string | null
  total_remaining: string
  low_stock: boolean
  notes: string | null
  is_active: boolean
}

export interface StorageArea {
  id: string
  name: string
  kind: string
  is_active: boolean
}

export type BatchStatus = "available" | "near_expiry" | "expired" | "depleted"

export interface Batch {
  id: string
  label_code: string
  ingredient: { id: string; name: string; unit: string }
  storage_area: { id: string; name: string } | null
  received_on: string
  expiry_on: string
  quantity: string
  remaining_quantity: string
  status: BatchStatus
  notes: string | null
  created_at: string
}

export interface Movement {
  id: number
  kind: "in" | "out" | "adjust"
  quantity_delta: string
  remaining_after: string
  reason: string | null
  employee_name: string
  created_at: string
}

export interface BatchDetail extends Batch {
  movements: Movement[]
}

export const PAGE_SIZE = 25

function search(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value))
  const text = query.toString()
  return text ? `?${text}` : ""
}

export function ingredientsQuery(params: { q?: string; offset?: number; limit?: number; active?: boolean } = {}) {
  const { q, offset = 0, limit = PAGE_SIZE, active } = params
  return {
    queryKey: ["inventory", "ingredients", { q, offset, limit, active }] as const,
    queryFn: () =>
      apiRequest<Page<Ingredient>>(
        `/ingredients${search({ q, offset, limit, active: active === undefined ? undefined : String(active) })}`,
      ),
    placeholderData: keepPreviousData,
  }
}

export const storageAreasQuery = {
  queryKey: ["inventory", "storage-areas"] as const,
  queryFn: () => apiRequest<Page<StorageArea>>("/storage-areas?active=true&limit=200"),
}

export const unitsQuery = {
  queryKey: ["inventory", "units"] as const,
  queryFn: () => apiRequest<Unit[]>("/units"),
}

export interface BatchFilters {
  q?: string
  status?: BatchStatus | ""
  storageAreaId?: string
  ingredientId?: string
  hasStock?: boolean
  offset?: number
  limit?: number
}

export function batchesQuery(filters: BatchFilters = {}) {
  const { q, status, storageAreaId, ingredientId, hasStock, offset = 0, limit = PAGE_SIZE } = filters
  return {
    queryKey: ["batches", "list", filters] as const,
    queryFn: () =>
      apiRequest<Page<Batch>>(
        `/batches${search({
          q,
          status: status || undefined,
          storage_area_id: storageAreaId,
          ingredient_id: ingredientId,
          has_stock: hasStock === undefined ? undefined : String(hasStock),
          offset,
          limit,
        })}`,
      ),
    placeholderData: keepPreviousData,
  }
}

export function batchQuery(id: string) {
  return {
    queryKey: ["batches", "detail", id] as const,
    queryFn: () => apiRequest<BatchDetail>(`/batches/${id}`),
  }
}

export interface ReceiveInput {
  ingredient_id: string
  storage_area_id: string | null
  quantity: string
  received_on: string
  expiry_on: string
  notes: string | null
}

/** Any stock change moves ingredient totals, batch lists and scanner lookups. */
function useRefresh() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["inventory"] }),
      client.invalidateQueries({ queryKey: ["batches"] }),
    ])
}

export function useReceiveBatch() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: ReceiveInput) => apiRequest<BatchDetail>("/batches", { method: "POST", body: { ...input } }),
    onSuccess: refresh,
  })
}

export function useConsume(batchId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { quantity: string; reason: string | null }) =>
      apiRequest<BatchDetail>(`/batches/${batchId}/consume`, { method: "POST", body: { ...input } }),
    onSuccess: refresh,
  })
}

export function useAdjust(batchId: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: { delta: string; reason: string }) =>
      apiRequest<BatchDetail>(`/batches/${batchId}/adjust`, { method: "POST", body: { ...input } }),
    onSuccess: refresh,
  })
}

export interface IngredientInput {
  name: string
  unit: string
  reorder_level: string | null
}

export function useAddIngredient() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: IngredientInput) => apiRequest<Ingredient>("/ingredients", { method: "POST", body: { ...input } }),
    onSuccess: refresh,
  })
}
