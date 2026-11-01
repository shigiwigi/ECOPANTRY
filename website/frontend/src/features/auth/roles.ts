export const ROLES = ["admin", "storekeeper", "inspector"] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  storekeeper: "Storekeeper",
  inspector: "Inspector",
}

export interface StaffUser {
  id: string
  name: string
  email: string
  role: Role
  /**
   * Permission codes from the backend (`inventory.view`, `batches.manage`, ...).
   * For hiding controls only; the backend checks them on every request.
   */
  permissions: readonly string[]
}

export function hasPermission(user: StaffUser | null, permission: string): boolean {
  return user !== null && user.permissions.includes(permission)
}

export function hasRole(user: StaffUser | null, allowed: readonly Role[]): boolean {
  return user !== null && allowed.includes(user.role)
}
