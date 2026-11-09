import { useQuery } from "@tanstack/react-query"
import { CloudOff, Cpu, Radio } from "lucide-react"
import { useId, useState, type ReactNode } from "react"
import { Link } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { getModule } from "@/config/portal-modules"
import { thresholdsQuery, describeThreshold, METRIC_LABELS, type Threshold } from "@/features/alerts/api"
import { useAuth } from "@/features/auth/auth-context"
import { ApiError } from "@/lib/api/client"
import { useNow } from "@/lib/use-now"
import { formatClock, formatValue, primaryStation, stationState, stationsQuery, type LatestReading, type Metric, type Station } from "./api"
import { HistoryChart, type ChartColor } from "./HistoryChart"
import { ReadingTile } from "./ReadingTile"
import { StationHeader } from "./StationStatus"

export interface MetricSpec {
  metric: Metric
  label: string
  unit: string
  decimals: number
  color: ChartColor
  chartTitle: string
  /** Why the value is missing, from the reading's sensor flags. */
  missingText?: (reading: LatestReading) => string
}

interface SensorPageProps {
  moduleId: string
  metrics: MetricSpec[]
  /** Shown under the heading on every state (for example the pH warning). */
  notice?: ReactNode
  /** Shown under the readings: what this page doesn't do yet. */
  footnote?: ReactNode
}

export function SensorPage({ moduleId, metrics, notice, footnote }: SensorPageProps) {
  const module = getModule(moduleId)
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {notice}
      {isPreview ? (
        <EmptyState
          icon={Radio}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share station readings."
        />
      ) : (
        <StationReadings metrics={metrics} />
      )}
      {footnote && <p className="text-sm text-muted-foreground">{footnote}</p>}
    </div>
  )
}

function loadError(error: unknown): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return "Readings couldn't be loaded."
}

function StationReadings({ metrics }: { metrics: MetricSpec[] }) {
  const stations = useQuery(stationsQuery)
  // Alert limits are a nicety here: if they can't be loaded, the readings still show.
  const loadedThresholds = useQuery(thresholdsQuery).data
  const thresholds = Array.isArray(loadedThresholds) ? loadedThresholds : []
  const { user } = useAuth()
  const now = useNow()
  const [chosenId, setChosenId] = useState<string | null>(null)
  const selectId = useId()

  if (stations.isPending) return <p className="text-sm text-muted-foreground">Loading readings…</p>
  if (stations.isError) {
    return (
      <EmptyState icon={CloudOff} title="Readings couldn't be loaded" description={loadError(stations.error)}>
        <Button variant="outline" size="sm" onClick={() => stations.refetch()}>
          Try again
        </Button>
      </EmptyState>
    )
  }

  const all = stations.data.stations
  if (all.length === 0) {
    return (
      <EmptyState
        icon={Cpu}
        title="No station registered"
        description="Readings appear here once an administrator registers the inventory station and it starts a live session."
      >
        {user?.role === "admin" && (
          <Button asChild variant="outline" size="sm">
            <Link to="/portal/devices">Register a station</Link>
          </Button>
        )}
      </EmptyState>
    )
  }

  const station = all.find((candidate) => candidate.id === chosenId) ?? primaryStation(all)!

  return (
    <div className="space-y-4">
      {all.length > 1 && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor={selectId}>Station</Label>
          <NativeSelect id={selectId} value={station.id} onChange={(event) => setChosenId(event.target.value)}>
            {all.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <StationHeader station={station} nowMs={now} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((spec) => (
          <ReadingTile key={spec.metric} {...tileProps(spec, station)} />
        ))}
      </div>

      <ThresholdNote thresholds={limitsFor(thresholds, metrics, station)} />

      <div className="grid gap-4 xl:grid-cols-2">
        {metrics.map((spec) => (
          <HistoryChart
            key={`${station.id}-${spec.metric}`}
            deviceId={station.id}
            metric={spec.metric}
            title={spec.chartTitle}
            unit={spec.unit}
            decimals={spec.decimals}
            color={spec.color}
            live={station.live}
            references={chartReferences(limitsFor(thresholds, [spec], station), spec)}
          />
        ))}
      </div>
    </div>
  )
}

function tileProps(spec: MetricSpec, station: Station) {
  const reading = station.latest
  const state = stationState(station)
  const value = reading ? formatValue(reading[spec.metric], spec.decimals) : null
  return {
    label: spec.label,
    unit: spec.unit,
    value,
    missingText: reading && spec.missingText ? spec.missingText(reading) : "No reading yet",
    muted: state !== "live",
    note: reading && state !== "live" ? `Last reading at ${formatClock(reading.recorded_at)}` : undefined,
  }
}

/** Enabled thresholds for these metrics that apply to this station. */
function limitsFor(thresholds: Threshold[], metrics: MetricSpec[], station: Station): Threshold[] {
  return thresholds.filter(
    (t) => t.enabled && metrics.some((spec) => spec.metric === t.metric) && (t.device_id === null || t.device_id === station.id),
  )
}

/** Limits are stored in the chart's unit (grams for weight), so they line up with the series. */
function chartReferences(thresholds: Threshold[], spec: MetricSpec) {
  return thresholds.flatMap((t) => {
    const value = t.max_value ?? t.min_value
    if (value === null) return []
    const label = t.metric === "weight_g" ? `${t.label}: ${(value / 1000).toFixed(2)} kg` : `${t.label}: ${value} ${spec.unit}`
    return [{ value, label }]
  })
}

function ThresholdNote({ thresholds }: { thresholds: Threshold[] }) {
  if (thresholds.length === 0) return null
  return (
    <p className="text-sm text-muted-foreground">
      Alert limits:{" "}
      {thresholds.map((t, index) => (
        <span key={t.id}>
          {index > 0 && "; "}
          {METRIC_LABELS[t.metric].toLowerCase()} {describeThreshold(t)}
        </span>
      ))}
      .
    </p>
  )
}
