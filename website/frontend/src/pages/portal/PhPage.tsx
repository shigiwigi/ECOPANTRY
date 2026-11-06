import { FlaskConical } from "lucide-react"
import { SensorPage, type MetricSpec } from "@/features/sensors/SensorPage"

const METRICS: MetricSpec[] = [
  { metric: "ph_value", label: "pH (experimental)", unit: "pH", decimals: 2, color: "chart-2", chartTitle: "pH history" },
  {
    metric: "ph_voltage",
    label: "Probe voltage",
    unit: "V",
    decimals: 3,
    color: "chart-3",
    chartTitle: "Probe voltage history",
  },
]

function ExperimentalNotice() {
  return (
    <div role="note" className="flex gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
      <FlaskConical className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">Experimental reading</p>
        <p className="text-muted-foreground">
          This comes from a low-cost probe read through the station's ADC, calibrated against two buffer solutions. Never
          use it on its own to decide whether food is safe or spoiled. EcoPantry is not a certified food-safety system.
        </p>
      </div>
    </div>
  )
}

export default function PhPage() {
  return (
    <SensorPage
      moduleId="ph"
      metrics={METRICS}
      notice={<ExperimentalNotice />}
      footnote="Sample records with product reference ranges and operators aren't built yet; this page shows the probe's live value only."
    />
  )
}
