/**
 * Sensor-station management (administrators: `devices.view`, `devices.manage`).
 * The backend checks the permission on every request; this module only calls it.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export interface Device {
  id: string
  name: string
  kind: string
  status: "active" | "disabled"
  token_prefix: string
  firmware_version: string | null
  last_seen_at: string | null
  last_reading_at: string | null
  live: boolean
  live_until: string | null
  live_started_at: string | null
  created_at: string
}

export interface DeviceWithToken {
  device: Device
  /** Shown once; the server keeps only its hash. */
  token: string
}

export const devicesQuery = queryOptions({
  queryKey: ["devices"] as const,
  queryFn: () => apiRequest<Device[]>("/devices"),
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
})

function useRefresh() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["devices"] }),
      client.invalidateQueries({ queryKey: ["sensors"] }),
    ])
}

export function useCreateDevice() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (name: string) => apiRequest<DeviceWithToken>("/devices", { method: "POST", body: { name } }),
    onSuccess: refresh,
  })
}

export function useRotateToken() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<DeviceWithToken>(`/devices/${encodeURIComponent(id)}/rotate-token`, { method: "POST" }),
    onSuccess: refresh,
  })
}

export type DeviceAction = "disable" | "enable" | "stop-live"

export function useDeviceAction() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: DeviceAction }) =>
      apiRequest<Device>(`/devices/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
    onSuccess: refresh,
  })
}
