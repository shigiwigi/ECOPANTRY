import { useQuery } from "@tanstack/react-query"
import { CloudOff, LineChart as LineChartIcon } from "lucide-react"
import { useId, useState } from "react"
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { EmptyState } from "@/components/common/EmptyState"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"
import { HISTORY_RANGES, historyQuery, type HistoryRange, type Metric } from "./api"

/** Chart series colours: design tokens only (globals.css), so both themes work. */
export type ChartColor = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5"

interface HistoryChartProps {
  deviceId: string
  metric: Metric
  title: string
  unit: string
  decimals: number
  color: ChartColor
  live: boolean
}

function formatTick(iso: string, range: HistoryRange): string {
  const options: Intl.DateTimeFormatOptions =
    range === "7d" ? { weekday: "short", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" }
  return new Intl.DateTimeFormat(undefined, options).format(new Date(iso))
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso))
}

export function HistoryChart({ deviceId, metric, title, unit, decimals, color, live }: HistoryChartProps) {
  const [range, setRange] = useState<HistoryRange>("24h")
  const history = useQuery(historyQuery(deviceId, metric, range, live))
  const headingId = useId()
  const stroke = `var(--${color})`

  const points = (history.data?.points ?? []).map((point) => ({
    t: point.t,
    avg: point.avg,
    band: [point.min, point.max] as [number, number],
    count: point.count,
  }))

  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        <div role="group" aria-label={`${title}: time range`} className="flex flex-wrap gap-1">
          {HISTORY_RANGES.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={range === option.value ? "secondary" : "ghost"}
              aria-pressed={range === option.value}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {history.isPending ? (
          <p className="h-64 text-sm text-muted-foreground">Loading history…</p>
        ) : history.isError ? (
          <EmptyState
            icon={CloudOff}
            title="History couldn't be loaded"
            description={history.error instanceof ApiError ? history.error.message : undefined}
          >
            <Button variant="outline" size="sm" onClick={() => history.refetch()}>
              Try again
            </Button>
          </EmptyState>
        ) : points.length === 0 ? (
          <EmptyState
            icon={LineChartIcon}
            title="No readings in this period"
            description="The station only uploads during live sessions, so quiet periods have no data."
          />
        ) : (
          <figure>
            <div className="h-64 w-full" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(value: string) => formatTick(value, range)}
                    stroke="var(--muted-foreground)"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    minTickGap={32}
                  />
                  <YAxis
                    width={48}
                    domain={["auto", "auto"]}
                    tickFormatter={(value: number) => value.toFixed(decimals)}
                    stroke="var(--muted-foreground)"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: "calc(var(--radius) * 0.8)",
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "var(--muted-foreground)" }}
                    labelFormatter={(value) => formatWhen(String(value))}
                    formatter={(value, name) => {
                      if (name === "band" && Array.isArray(value)) {
                        return [`${Number(value[0]).toFixed(decimals)}–${Number(value[1]).toFixed(decimals)} ${unit}`, "Range"]
                      }
                      return [`${Number(value).toFixed(decimals)} ${unit}`, "Average"]
                    }}
                  />
                  <Area
                    dataKey="band"
                    type="monotone"
                    stroke="none"
                    fill={stroke}
                    fillOpacity={0.15}
                    isAnimationActive={false}
                  />
                  <Line dataKey="avg" type="monotone" stroke={stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <figcaption className={cn("mt-2 text-xs text-muted-foreground")}>
              {summary(points.map((p) => p.avg), points.map((p) => p.band), decimals, unit)} Line: average; band:
              lowest to highest in each {bucketLabel(history.data?.bucket_seconds ?? 0)}.
            </figcaption>
          </figure>
        )}
      </div>
    </section>
  )
}

function bucketLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${seconds / 60} min`
  return `${seconds / 3600} h`
}

/** A text version of the chart for screen readers and quick reading. */
function summary(averages: number[], bands: [number, number][], decimals: number, unit: string): string {
  const low = Math.min(...bands.map((band) => band[0]))
  const high = Math.max(...bands.map((band) => band[1]))
  const latest = averages[averages.length - 1]
  return `Lowest ${low.toFixed(decimals)} ${unit}, highest ${high.toFixed(decimals)} ${unit}, latest average ${latest.toFixed(decimals)} ${unit}.`
}
