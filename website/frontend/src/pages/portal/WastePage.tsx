import { WasteRecords } from "@/features/records/WasteRecords"
import { SensorPage, type MetricSpec } from "@/features/sensors/SensorPage"

const METRICS: MetricSpec[] = [
  {
    metric: "weight_g",
    label: "Waste bin weight",
    unit: "g",
    decimals: 1,
    color: "chart-5",
    chartTitle: "Bin weight history",
    missingText: (reading) => (reading.load_cell_ok ? "No reading" : "Load cell not responding"),
  },
]

export default function WastePage() {
  return (
    <div className="space-y-8">
      <SensorPage
        moduleId="waste"
        metrics={METRICS}
        footnote="Fill level needs the ultrasonic sensor, which isn't fitted yet."
      />
      <WasteRecords />
    </div>
  )
}
