/** Role ids are the backend's codes. Labels are only for people to read. */
export const ROLES = ["admin", "storekeeper", "inspector"] as const

export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  storekeeper: "Shopkeeper",
  inspector: "Food inspector",
}

export interface StaffUser {
  id: string
  name: string
  email: string
  role: Role
  /** From the backend; for hiding controls only. The API enforces permissions. */
  permissions?: string[]
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}

export function hasRole(user: { role: string } | Role | string | null | undefined, allowed: readonly Role[]): boolean {
  if (!user) return false
  const role = typeof user === "string" ? user : user.role
  return isRole(role) && allowed.includes(role)
}
