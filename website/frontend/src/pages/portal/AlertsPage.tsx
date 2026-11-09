import { useQuery } from "@tanstack/react-query"
import { BellOff, BellRing, CloudOff } from "lucide-react"
import { useId, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { getModule } from "@/config/portal-modules"
import {
  ACKNOWLEDGE_ROLES,
  METRIC_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  alertsQuery,
  formatMetricValue,
  useAcknowledge,
  type Alert,
  type AlertMetric,
  type AlertStatus,
  type Severity,
} from "@/features/alerts/api"
import { ThresholdsPanel } from "@/features/alerts/ThresholdsPanel"
import { useAuth } from "@/features/auth/auth-context"
import { hasRole } from "@/features/auth/roles"
import { stationsQuery } from "@/features/sensors/api"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

const STATUSES: AlertStatus[] = ["open", "acknowledged", "resolved"]

const SEVERITY_TONE: Record<Severity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-warning/50 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
}

function problemText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return fallback
}

const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))

export default function AlertsPage() {
  const module = getModule("alerts")
  const { user, isPreview } = useAuth()

  return (
    <div className="space-y-8">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={BellRing}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share alerts."
        />
      ) : (
        <>
          <AlertList canAcknowledge={hasRole(user, ACKNOWLEDGE_ROLES)} />
          {hasRole(user, ["admin"]) && <ThresholdsPanel />}
        </>
      )}
    </div>
  )
}

function AlertList({ canAcknowledge }: { canAcknowledge: boolean }) {
  const [status, setStatus] = useState<AlertStatus>("open")
  const [metric, setMetric] = useState<AlertMetric | "">("")
  const [device, setDevice] = useState("")
  const metricId = useId()
  const deviceId = useId()
  const alerts = useQuery(alertsQuery(status, { metric, device }))
  const stations = useQuery(stationsQuery)
  const devices = stations.data?.stations ?? []

  return (
    <section aria-labelledby="alerts-heading" className="space-y-4">
      <h2 id="alerts-heading" className="sr-only">
        Alerts
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div role="group" aria-label="Alert status" className="flex flex-wrap gap-1">
          {STATUSES.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={status === option ? "secondary" : "ghost"}
              aria-pressed={status === option}
              onClick={() => setStatus(option)}
            >
              {STATUS_LABELS[option]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-40 space-y-1.5">
            <Label htmlFor={metricId}>Metric</Label>
            <NativeSelect id={metricId} value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric | "")}>
              <option value="">All metrics</option>
              {(Object.keys(METRIC_LABELS) as AlertMetric[]).map((key) => (
                <option key={key} value={key}>
                  {METRIC_LABELS[key]}
                </option>
              ))}
            </NativeSelect>
          </div>
          {devices.length > 1 && (
            <div className="min-w-40 space-y-1.5">
              <Label htmlFor={deviceId}>Station</Label>
              <NativeSelect id={deviceId} value={device} onChange={(e) => setDevice(e.target.value)}>
                <option value="">All stations</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
      </div>

      {alerts.isPending ? (
        <p className="text-sm text-muted-foreground">Loading alerts…</p>
      ) : alerts.isError ? (
        <EmptyState icon={CloudOff} title="Alerts couldn't be loaded" description={problemText(alerts.error, "")}>
          <Button variant="outline" size="sm" onClick={() => alerts.refetch()}>
            Try again
          </Button>
        </EmptyState>
      ) : alerts.data.items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={`No ${STATUS_LABELS[status].toLowerCase()} alerts`}
          description={
            status === "open"
              ? "Nothing needs attention. Alerts appear here when a live station's reading crosses a limit."
              : undefined
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {alerts.data.items.map((alert) => (
            <AlertRow key={alert.id} alert={alert} canAcknowledge={canAcknowledge} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AlertRow({ alert, canAcknowledge }: { alert: Alert; canAcknowledge: boolean }) {
  const acknowledge = useAcknowledge()
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (acknowledge.isPending) return
    setError(null)
    try {
      await acknowledge.mutateAsync(alert.id)
    } catch (caught) {
      setError(problemText(caught, "The alert couldn't be acknowledged."))
    }
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-xs font-medium", SEVERITY_TONE[alert.severity])}>
            {SEVERITY_LABELS[alert.severity]}
          </span>
          <span className="text-xs text-muted-foreground">{STATUS_LABELS[alert.status]}</span>
        </div>
        <p className="font-medium">{alert.message}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          <dt>Metric</dt>
          <dd>
            {METRIC_LABELS[alert.metric]}, {alert.device_name}
          </dd>
          <dt>Opened</dt>
          <dd>
            {formatWhen(alert.opened_at)} at {formatMetricValue(alert.metric, alert.trigger_value)}
          </dd>
          {alert.status !== "resolved" && alert.last_value !== null && (
            <>
              <dt>Now</dt>
              <dd>{formatMetricValue(alert.metric, alert.last_value)}</dd>
            </>
          )}
          {alert.acknowledged_at && (
            <>
              <dt>Acknowledged</dt>
              <dd>
                {formatWhen(alert.acknowledged_at)}
                {alert.acknowledged_by_name ? ` by ${alert.acknowledged_by_name}` : ""}
              </dd>
            </>
          )}
          {alert.resolved_at && (
            <>
              <dt>Resolved</dt>
              <dd>{formatWhen(alert.resolved_at)}</dd>
            </>
          )}
        </dl>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      {canAcknowledge && alert.status === "open" && (
        <Button variant="outline" className="shrink-0" onClick={run} aria-disabled={acknowledge.isPending || undefined}>
          Acknowledge
          <span className="sr-only"> {alert.message}</span>
        </Button>
      )}
    </li>
  )
}
