import type { Role } from "@/features/auth/roles"

/**
 * Roles that can change stock (receive, consume, adjust, print labels): the
 * backend's `inventory.manage` / `batches.manage`. UX only; the backend enforces
 * it. Everyone else (inspectors) sees the same data read-only.
 * Keep this the only place the inventory UI names role ids.
 */
export const STOCK_MANAGER_ROLES: readonly Role[] = ["admin", "shopkeeper"]
