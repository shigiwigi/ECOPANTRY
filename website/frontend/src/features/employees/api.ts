/**
 * Staff accounts for the portal (`employees.manage`, administrators). The
 * backend checks the permission and the CSRF token on every request; there is
 * no delete, only deactivate, so the audit log keeps who did what.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"
import type { Role } from "@/features/auth/roles"

export type AccountFilter = "active" | "inactive"

export interface ManagedEmployee {
  id: string
  email: string
  name: string
  role: Role
  role_name: string
  status: "active" | "disabled"
  last_login_at: string | null
  created_at: string
  deactivated_at: string | null
}

export type NewEmployee = {
  name: string
  email: string
  role: Role
  /** 12-128 characters. Leave out for an account that only signs in with Google. */
  password?: string
}

export const INITIAL_PASSWORD_MIN = 12
export const INITIAL_PASSWORD_MAX = 128

export const employeesQuery = (filter: AccountFilter) =>
  queryOptions({
    queryKey: ["employees", "managed", filter] as const,
    queryFn: () => apiRequest<ManagedEmployee[]>(`/employees?active=${filter === "active"}`),
  })

function useRefresh() {
  const client = useQueryClient()
  // Prefix match: the managed lists and the RFID page's account picker.
  return () => client.invalidateQueries({ queryKey: ["employees"] })
}

export function useCreateEmployee() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (input: NewEmployee) => apiRequest<ManagedEmployee>("/employees", { method: "POST", body: input }),
    onSuccess: refresh,
  })
}

export function useChangeRole() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      apiRequest<ManagedEmployee>(`/employees/${id}`, { method: "PATCH", body: { role } }),
    onSuccess: refresh,
    // A refused change (last administrator, own role) must put the old role back on screen.
    onError: refresh,
  })
}

export function useSetActive() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiRequest<ManagedEmployee>(`/employees/${id}/${active ? "reactivate" : "deactivate"}`, { method: "POST" }),
    onSuccess: refresh,
    onError: refresh,
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiRequest<void>(`/employees/${id}/password`, { method: "POST", body: { password } }),
  })
}
