import type { StaffUser } from "./roles"

/**
 * Development-only portal preview.
 *
 * Setting VITE_PORTAL_PREVIEW=true in `.env.local` lets developers review
 * portal layouts without a backend or an account. `import.meta.env.DEV` is
 * false in production builds, so this is removed from them. It grants no data
 * access: there is no session cookie, so every API call is refused (401).
 */
export const PORTAL_PREVIEW_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_PORTAL_PREVIEW === "true"

export const PREVIEW_USER: StaffUser = {
  id: "preview",
  name: "Preview user",
  email: "preview@localhost",
  role: "admin",
  // No permissions: the preview has no session, so it can't do anything on the backend.
  permissions: [],
}
