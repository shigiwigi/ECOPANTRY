import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ApiError, apiRequest, onUnauthorized, setCsrfToken } from "@/lib/api/client"
import { signOutOfGoogle } from "@/lib/firebase"
import { AuthContext, type AuthContextValue, type SessionEndReason, type SessionStatus } from "./auth-context"
import { PORTAL_PREVIEW_ENABLED, PREVIEW_USER } from "./preview"
import type { Role, StaffUser } from "./roles"
import type { SignInValues } from "./schemas"

interface AuthState {
  user: StaffUser | null
  status: SessionStatus
  endReason: SessionEndReason | null
}

const NO_SESSION: AuthState = { user: null, status: "ready", endReason: null }
const INITIAL: AuthState = PORTAL_PREVIEW_ENABLED
  ? { user: PREVIEW_USER, status: "ready", endReason: null }
  : { user: null, status: "unknown", endReason: null }

/** Validates a login or /auth/me response and keeps its CSRF token in memory. */
async function acceptSession(response: unknown): Promise<StaffUser> {
  const { sessionResponseSchema } = await import("./schemas")
  const session = sessionResponseSchema.parse(response)
  setCsrfToken(session.csrf_token)
  return session.user
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL)
  const checkStarted = useRef(PORTAL_PREVIEW_ENABLED)
  const isPreview = PORTAL_PREVIEW_ENABLED && state.user?.id === PREVIEW_USER.id

  const checkSession = useCallback((force = false) => {
    if (checkStarted.current && !force) return
    checkStarted.current = true
    setState((current) => ({ ...current, status: "checking" }))
    void (async () => {
      try {
        const user = await acceptSession(await apiRequest<unknown>("/auth/me", { ignoreUnauthorized: true }))
        setState({ user, status: "ready", endReason: null })
      } catch {
        setState(NO_SESSION)
      }
    })()
  }, [])

  const setSession = useCallback(async (response: unknown) => {
    const user = await acceptSession(response)
    checkStarted.current = true
    setState({ user, status: "ready", endReason: null })
    return user
  }, [])

  useEffect(() => {
    if (PORTAL_PREVIEW_ENABLED) return
    onUnauthorized(() => {
      setCsrfToken(null)
      void signOutOfGoogle()
      setState((current) => (current.user ? { user: null, status: "ready", endReason: "session_ended" } : current))
    })
    return () => onUnauthorized(null)
  }, [])

  const signIn = useCallback(
    async (values: SignInValues) => {
      const response = await apiRequest<unknown>("/auth/login", {
        method: "POST",
        body: values,
        ignoreUnauthorized: true,
      })
      return await setSession(response)
    },
    [setSession],
  )

  const signOut = useCallback(async () => {
    if (!isPreview) {
      try {
        await apiRequest<void>("/auth/logout", { method: "POST", ignoreUnauthorized: true })
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error
      }
    }

    await signOutOfGoogle()

    setCsrfToken(null)
    checkStarted.current = false
    setState({ user: null, status: "ready", endReason: "signed_out" })
  }, [isPreview])

  const setPreviewRole = useCallback(
    (role: Role) => setState((current) => (current.user ? { ...current, user: { ...current.user, role } } : current)),
    [],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isPreview,
      checkSession,
      setSession,
      signIn,
      signOut,
      setPreviewRole: isPreview ? setPreviewRole : null,
    }),
    [state, isPreview, checkSession, setSession, signIn, signOut, setPreviewRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}