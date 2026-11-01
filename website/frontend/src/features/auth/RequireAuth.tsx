import { Navigate, Outlet, useLocation } from "react-router"
import { useAuth } from "./auth-context"

/** Sends visitors without a session to the staff sign-in page. UX only; the API enforces access. */
export function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/portal/sign-in" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
