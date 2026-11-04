import { createContext, useContext } from "react"
import type { Role, StaffUser } from "./roles"
import type { SignInValues } from "./schemas"

/**
 * - `unknown`: nobody has asked the server yet (public pages never do).
 * - `checking`: `GET /auth/me` is in flight.
 * - `ready`: `user` is the answer (null when signed out).
 */
export type SessionStatus = "unknown" | "checking" | "ready"

/**
 * Why there is no user, when there was one earlier in this page's life:
 * - `signed_out`: they chose to sign out, so the next sign-in starts at the dashboard.
 * - `session_ended`: the server ended it (expired, revoked or deactivated), so sign-in
 *   says so and then returns them to the page they were on.
 */
export type SessionEndReason = "signed_out" | "session_ended"

export interface AuthContextValue {
  user: StaffUser | null
  status: SessionStatus
  endReason: SessionEndReason | null
  /** True when the session is the development-only preview, not a real sign-in. */
  isPreview: boolean
  /** Ask the server whether the browser has a session. */
  checkSession: (force?: boolean) => void
  /** Directly consumes a SessionResponse from the server and updates state immediately. */
  setSession?: (response: unknown) => Promise<StaffUser>
  signIn: (values: SignInValues) => Promise<StaffUser>
  /** Ends the session on the server. Rejects with an ApiError if the server can't be reached. */
  signOut: () => Promise<void>
  /** Only available in the development preview, to review role-filtered navigation. */
  setPreviewRole: ((role: Role) => void) | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>")
  return context
}