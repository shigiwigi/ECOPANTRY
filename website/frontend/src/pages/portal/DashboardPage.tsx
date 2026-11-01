import { Activity, BellRing, CalendarClock, PackageMinus, type LucideIcon } from "lucide-react"
import { Link } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { getModule, portalHref } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { hasRole } from "@/features/auth/roles"

interface DashboardSection {
  moduleId: string
  title: string
  icon: LucideIcon
  empty: string
}

// Ordered by urgency: what a storekeeper must act on first.
const SECTIONS: DashboardSection[] = [
  { moduleId: "alerts", title: "Open alerts", icon: BellRing, empty: "Alerts appear here once the backend evaluates alert rules." },
  { moduleId: "expiry", title: "Expiring soon", icon: CalendarClock, empty: "Batches nearing expiry appear here once batch records exist." },
  { moduleId: "inventory", title: "Low stock", icon: PackageMinus, empty: "Ingredients below their reorder level appear here once inventory is recorded." },
  { moduleId: "devices", title: "Device health", icon: Activity, empty: "Each ESP32 unit's last contact appears here once devices report to the backend." },
]

export default function DashboardPage() {
  const { user } = useAuth()
  const module = getModule("dashboard")

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />

      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map(({ moduleId, title, icon, empty }) => {
          const target = getModule(moduleId)
          const canOpen = hasRole(user, target.roles)
          return (
            <section key={moduleId} aria-labelledby={`dash-${moduleId}`} className="rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <h2 id={`dash-${moduleId}`} className="text-sm font-semibold">
                  {title}
                </h2>
                {canOpen && (
                  <Link
                    to={portalHref(target)}
                    className="-my-1 inline-flex min-h-8 items-center rounded-md px-1 text-sm text-primary underline-offset-4 hover:underline"
                  >
                    Open {target.label}
                  </Link>
                )}
              </div>
              <div className="p-4">
                <EmptyState icon={icon} title="No data source connected" description={empty} className="border-0 bg-transparent p-0" />
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
