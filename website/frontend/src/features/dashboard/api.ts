/**
 * The dashboard summary (`GET /dashboard/summary`). The backend returns a figure only when the
 * signed-in role may read it elsewhere and `null` otherwise, so the page decides what to show from
 * the response, never from the role.
 */
import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"
import type { AlertMetric, Severity } from "@/features/alerts/api"

export interface TopAlert {
  id: string
  label: string
  metric: AlertMetric
  severity: Severity
  /** Latest value in the metric's storage unit (grams for weight). */
  value: number | null
  opened_at: string
}

export interface DashboardSummary {
  low_stock_ingredients: number | null
  near_expiry_batches: number | null
  expired_batches: number | null
  expiry_window_days: number
  open_alerts: number | null
  acknowledged_alerts: number | null
  top_alert: TopAlert | null
  active_staff: number | null
  today: string
  server_time: string
}

export const DASHBOARD_POLL_MS = 60_000

export const dashboardSummaryQuery = queryOptions({
  queryKey: ["dashboard", "summary"] as const,
  queryFn: () => apiRequest<DashboardSummary>("/dashboard/summary"),
  refetchInterval: DASHBOARD_POLL_MS,
  refetchIntervalInBackground: false,
})

export interface Tile {
  id: string
  label: string
  value: number
  hint: string
  to: string
  /** Portal module the tile leads to; the link is dropped when the role can't open it. */
  moduleId: string
  /** Colour of the figure when it is above zero; none for plain information. */
  tone?: "warning" | "danger"
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** The tiles the response carries a figure for, in display order. */
export function tilesFor(summary: DashboardSummary): Tile[] {
  const tiles: Tile[] = []
  if (summary.low_stock_ingredients !== null)
    tiles.push({
      id: "low-stock",
      label: "Low stock",
      value: summary.low_stock_ingredients,
      hint: plural(summary.low_stock_ingredients, "ingredient at or below its reorder level", "ingredients at or below their reorder level"),
      to: "/portal/inventory",
      moduleId: "inventory",
      tone: "warning",
    })
  if (summary.near_expiry_batches !== null)
    tiles.push({
      id: "near-expiry",
      label: "Near expiry",
      value: summary.near_expiry_batches,
      hint: `${plural(summary.near_expiry_batches, "batch", "batches")} expiring within ${summary.expiry_window_days} days`,
      to: "/portal/expiry",
      moduleId: "expiry",
      tone: "warning",
    })
  if (summary.expired_batches !== null)
    tiles.push({
      id: "expired",
      label: "Expired",
      value: summary.expired_batches,
      hint: `${plural(summary.expired_batches, "batch", "batches")} past expiry still in stock`,
      to: "/portal/expiry",
      moduleId: "expiry",
      tone: "danger",
    })
  if (summary.open_alerts !== null)
    tiles.push({
      id: "open-alerts",
      label: "Open alerts",
      value: summary.open_alerts,
      hint:
        summary.acknowledged_alerts ? `${summary.acknowledged_alerts} more acknowledged` : "Nobody has acknowledged these yet",
      to: "/portal/alerts",
      moduleId: "alerts",
      tone: "danger",
    })
  if (summary.active_staff !== null)
    tiles.push({
      id: "active-staff",
      label: "Active staff",
      value: summary.active_staff,
      hint: plural(summary.active_staff, "account can sign in", "accounts can sign in"),
      to: "/portal/users",
      moduleId: "users",
    })
  return tiles
}

/** Staff headcount is information, not a problem; every other tile counts things that need attention. */
export function needsAttention(summary: DashboardSummary): boolean {
  return (
    (summary.low_stock_ingredients ?? 0) > 0 ||
    (summary.near_expiry_batches ?? 0) > 0 ||
    (summary.expired_batches ?? 0) > 0 ||
    (summary.open_alerts ?? 0) > 0 ||
    (summary.acknowledged_alerts ?? 0) > 0
  )
}
