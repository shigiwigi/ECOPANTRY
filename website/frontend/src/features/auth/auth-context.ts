import { createContext, useContext } from "react"
import type { Role, StaffUser } from "./roles"
import type { SignInValues } from "./schemas"

export interface AuthContextValue {
  user: StaffUser | null
  /** True when the session is the development-only preview, not a real sign-in. */
  isPreview: boolean
  signIn: (values: SignInValues) => Promise<StaffUser>
  signOut: () => void
  /** Only available in the development preview, to review role-filtered navigation. */
  setPreviewRole: ((role: Role) => void) | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>")
  return context
}
