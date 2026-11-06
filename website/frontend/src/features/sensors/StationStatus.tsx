import { CirclePause, CircleSlash, Radio, TriangleAlert, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatClock, stationExplanation, stationState, type Station, type StationState } from "./api"

const BADGES: Record<StationState, { label: string; icon: typeof Radio; className: string }> = {
  live: { label: "Live", icon: Radio, className: "border-success/40 bg-success/10 text-success" },
  stale: { label: "No recent readings", icon: TriangleAlert, className: "border-warning/50 bg-warning/10 text-warning" },
  paused: { label: "Paused", icon: CirclePause, className: "border-border bg-muted text-muted-foreground" },
  "no-data": { label: "No readings yet", icon: WifiOff, className: "border-border bg-muted text-muted-foreground" },
  disabled: { label: "Disabled", icon: CircleSlash, className: "border-destructive/40 bg-destructive/10 text-destructive" },
}

export function StationBadge({ station, className }: { station: Station; className?: string }) {
  const state = stationState(station)
  const { label, icon: Icon, className: tone } = BADGES[state]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      {state === "live" && station.live_until && (
        <>
          {" "}
          <span className="font-normal">until {formatClock(station.live_until)}</span>
        </>
      )}
    </span>
  )
}

export function StationHeader({ station, nowMs }: { station: Station; nowMs: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{station.name}</p>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {stationExplanation(station, nowMs)}
        </p>
      </div>
      <StationBadge station={station} className="self-start" />
    </div>
  )
}
