export const ROLES = ["admin", "shopkeeper", "food_inspector"] as const

export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  shopkeeper: "Shopkeeper",
  food_inspector: "Food Inspector",
}

export interface StaffUser {
  id: string
  name: string
  email: string
  role: Role
  has_password_auth?: boolean
}

/**
 * Normalizes backend role aliases (storekeeper -> shopkeeper, inspector -> food_inspector).
 */
export function normalizeRole(role: string): Role {
  const clean = role.toLowerCase().trim()
  if (clean === "storekeeper" || clean === "shopkeeper") return "shopkeeper"
  if (clean === "inspector" || clean === "food_inspector") return "food_inspector"
  return "admin"
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role)
}

export function hasRole(
  userOrRole: StaffUser | Role | string | null | undefined,
  allowed: readonly Role[]
): boolean {
  if (!userOrRole) return false
  const rawRole = typeof userOrRole === "string" ? userOrRole : userOrRole.role
  const normalized = normalizeRole(rawRole)
  return allowed.includes(normalized)
}