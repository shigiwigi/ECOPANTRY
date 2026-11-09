/**
 * Batch lookup for scanned labels: `GET /batches/by-label/{code}`, behind the
 * backend's `batches.view` permission. Portal-only; never import this from
 * public pages.
 *
 * Answers 404 `batch_not_found` for an unknown code. `BatchLabelLookup` is the
 * response contract in docs/QR_LABELS.md. Lookups only read.
 */
import { ApiError, apiRequest } from "@/lib/api/client"

export interface BatchLabelLookup {
  /** The batch's id, for opening it in the Batches page. */
  batch_id?: string
  code: string
  ingredient_name: string
  /** ISO dates (YYYY-MM-DD). */
  received_on: string | null
  expires_on: string | null
  status: "in_stock" | "used_up" | "discarded"
  /** Decimal as a string, with its unit, e.g. "12.500" and "kg". */
  remaining_quantity: string | null
  unit: string | null
  storage_location: string | null
}

export function batchByLabelQuery(code: string) {
  return {
    queryKey: ["batches", "by-label", code] as const,
    queryFn: () => apiRequest<BatchLabelLookup>(`/batches/by-label/${encodeURIComponent(code)}`),
    // A 4xx/501 answer won't change by asking again straight away.
    retry: false,
  }
}

export type LookupProblem = "unavailable" | "not-found" | "forbidden" | "unreachable" | "invalid" | "failed"

export function lookupProblem(error: unknown): LookupProblem {
  if (!(error instanceof ApiError)) return "failed"
  if (error.isUnreachable) return "unreachable"
  if (error.code === "batch_lookup_unavailable" || error.status === 501) return "unavailable"
  if (error.status === 404) return "not-found"
  if (error.status === 403) return "forbidden"
  if (error.status === 422) return "invalid"
  return "failed"
}
