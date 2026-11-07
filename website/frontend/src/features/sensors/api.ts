/**
 * Readings from the sensor stations (portal only; never public).
 *
 * "Real time" is polling: every 5 s while a station is live, every 60 s otherwise,
 * and not at all while the tab is hidden. A station only uploads during a live
 * session (see docs/HARDWARE_INTEGRATION.md), so a paused station is normal, not an
 * error, and the portal says so.
 */
import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export type Metric = "temperature_c" | "humidity_pct" | "weight_g" | "ph_value" | "ph_voltage"
export type HistoryRange = "1h" | "6h" | "24h" | "7d"

export const HISTORY_RANGES: { value: HistoryRange; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
]

export interface LatestReading {
  recorded_at: string
  temperature_c: number | null
  humidity_pct: number | null
  weight_g: number | null
  ph_value: number | null
  ph_voltage: number | null
  dht_ok: boolean
  load_cell_ok: boolean
}

export interface Station {
  id: string
  name: string
  status: "active" | "disabled"
  firmware_version: string | null
  last_seen_at: string | null
  live: boolean
  live_until: string | null
  stale: boolean
  report_interval_seconds: number
  latest: LatestReading | null
}

export interface StationsResponse {
  server_time: string
  stations: Station[]
}

export interface HistoryPoint {
  t: string
  avg: number
  min: number
  max: number
  count: number
}

export interface History {
  device_id: string
  metric: Metric
  range: HistoryRange
  bucket_seconds: number
  points: HistoryPoint[]
}

export const LIVE_POLL_MS = 2_000
export const IDLE_POLL_MS = 60_000

export const stationsQuery = queryOptions({
  queryKey: ["sensors", "stations"] as const,
  queryFn: () => apiRequest<StationsResponse>("/sensors/stations"),
  refetchInterval: (query) => (query.state.data?.stations.some((s) => s.live) ? LIVE_POLL_MS : IDLE_POLL_MS),
  refetchIntervalInBackground: false,
})

export function historyQuery(deviceId: string, metric: Metric, range: HistoryRange, live: boolean) {
  return queryOptions({
    queryKey: ["sensors", "history", deviceId, metric, range] as const,
    queryFn: () =>
      apiRequest<History>(
        `/sensors/stations/${encodeURIComponent(deviceId)}/history?metric=${metric}&range=${range}`,
      ),
    // Short ranges move while the station is live; long ones barely change.
    refetchInterval: live ? (range === "1h" ? 15_000 : 60_000) : false,
    refetchIntervalInBackground: false,
  })
}

export type StationState = "live" | "paused" | "stale" | "no-data" | "disabled"

/**
 * - `live`: in a session and readings are arriving.
 * - `stale`: in a session but readings stopped (WiFi, power, server trouble).
 * - `paused`: no session; the station is deliberately not uploading.
 */
export function stationState(station: Station): StationState {
  if (station.status === "disabled") return "disabled"
  if (station.live) return station.stale ? "stale" : "live"
  return station.latest ? "paused" : "no-data"
}

/** The station to show first: a live one, else the most recently heard from. */
export function primaryStation(stations: readonly Station[]): Station | null {
  const active = stations.filter((s) => s.status === "active")
  const pool = active.length ? active : stations
  const live = pool.find((s) => s.live)
  if (live) return live
  return [...pool].sort((a, b) => (b.latest?.recorded_at ?? "").localeCompare(a.latest?.recorded_at ?? ""))[0] ?? null
}

/** "just now", "12 s ago", "4 min ago", "3 h ago", or a date for anything older than a day. */
export function formatAge(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

export function formatValue(value: number | null | undefined, decimals: number): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return value.toFixed(decimals)
}

/** One sentence saying what the station is doing and why values may be old. */
export function stationExplanation(station: Station, nowMs: number): string {
  const last = station.latest ? formatAge(station.latest.recorded_at, nowMs) : null
  switch (stationState(station)) {
    case "live":
      return `Live: a new reading about every ${station.report_interval_seconds} s. Last one ${last}.`
    case "stale":
      return `In a live session, but the last reading was ${last ?? "never"}. Check the station's WiFi and power.`
    case "paused":
      return `Uploads are paused to save the free hosting plan. Last reading ${last}. Tap an authorised card on the station to go live.`
    case "no-data":
      return "This station hasn't sent a reading yet. Power it on, or tap an authorised card on it, to start a live session."
    case "disabled":
      return "An administrator disabled this station; the server refuses everything it sends."
  }
}
