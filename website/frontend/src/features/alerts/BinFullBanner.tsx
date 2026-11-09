import { useQuery } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { Link } from "react-router"
import { binAlertsQuery, formatMetricValue } from "./api"

/**
 * Shown on the Waste page while a waste-bin alert is open or acknowledged. Renders nothing when
 * there is none, or when alerts can't be loaded (the page itself reports its own errors).
 */
export function BinFullBanner() {
  const alerts = useQuery(binAlertsQuery)
  const active = alerts.data?.items ?? []
  if (active.length === 0) return null

  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3">
      <Trash2 className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium">Bin nearly full</p>
        <ul className="space-y-0.5">
          {active.map((alert) => (
            <li key={alert.id}>
              {alert.device_name} reads {formatMetricValue("weight_g", alert.last_value ?? alert.trigger_value)}
              {alert.status === "acknowledged" ? " (acknowledged)" : ""}.
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Empty the bin; the alert clears by itself once the weight falls back.{" "}
          <Link to="/portal/alerts" className="underline underline-offset-2">
            See all alerts
          </Link>
        </p>
      </div>
    </div>
  )
}
