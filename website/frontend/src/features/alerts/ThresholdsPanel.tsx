import { useQuery } from "@tanstack/react-query"
import { useId, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"
import {
  SEVERITY_LABELS,
  describeThreshold,
  METRIC_LABELS,
  thresholdsQuery,
  useToggleThreshold,
  useUpdateThreshold,
  type Threshold,
} from "./api"

function problem(error: unknown): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return "The change couldn't be saved."
}

/** Display unit of a threshold's numbers: kg for weight (stored in grams), the metric's own unit otherwise. */
const SCALE: Record<Threshold["metric"], { factor: number; unit: string }> = {
  weight_g: { factor: 1000, unit: "kg" },
  temperature_c: { factor: 1, unit: "°C" },
  humidity_pct: { factor: 1, unit: "%" },
}

const round = (value: number) => Math.round(value * 1000) / 1000

/** Administrators' view of the alert limits: list, edit the limit, turn on or off. */
export function ThresholdsPanel() {
  const thresholds = useQuery(thresholdsQuery)
  const [editing, setEditing] = useState<string | null>(null)
  const toggle = useToggleThreshold()
  const [message, setMessage] = useState("")

  return (
    <section aria-labelledby="thresholds-heading" className="space-y-3">
      <div>
        <h2 id="thresholds-heading" className="text-base font-semibold">
          Alert limits
        </h2>
        <p className="text-sm text-muted-foreground">
          An alert opens when a live station's reading reaches the limit and clears when it passes the clear value.
        </p>
      </div>
      <p role="status" className={cn("text-sm", message ? "text-destructive" : "sr-only")}>
        {message}
      </p>
      {thresholds.isPending ? (
        <p className="text-sm text-muted-foreground">Loading limits…</p>
      ) : thresholds.isError ? (
        <p className="text-sm text-destructive">{problem(thresholds.error)}</p>
      ) : thresholds.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No limits are set.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {thresholds.data.map((threshold) => (
            <li key={threshold.id} className="space-y-3 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {threshold.label}
                    {!threshold.enabled && <span className="ml-2 text-xs font-normal text-muted-foreground">Off</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {METRIC_LABELS[threshold.metric]} {describeThreshold(threshold)}. {SEVERITY_LABELS[threshold.severity]},{" "}
                    {threshold.device_name ?? "all stations"}.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={editing === threshold.id}
                    onClick={() => setEditing(editing === threshold.id ? null : threshold.id)}
                  >
                    Edit<span className="sr-only"> {threshold.label}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-disabled={toggle.isPending || undefined}
                    onClick={async () => {
                      if (toggle.isPending) return
                      setMessage("")
                      try {
                        await toggle.mutateAsync({ id: threshold.id, enabled: !threshold.enabled })
                      } catch (error) {
                        setMessage(problem(error))
                      }
                    }}
                  >
                    {threshold.enabled ? "Turn off" : "Turn on"}
                    <span className="sr-only"> {threshold.label}</span>
                  </Button>
                </div>
              </div>
              {editing === threshold.id && <EditForm threshold={threshold} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EditForm({ threshold, onDone }: { threshold: Threshold; onDone: () => void }) {
  const id = useId()
  const update = useUpdateThreshold()
  const { factor, unit } = SCALE[threshold.metric]
  const isMax = threshold.max_value !== null
  const limit = (isMax ? threshold.max_value : threshold.min_value) ?? 0
  const [limitText, setLimitText] = useState(String(round(limit / factor)))
  const [clearText, setClearText] = useState(threshold.clear_value === null ? "" : String(round(threshold.clear_value / factor)))
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (update.isPending) return
    const limitValue = Number(limitText)
    const clearValue = clearText.trim() === "" ? null : Number(clearText)
    if (limitText.trim() === "" || !Number.isFinite(limitValue) || (clearValue !== null && !Number.isFinite(clearValue))) {
      setError("Enter numbers for the limit and the clear value.")
      return
    }
    setError(null)
    try {
      await update.mutateAsync({
        id: threshold.id,
        changes: {
          [isMax ? "max_value" : "min_value"]: limitValue * factor,
          clear_value: clearValue === null ? null : clearValue * factor,
        },
      })
      onDone()
    } catch (caught) {
      setError(problem(caught))
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border bg-muted/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-limit`}>
            {isMax ? "Alert at or above" : "Alert at or below"} ({unit})
          </Label>
          <Input id={`${id}-limit`} inputMode="decimal" value={limitText} onChange={(e) => setLimitText(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-clear`}>Clears {isMax ? "below" : "above"} ({unit})</Label>
          <Input id={`${id}-clear`} inputMode="decimal" value={clearText} onChange={(e) => setClearText(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" aria-disabled={update.isPending || undefined}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
