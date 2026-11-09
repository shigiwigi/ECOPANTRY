/**
 * Alerts raised by the backend when a live station's reading crosses a threshold, and the
 * thresholds themselves (portal only; never public). People can only acknowledge alerts: the
 * backend opens and resolves them. Weight is stored in grams and shown in kg.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export type AlertMetric = "temperature_c" | "humidity_pct" | "weight_g"
export type Severity = "info" | "warning" | "critical"
export type AlertStatus = "open" | "acknowledged" | "resolved"
export type AlertFilter = AlertStatus | "active"

export interface Alert {
  id: string
  threshold_id: string
  device_id: string
  device_name: string
  metric: AlertMetric
  severity: Severity
  message: string
  status: AlertStatus
  trigger_value: number
  last_value: number | null
  opened_at: string
  acknowledged_at: string | null
  acknowledged_by_name: string | null
  resolved_at: string | null
}

export interface AlertPage {
  items: Alert[]
  total: number
  limit: number
  offset: number
}

export interface AlertSummary {
  open: number
  acknowledged: number
  unresolved: number
  by_severity: Record<Severity, number>
}

export interface Threshold {
  id: string
  label: string
  metric: AlertMetric
  device_id: string | null
  device_name: string | null
  min_value: number | null
  max_value: number | null
  clear_value: number | null
  severity: Severity
  enabled: boolean
}

export const ALERT_POLL_MS = 30_000

export const METRIC_LABELS: Record<AlertMetric, string> = {
  temperature_c: "Temperature",
  humidity_pct: "Humidity",
  weight_g: "Waste bin weight",
}

export const SEVERITY_LABELS: Record<Severity, string> = { info: "Info", warning: "Warning", critical: "Critical" }
export const STATUS_LABELS: Record<AlertStatus, string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved" }

/** Roles that may acknowledge alerts (the backend's `alerts.acknowledge`); inspectors only view. */
export const ACKNOWLEDGE_ROLES = ["admin", "storekeeper"] as const

/** A value in the metric's display unit, e.g. 2050 g -> "2.05 kg". */
export function formatMetricValue(metric: AlertMetric, value: number | null): string {
  if (value === null) return "–"
  if (metric === "weight_g") return `${(value / 1000).toFixed(2)} kg`
  if (metric === "temperature_c") return `${value.toFixed(1)} °C`
  return `${value.toFixed(0)} %`
}

/** "above 2.00 kg, clears below 1.50 kg" */
export function describeThreshold(t: Threshold): string {
  const isMax = t.max_value !== null
  const limit = formatMetricValue(t.metric, isMax ? t.max_value : t.min_value)
  const clear = t.clear_value !== null ? `, clears ${isMax ? "below" : "above"} ${formatMetricValue(t.metric, t.clear_value)}` : ""
  return `${isMax ? "at or above" : "at or below"} ${limit}${clear}`
}

export function alertsQuery(filter: AlertFilter | "all", options: { device?: string; metric?: AlertMetric | "" } = {}) {
  const params = new URLSearchParams({ limit: "100" })
  if (filter !== "all") params.set("status", filter)
  if (options.device) params.set("device_id", options.device)
  if (options.metric) params.set("metric", options.metric)
  return queryOptions({
    queryKey: ["alerts", "list", filter, options.device ?? "", options.metric ?? ""] as const,
    queryFn: () => apiRequest<AlertPage>(`/alerts?${params.toString()}`),
    refetchInterval: ALERT_POLL_MS,
    refetchIntervalInBackground: false,
  })
}

/** Open or acknowledged alerts for the waste bin, to show the "nearly full" banner. */
export const binAlertsQuery = queryOptions({
  queryKey: ["alerts", "bin"] as const,
  queryFn: () => apiRequest<AlertPage>("/alerts?status=active&metric=weight_g&limit=20"),
  refetchInterval: ALERT_POLL_MS,
  refetchIntervalInBackground: false,
})

export const alertSummaryQuery = queryOptions({
  queryKey: ["alerts", "summary"] as const,
  queryFn: () => apiRequest<AlertSummary>("/alerts/summary"),
  refetchInterval: ALERT_POLL_MS,
  refetchIntervalInBackground: false,
})

export const thresholdsQuery = queryOptions({
  queryKey: ["thresholds"] as const,
  queryFn: () => apiRequest<Threshold[]>("/thresholds"),
  staleTime: 60_000,
})

export function useAcknowledge() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiRequest<Alert>(`/alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["alerts"] }),
  })
}

export interface ThresholdInput {
  label?: string
  metric?: AlertMetric
  device_id?: string | null
  min_value?: number | null
  max_value?: number | null
  clear_value?: number | null
  severity?: Severity
}

export function useUpdateThreshold() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: ThresholdInput }) =>
      apiRequest<Threshold>(`/thresholds/${encodeURIComponent(id)}`, { method: "PATCH", body: { ...changes } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["thresholds"] }),
  })
}

export function useToggleThreshold() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiRequest<Threshold>(`/thresholds/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["thresholds"] }),
  })
}
