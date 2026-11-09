import { PageHeader } from "@/components/layout/PageHeader"
import { useAuth } from "@/features/auth/auth-context"
import { ROLE_LABELS } from "@/features/auth/roles"
import { DashboardOverview } from "@/features/dashboard/DashboardOverview"
import { StationSummary } from "@/features/sensors/StationSummary"

export default function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        documentTitle="Dashboard"
        description={
          <>
            <span className="font-medium text-foreground">Welcome back, {user?.name || user?.email || "staff member"}</span>
            {user ? ` (${ROLE_LABELS[user.role]})` : ""}. Live figures from stock, alerts and the inventory station.
          </>
        }
      />

      {/* Figures come from one API call; which ones appear depends on what the role may read. */}
      <DashboardOverview />

      {/* Real readings from the inventory station, for every role */}
      <StationSummary />
    </div>
  )
}
