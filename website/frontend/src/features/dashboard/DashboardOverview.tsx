import { useQuery } from "@tanstack/react-query"
import { ArrowRight, BellRing, CircleCheck, Trash2, TriangleAlert } from "lucide-react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { getModule } from "@/config/portal-modules"
import { formatMetricValue, METRIC_LABELS } from "@/features/alerts/api"
import { useAuth } from "@/features/auth/auth-context"
import { hasRole } from "@/features/auth/roles"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"
import { dashboardSummaryQuery, needsAttention, tilesFor, type DashboardSummary, type Tile, type TopAlert } from "./api"

/** Alert strip, summary tiles and the "nothing needs attention" state, from one API response. */
export function DashboardOverview() {
  const { isPreview } = useAuth()
  const summary = useQuery({ ...dashboardSummaryQuery, enabled: !isPreview })

  if (isPreview) {
    return (
      <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        The figures need a real sign-in; the development preview has none.
      </p>
    )
  }
  if (summary.isPending) return <OverviewSkeleton />
  if (summary.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <div className="min-w-0 text-sm">
          <p className="font-medium text-destructive">Couldn't load the figures</p>
          <p className="text-muted-foreground">
            {summary.error instanceof ApiError ? summary.error.message : "Something went wrong."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void summary.refetch()} disabled={summary.isFetching}>
          Try again
        </Button>
      </div>
    )
  }
  return <Overview summary={summary.data} />
}

function Overview({ summary }: { summary: DashboardSummary }) {
  const tiles = tilesFor(summary)
  const quiet = tiles.length > 0 && !needsAttention(summary)

  return (
    <div className="space-y-4">
      {summary.top_alert && <AlertStrip alert={summary.top_alert} open={summary.open_alerts ?? 1} />}
      {quiet && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">Nothing needs attention</p>
            <p className="text-muted-foreground">
              No low stock, nothing expiring in the next {summary.expiry_window_days} days and no open alerts.
            </p>
          </div>
        </div>
      )}
      {tiles.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5" aria-label="Summary">
          {tiles.map((tile) => (
            <li key={tile.id}>
              <SummaryTile tile={tile} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AlertStrip({ alert, open }: { alert: TopAlert; open: number }) {
  const critical = alert.severity === "critical"
  const Icon = alert.metric === "weight_g" ? Trash2 : TriangleAlert
  const others = open - 1
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
        critical ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", critical ? "text-destructive" : "text-warning")} aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-medium">{alert.label}</p>
          <p className="text-muted-foreground">
            {METRIC_LABELS[alert.metric]} <span className="font-mono">{formatMetricValue(alert.metric, alert.value)}</span>, since{" "}
            {new Date(alert.opened_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {others > 0 ? `. ${others} more open ${others === 1 ? "alert" : "alerts"}.` : "."}
          </p>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link to="/portal/alerts">
          <BellRing className="size-4" aria-hidden />
          View alerts
        </Link>
      </Button>
    </div>
  )
}

function SummaryTile({ tile }: { tile: Tile }) {
  const { user } = useAuth()
  const module = getModule(tile.moduleId)
  const linked = hasRole(user, module.roles)
  const flagged = tile.value > 0 && tile.tone !== undefined
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{tile.label}</h2>
        {linked && <ArrowRight className="size-4 text-muted-foreground" aria-hidden />}
      </div>
      <p
        className={cn(
          "mt-2 font-mono text-3xl font-semibold tabular-nums",
          flagged && tile.tone === "danger" && "text-destructive",
          flagged && tile.tone === "warning" && "text-warning",
        )}
      >
        {tile.value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{tile.hint}</p>
    </>
  )
  const base = "block h-full rounded-lg border bg-card p-5"
  return linked ? (
    <Link
      to={tile.to}
      aria-label={`${tile.label}: ${tile.value}. Open ${module.label}`}
      className={cn(base, "transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring")}
    >
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  )
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className="h-32 animate-pulse rounded-lg border bg-muted/50" />
      ))}
    </div>
  )
}
