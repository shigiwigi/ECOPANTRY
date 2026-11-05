import { useEffect } from "react"
import { Navigate, Outlet, useLocation } from "react-router"
import { RouteLoading } from "@/components/common/RouteLoading"
import { useAuth } from "./auth-context"

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
    const state = endReason === "session_ended" ? { from: location.pathname } : undefined
    return <Navigate to="/portal/sign-in" replace state={state} />
  }

  return <Outlet />
}