import type { StaffUser } from "./roles"

/**
 * Development-only portal preview.
 *
 * Real authentication arrives in Milestone 3. Until then, setting
 * VITE_PORTAL_PREVIEW=true in `.env.local` lets developers review the portal
 * layout. `import.meta.env.DEV` is false in production builds, so this is
 * removed from them. It grants no data access: the backend enforces roles.
 */
export const PORTAL_PREVIEW_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_PORTAL_PREVIEW === "true"

export const PREVIEW_USER: StaffUser = {
  id: "preview",
  name: "Preview user",
  email: "preview@localhost",
  role: "admin",
}
