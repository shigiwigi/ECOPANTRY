import { useEffect } from "react"
import { Navigate, Outlet, useLocation } from "react-router"
import { RouteLoading } from "@/components/common/RouteLoading"
import { useAuth } from "./auth-context"
import { isRole } from "./roles"

/**
 * Asks the server for the current session on first entry to the portal, then
 * sends visitors without one to the staff sign-in page. UX only; the API
 * refuses every request that lacks a valid session.
 */
export function RequireAuth() {
  const { user, status, endReason, checkSession } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (status === "unknown") checkSession()
  }, [status, checkSession])

  if (status !== "ready") return <RouteLoading />

  if (!user) {
    // Come back to the page they asked for, unless they just chose to sign out.
    const state = endReason === "signed_out" ? undefined : { from: location.pathname }
    return <Navigate to="/portal/sign-in" replace state={state} />
  }

  if (!isRole(user.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return <Outlet />
}