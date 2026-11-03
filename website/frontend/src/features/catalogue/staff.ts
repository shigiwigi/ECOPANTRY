/**
 * Catalogue management for the portal (administrators, `catalogue.manage`).
 * The backend checks the permission on every request; this module only calls it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export interface StaffCategory {
  id: string
  slug: string
  name: string
  product_count: number
  created_at: string
  updated_at: string
}

export interface StaffProduct {
  id: string
  slug: string
  name: string
  summary: string | null
  description: string | null
  category_id: string | null
  category_name: string | null
  price: string | null
  currency: string | null
  is_published: boolean
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface ProductInput {
  name: string
  slug?: string
  summary: string | null
  description: string | null
  category_id: string | null
  price: string | null
  currency: string | null
  is_published: boolean
}

export const staffProductsQuery = {
  queryKey: ["catalogue", "products"] as const,
  queryFn: () => apiRequest<StaffProduct[]>("/catalogue/products"),
}

export const staffCategoriesQuery = {
  queryKey: ["catalogue", "categories"] as const,
  queryFn: () => apiRequest<StaffCategory[]>("/catalogue/categories"),
}

/** Refresh staff lists and the public catalogue after any change. */
function useRefresh() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["catalogue"] }),
      client.invalidateQueries({ queryKey: ["public", "catalogue"] }),
    ])
}

export function useSaveProduct() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: Partial<ProductInput> }) =>
      id
        ? apiRequest<StaffProduct>(`/catalogue/products/${id}`, { method: "PATCH", body: input })
        : apiRequest<StaffProduct>("/catalogue/products", { method: "POST", body: input }),
    onSuccess: refresh,
  })
}

export function useDeleteProduct() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/catalogue/products/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
}

export function useSaveCategory() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, name }: { id: string | null; name: string }) =>
      id
        ? apiRequest<StaffCategory>(`/catalogue/categories/${id}`, { method: "PATCH", body: { name } })
        : apiRequest<StaffCategory>("/catalogue/categories", { method: "POST", body: { name } }),
    onSuccess: refresh,
  })
}

export function useDeleteCategory() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/catalogue/categories/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
}

/** The currency most products already use, to prefill new ones. Null when no product has a price. */
export function usualCurrency(products: readonly StaffProduct[]): string | null {
  const counts = new Map<string, number>()
  for (const { currency } of products) if (currency) counts.set(currency, (counts.get(currency) ?? 0) + 1)
  let best: string | null = null
  for (const [currency, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = currency
  return best
}
