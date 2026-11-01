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
}

export function hasRole(user: StaffUser | null, allowed: readonly Role[]): boolean {
  return user !== null && allowed.includes(user.role)
}
