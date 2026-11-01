import { useCallback, useMemo, useState, type ReactNode } from "react"
import { apiRequest } from "@/lib/api/client"
import { AuthContext, type AuthContextValue } from "./auth-context"
import { PORTAL_PREVIEW_ENABLED, PREVIEW_USER } from "./preview"
import type { Role, StaffUser } from "./roles"
import type { SignInValues } from "./schemas"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(PORTAL_PREVIEW_ENABLED ? PREVIEW_USER : null)
  const isPreview = PORTAL_PREVIEW_ENABLED && user?.id === PREVIEW_USER.id

  const signIn = useCallback(async (values: SignInValues) => {
    const response = await apiRequest<unknown>("/auth/login", { method: "POST", body: values })
    // Loaded on demand so Zod stays out of the public site's initial bundle.
    const { staffUserSchema } = await import("./schemas")
    const signedIn = staffUserSchema.parse(response)
    setUser(signedIn)
    return signedIn
  }, [])

  // Server-side session invalidation (POST /auth/logout) is added with real auth in Milestone 3.
  const signOut = useCallback(() => setUser(null), [])

  const setPreviewRole = useCallback(
    (role: Role) => setUser((current) => (current ? { ...current, role } : current)),
    [],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ user, isPreview, signIn, signOut, setPreviewRole: isPreview ? setPreviewRole : null }),
    [user, isPreview, signIn, signOut, setPreviewRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
