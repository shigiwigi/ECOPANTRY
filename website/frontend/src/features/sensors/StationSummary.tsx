import { useQuery } from "@tanstack/react-query"
import { ThermometerSun } from "lucide-react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-context"
import { ApiError } from "@/lib/api/client"
import { useNow } from "@/lib/use-now"
import { cn } from "@/lib/utils"
import { formatValue, primaryStation, stationExplanation, stationsQuery, stationState } from "./api"
import { StationBadge } from "./StationStatus"

/** Dashboard panel: the inventory station's latest values, or an honest empty state. */
export function StationSummary() {
  const { isPreview } = useAuth()

  return (
    <section aria-labelledby="station-summary" className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="station-summary" className="flex items-center gap-2 text-base font-semibold">
          <ThermometerSun className="size-5 text-primary" aria-hidden />
          Inventory station
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to="/portal/environment">Environment</Link>
        </Button>
      </div>
      {isPreview ? (
        <p className="mt-3 text-sm text-muted-foreground">Readings need a real sign-in; the development preview has none.</p>
      ) : (
        <SummaryBody />
      )}
    </section>
  )
}

function SummaryBody() {
  const stations = useQuery(stationsQuery)
  const now = useNow()

  if (stations.isPending) return <p className="mt-3 text-sm text-muted-foreground">Loading readings…</p>
  if (stations.isError) {
    const unreachable = stations.error instanceof ApiError && stations.error.isUnreachable
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        {unreachable ? "Can't reach the EcoPantry server." : "Readings couldn't be loaded."}
      </p>
    )
  }

  const station = primaryStation(stations.data.stations)
  if (!station) {
    return <p className="mt-3 text-sm text-muted-foreground">No station registered yet, so there are no readings to show.</p>
  }

  const reading = station.latest
  const old = stationState(station) !== "live"
  const values = [
    { label: "Temperature", value: formatValue(reading?.temperature_c, 1), unit: "°C" },
    { label: "Humidity", value: formatValue(reading?.humidity_pct, 0), unit: "%" },
    { label: "Waste bin", value: formatValue(reading?.weight_g, 0), unit: "g" },
  ]

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{station.name}</span>
        <StationBadge station={station} />
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {values.map(({ label, value, unit }) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={cn("font-mono text-xl font-semibold tabular-nums", old && "text-muted-foreground")}>
              {value === null ? (
                <span className="font-sans text-sm font-normal">—</span>
              ) : (
                <>
                  {value}
                  <span className="ml-0.5 font-sans text-sm font-normal text-muted-foreground">{unit}</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{stationExplanation(station, now)}</p>
    </div>
  )
}
