import type { ReactNode } from "react"
import { Link } from "react-router"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { useAuth } from "./auth-context"
import { hasRole, ROLE_LABELS, type Role } from "./roles"

/** Shows a no-permission state when the signed-in role isn't allowed. UX only; the API enforces access. */
export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const { user } = useAuth()

  if (!hasRole(user, roles)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="You don't have access to this page"
          documentTitle="No access"
          description={
            <>
              This page is available to {roles.map((role) => ROLE_LABELS[role]).join(" and ")} accounts.
              {user && <> You are signed in as {ROLE_LABELS[user.role]}.</>}
            </>
          }
        />
        <Button asChild variant="outline">
          <Link to="/portal">Back to dashboard</Link>
        </Button>
      </div>
    )
  }
  return <>{children}</>
}
