import { cn } from "@/lib/utils"

interface ReadingTileProps {
  label: string
  value: string | null
  unit: string
  /** Shown instead of a value, e.g. "Sensor not responding". */
  missingText?: string
  note?: string
  /** Dims the value when it is old (station paused or stale). */
  muted?: boolean
}

/** One current value. Never shows a made-up number: a missing value says why. */
export function ReadingTile({ label, value, unit, missingText = "No reading", note, muted }: ReadingTileProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      {value === null ? (
        <p className="mt-2 text-base font-medium text-muted-foreground">{missingText}</p>
      ) : (
        <p className={cn("mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight", muted && "text-muted-foreground")}>
          {value}
          <span className="ml-1 font-sans text-base font-normal text-muted-foreground">{unit}</span>
        </p>
      )}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
