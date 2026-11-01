import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ApiError, apiRequest, onUnauthorized, setCsrfToken } from "@/lib/api/client"
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
  // Loaded on demand so Zod stays out of the public site's initial bundle.
  const { sessionResponseSchema } = await import("./schemas")
  const session = sessionResponseSchema.parse(response)
  setCsrfToken(session.csrf_token)
  return session.user
}

/**
 * Holds the staff session in memory. The session itself is an HttpOnly cookie
 * set by the backend, so nothing here can read or leak it; the backend decides
 * what each request may do.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL)
  const checkStarted = useRef(PORTAL_PREVIEW_ENABLED)
  const isPreview = PORTAL_PREVIEW_ENABLED && state.user?.id === PREVIEW_USER.id

  const checkSession = useCallback(() => {
    if (checkStarted.current) return
    checkStarted.current = true
    setState((current) => ({ ...current, status: "checking" }))
    void (async () => {
      try {
        const user = await acceptSession(await apiRequest<unknown>("/auth/me", { ignoreUnauthorized: true }))
        setState({ user, status: "ready", endReason: null })
      } catch {
        // 401 (no session), unreachable server or a malformed answer: all mean "not signed in".
        // Sign-in then reports what is wrong when it's tried.
        setState(NO_SESSION)
      }
    })()
  }, [])

  // Any API call that comes back 401 means the server ended the session.
  useEffect(() => {
    if (PORTAL_PREVIEW_ENABLED) return
    onUnauthorized(() => {
      setCsrfToken(null)
      setState((current) => (current.user ? { user: null, status: "ready", endReason: "session_ended" } : current))
    })
    return () => onUnauthorized(null)
  }, [])

  const signIn = useCallback(async (values: SignInValues) => {
    const response = await apiRequest<unknown>("/auth/login", { method: "POST", body: values, ignoreUnauthorized: true })
    const user = await acceptSession(response)
    checkStarted.current = true
    setState({ user, status: "ready", endReason: null })
    return user
  }, [])

  const signOut = useCallback(async () => {
    if (!isPreview) {
      try {
        await apiRequest<void>("/auth/logout", { method: "POST", ignoreUnauthorized: true })
      } catch (error) {
        // 401 means the session had already ended. Anything else means the server still
        // has it, so stay signed in rather than pretend (this matters on shared computers).
        if (!(error instanceof ApiError && error.status === 401)) throw error
      }
    }
    setCsrfToken(null)
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
      signIn,
      signOut,
      setPreviewRole: isPreview ? setPreviewRole : null,
    }),
    [state, isPreview, checkSession, signIn, signOut, setPreviewRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
